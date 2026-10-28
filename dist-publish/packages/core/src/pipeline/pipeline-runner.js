/**
 * 多阶段泳道顺序执行状态机 (WBS-02-02-01 / WBS-02-03-03 / D36)
 */
export class PipelineRunner {
    statuses = new Map();
    currentStages = new Map();
    pendingGates = new Map();
    abortControllers = new Map();
    pausedInstances = new Set();
    statusOf(instanceId) {
        return this.statuses.get(instanceId) ?? 'idle';
    }
    currentStageId(instanceId) {
        return this.currentStages.get(instanceId);
    }
    isPaused(instanceId) {
        return this.pausedInstances.has(instanceId);
    }
    /**
     * 暂停流水线：已暂停的实例在进入下一阶段前会挂起等待，已完成的阶段结果完整保留。
     * @returns 是否成功暂停（终态实例与未知实例一律拒绝）
     */
    pause(instanceId) {
        const status = this.statuses.get(instanceId);
        if (status !== 'running' && status !== 'waiting_gate') {
            return false;
        }
        this.pausedInstances.add(instanceId);
        this.statuses.set(instanceId, 'paused');
        return true;
    }
    /**
     * 恢复流水线：解除暂停并回到运行态。
     * @returns 是否成功恢复
     */
    resume(instanceId) {
        if (!this.pausedInstances.has(instanceId)) {
            return false;
        }
        this.pausedInstances.delete(instanceId);
        if (this.statuses.get(instanceId) === 'paused') {
            this.statuses.set(instanceId, 'running');
        }
        return true;
    }
    /** 暂停期间在阶段边界等待，直到恢复或收到中止信号。 */
    async waitWhilePaused(instanceId, signal) {
        while (this.pausedInstances.has(instanceId)) {
            if (signal?.aborted)
                return;
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
    }
    /**
     * 主动停止/中断正在运行或等待卡点的流水线实例。
     */
    abort(instanceId, reason = '用户主动停止任务') {
        const ctrl = this.abortControllers.get(instanceId);
        if (ctrl) {
            ctrl.abort();
            this.abortControllers.delete(instanceId);
        }
        this.pausedInstances.delete(instanceId);
        const gate = this.pendingGates.get(instanceId);
        if (gate) {
            this.pendingGates.delete(instanceId);
            gate.resolve({ action: 'abort', reason });
            return true;
        }
        if (this.statuses.get(instanceId) === 'running' || this.statuses.get(instanceId) === 'waiting_gate' || this.statuses.get(instanceId) === 'paused') {
            this.statuses.set(instanceId, 'aborted');
            return true;
        }
        return Boolean(ctrl);
    }
    /**
     * 响应 Gatekeeper 人工审批卡点。
     * @param instanceId 正在等待审批的流水线实例 ID
     * @param decision approve 放行 | reject 打回重做
     * @returns 是否成功处理该卡点
     */
    resolveGate(instanceId, decision) {
        const gate = this.pendingGates.get(instanceId);
        if (!gate)
            return false;
        this.pendingGates.delete(instanceId);
        gate.resolve(decision);
        return true;
    }
    /**
     * 启动并驱动一条流水线实例完整执行。
     */
    async run(options) {
        const { instanceId, stages } = options;
        const internalCtrl = new AbortController();
        this.abortControllers.set(instanceId, internalCtrl);
        if (options.signal) {
            if (options.signal.aborted) {
                internalCtrl.abort();
            }
            else {
                options.signal.addEventListener('abort', () => internalCtrl.abort(), { once: true });
            }
        }
        const signal = internalCtrl.signal;
        const sortedStages = [...stages].sort((a, b) => a.order - b.order);
        const maxReworks = options.maxReworks ?? 3;
        const stageResults = [];
        const gateRecords = [];
        const setStatus = (st, curStage) => {
            this.statuses.set(instanceId, st);
            if (curStage !== undefined) {
                this.currentStages.set(instanceId, curStage);
            }
            options.onStatusChange?.(st, curStage);
        };
        setStatus('running', sortedStages[0]?.id);
        try {
            for (let i = 0; i < sortedStages.length; i++) {
                const stage = sortedStages[i];
                let reworks = 0;
                let reworkReason;
                while (reworks <= maxReworks) {
                    // 暂停闸门：在阶段边界等待恢复（已完成的阶段结果完整保留）
                    while (this.pausedInstances.has(instanceId)) {
                        if (signal?.aborted)
                            break;
                        await new Promise((resolve) => setTimeout(resolve, 50));
                    }
                    if (signal?.aborted) {
                        setStatus('aborted', stage.id);
                        return {
                            instanceId,
                            status: 'aborted',
                            currentStageId: stage.id,
                            stageResults,
                            gateRecords,
                        };
                    }
                    setStatus('running', stage.id);
                    let runResult;
                    try {
                        runResult = await options.executeStage({
                            stage,
                            stageIndex: i,
                            reworkReason,
                            signal,
                        });
                    }
                    catch (execErr) {
                        if (signal?.aborted) {
                            setStatus('aborted', stage.id);
                            return {
                                instanceId,
                                status: 'aborted',
                                currentStageId: stage.id,
                                stageResults,
                                gateRecords,
                            };
                        }
                        setStatus('failed', stage.id);
                        return {
                            instanceId,
                            status: 'failed',
                            currentStageId: stage.id,
                            stageResults,
                            gateRecords,
                            error: execErr.message,
                        };
                    }
                    if (signal?.aborted) {
                        setStatus('aborted', stage.id);
                        return {
                            instanceId,
                            status: 'aborted',
                            currentStageId: stage.id,
                            stageResults,
                            gateRecords,
                        };
                    }
                    const artifacts = runResult.artifactPaths ?? [];
                    // 阶段执行期间若被暂停，则在流转/进入审批门之前挂起等待恢复（暂停在阶段边界生效）
                    while (this.pausedInstances.has(instanceId) && !signal?.aborted) {
                        await new Promise((resolve) => setTimeout(resolve, 50));
                    }
                    if (signal?.aborted) {
                        setStatus('aborted', stage.id);
                        return {
                            instanceId,
                            status: 'aborted',
                            currentStageId: stage.id,
                            stageResults,
                            gateRecords,
                        };
                    }
                    // 若不需要 Gatekeeper，该阶段直接算成功，进入下一阶段
                    if (!stage.gatekeeperRequired) {
                        stageResults.push({
                            stageId: stage.id,
                            roleName: stage.roleName,
                            summary: runResult.summary,
                            artifactPaths: artifacts,
                        });
                        break;
                    }
                    // 进入 Gatekeeper 审批卡点
                    setStatus('waiting_gate', stage.id);
                    options.onGateRequired?.(stage, artifacts);
                    const decision = await new Promise((resolve) => {
                        this.pendingGates.set(instanceId, { stage, resolve });
                    });
                    if (decision.action === 'abort' || signal?.aborted) {
                        setStatus('aborted', stage.id);
                        return {
                            instanceId,
                            status: 'aborted',
                            currentStageId: stage.id,
                            stageResults,
                            gateRecords,
                        };
                    }
                    gateRecords.push({
                        stageId: stage.id,
                        roleName: stage.roleName,
                        action: decision.action,
                        reason: decision.reason,
                        timestamp: Date.now(),
                    });
                    options.onGateResolved?.(stage, decision, artifacts);
                    if (decision.action === 'approve') {
                        stageResults.push({
                            stageId: stage.id,
                            roleName: stage.roleName,
                            summary: runResult.summary,
                            artifactPaths: artifacts,
                        });
                        break; // 审定放行，进入下一个泳道阶段
                    }
                    // 打回重做：增加重做计数，并在下一回合注入打回原因
                    reworks += 1;
                    reworkReason = decision.reason ?? '上游工件未达标，被打回要求修正';
                    if (reworks > maxReworks) {
                        setStatus('failed', stage.id);
                        return {
                            instanceId,
                            status: 'failed',
                            currentStageId: stage.id,
                            stageResults,
                            gateRecords,
                            error: `阶段 "${stage.roleName}" 打回次数超过上限 (${maxReworks})，流水线终止`,
                        };
                    }
                }
            }
            setStatus('completed');
            return {
                instanceId,
                status: 'completed',
                stageResults,
                gateRecords,
            };
        }
        finally {
            this.pendingGates.delete(instanceId);
            this.abortControllers.delete(instanceId);
        }
    }
}
