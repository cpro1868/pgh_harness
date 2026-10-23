import type { BpmnProcessModel, BpmnNode, BpmnFlow } from './bpmn-parser.ts';

export type WorkflowExecutionStatus = 'idle' | 'running' | 'waiting' | 'completed' | 'failed' | 'aborted';

export interface WorkflowEngineState {
  status: WorkflowExecutionStatus;
  activeNodes: string[];
  completedNodes: string[];
  variables: Record<string, unknown>;
  error?: string;
  waitingUserTaskId?: string;
}

export interface NodeExecutionResult {
  ok: boolean;
  variables?: Record<string, unknown>;
  error?: string;
}

export interface EngineExecuteOptions {
  initialVariables?: Record<string, unknown>;
  maxSteps?: number;
  onNodeExecute?: (node: BpmnNode, variables: Record<string, unknown>) => Promise<NodeExecutionResult>;
}

export interface ResumeOptions {
  decision: 'approve' | 'reject';
  variables?: Record<string, unknown>;
  reason?: string;
  maxSteps?: number;
}

export interface HydrateSnapshot {
  completedNodes?: string[];
  activeNodes?: string[];
  variables?: Record<string, unknown>;
  onNodeExecute?: (node: BpmnNode, variables: Record<string, unknown>) => Promise<NodeExecutionResult>;
}

export class BpmnWorkflowEngine {
  private readonly model: BpmnProcessModel;
  private readonly nodeMap = new Map<string, BpmnNode>();
  private readonly flowMap = new Map<string, BpmnFlow>();
  private readonly incomingFlows = new Map<string, BpmnFlow[]>();
  private readonly outgoingFlows = new Map<string, BpmnFlow[]>();

  // 运行时断点上下文 (用于 UserTask 挂起与恢复)
  private currentTokens: string[] = [];
  private completedNodes = new Set<string>();
  private arrivedTokens = new Map<string, number>();
  private variables: Record<string, unknown> = {};
  private onNodeExecute?: (node: BpmnNode, variables: Record<string, unknown>) => Promise<NodeExecutionResult>;
  private waitingUserTaskId?: string;
  /** 每个任务节点的真实执行次数，用于向变量总线注入 <节点ID>_runs 计数，支撑有限次重试环路 */
  private runCounts = new Map<string, number>();
  /** 跨 resume 累计的执行步数：人工放行不重置熔断计数，防止反复放行造成无限流转 */
  private totalSteps = 0;

  constructor(model: BpmnProcessModel) {
    this.model = model;
    this.indexElements();
  }

  private indexElements(): void {
    for (const node of this.model.nodes) {
      this.nodeMap.set(node.id, node);
      this.incomingFlows.set(node.id, []);
      this.outgoingFlows.set(node.id, []);
    }
    for (const flow of this.model.flows) {
      this.flowMap.set(flow.id, flow);
      const inc = this.incomingFlows.get(flow.targetRef);
      if (inc) inc.push(flow);
      const outg = this.outgoingFlows.get(flow.sourceRef);
      if (outg) outg.push(flow);
    }
  }

  public async execute(options: EngineExecuteOptions = {}): Promise<WorkflowEngineState> {
    this.variables = { ...(options.initialVariables || {}) };
    this.completedNodes = new Set<string>();
    this.arrivedTokens = new Map<string, number>();
    this.onNodeExecute = options.onNodeExecute;
    this.waitingUserTaskId = undefined;
    this.runCounts = new Map<string, number>();
    this.totalSteps = 0;

    const startNode = this.model.nodes.find((n) => n.type === 'startEvent');
    if (!startNode) {
      return {
        status: 'failed',
        activeNodes: [],
        completedNodes: [],
        variables: this.variables,
        error: '流程未定义 startEvent 开始节点',
      };
    }

    this.currentTokens = [startNode.id];
    return this.stepLoop(options.maxSteps ?? 500);
  }

  public async resume(options: ResumeOptions): Promise<WorkflowEngineState> {
    if (!this.waitingUserTaskId) {
      return {
        status: 'failed',
        activeNodes: this.currentTokens,
        completedNodes: Array.from(this.completedNodes),
        variables: this.variables,
        error: '当前流程未处于人工审查挂起状态',
      };
    }

    const utNodeId = this.waitingUserTaskId;
    if (options.variables) {
      Object.assign(this.variables, options.variables);
    }

    if (options.decision === 'reject') {
      this.variables.__rejectionReason = options.reason || '人工审查驳回';
      // 驳回必须真实走退回分支（返工节点），严禁让退回分支成为死路（D86 真机验收缺陷）：
      // UserTask 之后若紧跟排他网关，则以驳回语义推进到网关，由网关按条件表达式选择退回流。
      const outs = this.outgoingFlows.get(utNodeId) || [];
      const nextTokens: string[] = [];
      for (const f of outs) {
        const target = this.nodeMap.get(f.targetRef);
        if (target && target.type === 'exclusiveGateway') {
          nextTokens.push(f.targetRef);
        }
      }
      if (nextTokens.length > 0) {
        this.completedNodes.add(utNodeId);
        this.waitingUserTaskId = undefined;
        this.currentTokens = nextTokens;
        return this.stepLoop(options.maxSteps ?? 500);
      }
      // 无网关可承接驳回（纯线性流程）：维持挂起等待人工再次提交，绝不自行放行
      return {
        status: 'waiting',
        activeNodes: [utNodeId],
        completedNodes: Array.from(this.completedNodes),
        variables: this.variables,
        waitingUserTaskId: utNodeId,
      };
    }

    // approve 人工审查放行：标记完成该 UserTask，推进出线
    this.completedNodes.add(utNodeId);
    this.waitingUserTaskId = undefined;
    const outs = this.outgoingFlows.get(utNodeId) || [];
    this.currentTokens = outs.map((f) => f.targetRef);

    return this.stepLoop(options.maxSteps ?? 500);
  }

  /**
   * 从持久化实例快照重建挂起态（服务重启后 /decide 断点续接用）：
   * 仅恢复已完成节点与变量总线，定位 activeNodes 中的人工审查锚点，绝不重放已完成节点。
   */
  public hydrate(snapshot: HydrateSnapshot): void {
    this.completedNodes = new Set(snapshot.completedNodes ?? []);
    this.variables = { ...(snapshot.variables ?? {}) };
    this.currentTokens = [];
    this.arrivedTokens = new Map();
    this.waitingUserTaskId = undefined;
    this.onNodeExecute = snapshot.onNodeExecute;
    this.runCounts = new Map<string, number>();
    this.totalSteps = 0;

    const waiting = (snapshot.activeNodes ?? []).find((id) => this.nodeMap.get(id)?.type === 'userTask');
    this.waitingUserTaskId = waiting;
  }

  private async stepLoop(maxSteps: number): Promise<WorkflowEngineState> {
    try {
      while (this.currentTokens.length > 0) {
        if (this.totalSteps++ > maxSteps) {
          throw new Error(`流程执行超出步数上限 (${maxSteps})，疑似死循环`);
        }

        const nextTokens: string[] = [];

        for (const nodeId of this.currentTokens) {
          const node = this.nodeMap.get(nodeId);
          if (!node) continue;

          // 1. 处理 UserTask 人工审批节点：严格挂起为 waiting，绝不自动推进！
          if (node.type === 'userTask') {
            this.waitingUserTaskId = node.id;
            return {
              status: 'waiting',
              activeNodes: [node.id],
              completedNodes: Array.from(this.completedNodes),
              variables: this.variables,
              waitingUserTaskId: node.id,
            };
          }

          // 2. 处理普通 Task / ServiceTask 自动化任务
          if (node.type === 'task' || node.type === 'serviceTask') {
            if (this.onNodeExecute) {
              const res = await this.onNodeExecute(node, this.variables);
              if (!res.ok) {
                throw new Error(res.error || `节点 ${node.id} 执行失败`);
              }
              if (res.variables) {
                Object.assign(this.variables, res.variables);
              }
            }
            // 真实执行计数：写入 <节点ID>_runs 供网关判定有限次循环，外部同名入参以真实执行覆盖
            const runs = (this.runCounts.get(node.id) ?? 0) + 1;
            this.runCounts.set(node.id, runs);
            this.variables[`${node.id.replace(/[^a-zA-Z0-9_]/g, '_')}_runs`] = runs;
            this.completedNodes.add(node.id);
            const outs = this.outgoingFlows.get(node.id) || [];
            for (const f of outs) {
              nextTokens.push(f.targetRef);
            }
          }
          // 3. StartEvent 开始节点
          else if (node.type === 'startEvent') {
            this.completedNodes.add(node.id);
            const outs = this.outgoingFlows.get(node.id) || [];
            for (const f of outs) {
              nextTokens.push(f.targetRef);
            }
          }
          // 4. EndEvent 结束节点
          else if (node.type === 'endEvent') {
            this.completedNodes.add(node.id);
          }
          // 5. ExclusiveGateway 排他网关 (XOR)
          else if (node.type === 'exclusiveGateway') {
            this.completedNodes.add(node.id);
            const outs = this.outgoingFlows.get(node.id) || [];
            let chosenFlow: BpmnFlow | null = null;

            // 5.1 条件为真的流优先（BPMN 标准语义：唯一满足条件的流）
            for (const f of outs) {
              if (f.conditionExpression && this.evalCondition(f.conditionExpression, this.variables)) {
                chosenFlow = f;
                break;
              }
            }
            // 5.2 其次是显式声明的默认流
            if (!chosenFlow) {
              chosenFlow = outs.find((f) => f.id === node.defaultFlow) ?? null;
            }
            // 5.3 再次是无条件兜底流（驳回分支通常是无条件出线，语义为"其余情况"）
            if (!chosenFlow) {
              chosenFlow = outs.find((f) => !f.conditionExpression) ?? null;
            }
            // 5.4 兜底：条件为假的流（严禁直接回退到 outs[0]，那会让驳回误入放行分支，D86）
            if (!chosenFlow) {
              chosenFlow = outs.find((f) => f.conditionExpression && !this.evalCondition(f.conditionExpression, this.variables)) ?? null;
            }

            if (chosenFlow) {
              nextTokens.push(chosenFlow.targetRef);
            }
          }
          // 6. ParallelGateway 并行网关 (AND Fork / Join)
          else if (node.type === 'parallelGateway') {
            const incoming = this.incomingFlows.get(node.id) || [];
            const outgoing = this.outgoingFlows.get(node.id) || [];

            if (incoming.length > 1) {
              const count = (this.arrivedTokens.get(node.id) || 0) + 1;
              this.arrivedTokens.set(node.id, count);
              if (count >= incoming.length) {
                this.completedNodes.add(node.id);
                this.arrivedTokens.delete(node.id);
                for (const f of outgoing) {
                  nextTokens.push(f.targetRef);
                }
              }
            } else {
              this.completedNodes.add(node.id);
              for (const f of outgoing) {
                nextTokens.push(f.targetRef);
              }
            }
          }
        }

        this.currentTokens = nextTokens;
      }

      return {
        status: 'completed',
        activeNodes: [],
        completedNodes: Array.from(this.completedNodes),
        variables: this.variables,
      };
    } catch (err) {
      return {
        status: 'failed',
        activeNodes: this.currentTokens,
        completedNodes: Array.from(this.completedNodes),
        variables: this.variables,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * 零外部依赖安全判定条件表达式（仅支持形如 ${score >= 80} 或 ${coverage > 85}）
   */
  private evalCondition(expr: string, vars: Record<string, unknown>): boolean {
    const clean = expr.trim().replace(/^\$\{|\}$/g, '').trim();
    // 匹配 var op val，较长操作符必须优先匹配，避免 === 被误当成 == 导致多余等号残留进 rawVal
    const m = clean.match(/^([a-zA-Z0-9_]+)\s*(===|!==|==|!=|>=|<=|>|<)\s*(.+)$/);
    if (!m) return false;

    const [, varName, op, rawVal] = m;
    const actual = vars[varName];
    if (actual === undefined) return false;

    let target: unknown = rawVal.trim();
    if (/^-?\d+(\.\d+)?$/.test(String(target))) {
      target = parseFloat(String(target));
    } else if (target === 'true') {
      target = true;
    } else if (target === 'false') {
      target = false;
    } else {
      target = String(target).replace(/^['"]|['"]$/g, '');
    }

    switch (op) {
      case '==':
      case '===':
        return actual === target;
      case '!=':
      case '!==':
        return actual !== target;
      case '>=':
        return Number(actual) >= Number(target);
      case '<=':
        return Number(actual) <= Number(target);
      case '>':
        return Number(actual) > Number(target);
      case '<':
        return Number(actual) < Number(target);
      default:
        return false;
    }
  }
}
