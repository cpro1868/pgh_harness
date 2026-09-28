import type { MessageItem } from './context-governor.ts';

export interface ToolCallRequest {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ChatTurnResult {
  content: string;
  reasoning?: string;
  toolCalls: ToolCallRequest[];
  inputTokens?: number;
  outputTokens?: number;
}

export type ChatFn = (messages: MessageItem[], tools: unknown[], onDelta?: (kind: 'reasoning' | 'content', text: string) => void) => Promise<ChatTurnResult>;
export interface ToolExecutionResult {
  output: string;
  /** 附加元数据（如行级 diff），随 tool/result 事件落盘，供前端审阅与回放。 */
  meta?: Record<string, unknown>;
}

export type ToolExecutor = (name: string, args: Record<string, unknown>) => Promise<string | ToolExecutionResult>;
export type TurnEvent = { type: string; data: unknown };
export type AppendEventFn = (type: string, payload: unknown) => void;

export interface TurnLoopOptions {
  sessionId: string;
  turnId: string;
  workspacePath: string;
  systemPrompt: string;
  history: MessageItem[];
  userMessage: string;
  maxSteps?: number;
  model?: string;
  /**
   * 本轮附带的参考材料块（如用户上传的 Markdown 附件）。
   * 仅注入本轮请求上下文，不写入会话历史，避免后续每轮重复计入 token。
   */
  userAttachments?: string[];
  chat: ChatFn;
  executeTool: ToolExecutor;
  signal?: AbortSignal;
  onEvent?: (event: TurnEvent) => void;
  onDelta?: (kind: 'reasoning' | 'content', text: string) => void;
  appendEvent?: AppendEventFn;
}

export interface TurnLoopResult {
  finalContent: string;
  stepsUsed: number;
  stoppedReason: 'completed' | 'max-steps' | 'repeat-loop' | 'aborted';
  inputTokens: number;
  outputTokens: number;
}

export class TurnLoop {
  private readonly options: TurnLoopOptions;

  constructor(options: TurnLoopOptions) {
    this.options = options;
  }

  public async run(): Promise<TurnLoopResult> {
    const maxSteps = this.options.maxSteps ?? 25;
    const emit = (type: string, data: unknown): void => {
      this.options.onEvent?.({ type, data });
    };
    const append = (type: string, payload: unknown): void => {
      this.options.appendEvent?.(type, payload);
    };

    if (this.options.signal?.aborted) {
      append('session/aborted', { turnId: this.options.turnId });
      return { finalContent: '', stepsUsed: 0, stoppedReason: 'aborted', inputTokens: 0, outputTokens: 0 };
    }

    const messages: MessageItem[] = [
      { role: 'system', content: this.options.systemPrompt },
      ...this.options.history.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: this.options.userMessage },
    ];

    // 附件作为紧随其后的独立用户消息注入，仅在本次请求生效
    for (const block of this.options.userAttachments ?? []) {
      messages.push({ role: 'user', content: block });
    }

    let stepsUsed = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let lastToolSignature: string | null = null;
    let repeatCount = 0;
    let finalContent = '';

    emit('turn-start', { turnId: this.options.turnId });

    while (stepsUsed < maxSteps) {
      if (this.options.signal?.aborted) {
        append('session/aborted', { turnId: this.options.turnId });
        emit('turn-end', { stoppedReason: 'aborted' });
        return { finalContent, stepsUsed, stoppedReason: 'aborted', inputTokens, outputTokens };
      }

      stepsUsed += 1;
      emit('step-start', { step: stepsUsed });

      const turn = await this.options.chat(messages, TurnLoop.toolSchemas(), (kind, text) => {
        this.options.onDelta?.(kind, text);
        if (kind === 'content') outputTokens += 1;
      });
      inputTokens += turn.inputTokens ?? 0;
      outputTokens += turn.outputTokens ?? 0;

      if (turn.reasoning) {
        append('stream/chunk', { turnId: this.options.turnId, type: 'reasoning', chunk: turn.reasoning });
      }

      if (turn.toolCalls.length === 0) {
        finalContent = turn.content;
        if (finalContent) {
          append('stream/chunk', { turnId: this.options.turnId, type: 'content', chunk: finalContent });
        }
        append('message/assistant', { content: finalContent, model: this.options.model });
        append('turn/completed', {
          turnId: this.options.turnId,
          stepsUsed,
          model: this.options.model,
          stoppedReason: 'completed',
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
        });
        emit('turn-end', { stoppedReason: 'completed' });
        return { finalContent, stepsUsed, stoppedReason: 'completed', inputTokens, outputTokens };
      }

      // 记录本轮 Assistant 的回答（含 tool_calls 声明，100% 对齐 OpenAI 规范）
      messages.push({
        role: 'assistant',
        content: turn.content || '',
        tool_calls: turn.toolCalls.map((c) => ({
          id: c.id,
          type: 'function' as const,
          function: {
            name: c.name,
            arguments: JSON.stringify(c.args),
          },
        })),
      });

      for (const call of turn.toolCalls) {
        const signature = `${call.name}:${JSON.stringify(call.args)}`;
        if (signature === lastToolSignature) {
          repeatCount += 1;
        } else {
          lastToolSignature = signature;
          repeatCount = 1;
        }
        if (repeatCount >= 3) {
          finalContent = '检测到重复工具调用，已中断以防死循环，请换一种方式描述需求。';
          append('message/assistant', { content: finalContent, model: this.options.model });
          append('turn/completed', {
            turnId: this.options.turnId,
            stepsUsed,
            model: this.options.model,
            stoppedReason: 'repeat-loop',
            inputTokens,
            outputTokens,
            totalTokens: inputTokens + outputTokens,
          });
          emit('turn-end', { stoppedReason: 'repeat-loop' });
          return { finalContent, stepsUsed, stoppedReason: 'repeat-loop', inputTokens, outputTokens };
        }

        emit('tool-call-start', { callId: call.id, tool: call.name, args: call.args });
        append('tool/call', { callId: call.id, tool: call.name, args: call.args });

        let output = '';
        let isError = false;
        let meta: Record<string, unknown> | undefined;
        try {
          const toolResult = await this.options.executeTool(call.name, call.args);
          if (typeof toolResult === 'string') {
            output = toolResult;
          } else {
            output = toolResult.output;
            meta = toolResult.meta;
          }
        } catch (err) {
          output = (err as Error).message;
          isError = true;
        }

        const resultPayload = meta === undefined
          ? { callId: call.id, output, isError }
          : { callId: call.id, output, isError, meta };
        emit('tool-result', resultPayload);
        append('tool/result', resultPayload);

        // 严格遵循 OpenAI 协议标准：回填标准的 role: "tool" 与匹配的 tool_call_id
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: output,
        });
      }
    }

    finalContent = '已达单回合最大步数（25 步），已停止并保留已产出内容。';
    append('message/assistant', { content: finalContent, model: this.options.model });
    append('turn/completed', {
      turnId: this.options.turnId,
      stepsUsed,
      stoppedReason: 'max-steps',
      model: this.options.model,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    });
    emit('turn-end', { stoppedReason: 'max-steps' });
    return { finalContent, stepsUsed, stoppedReason: 'max-steps', inputTokens, outputTokens };
  }

  public static toolSchemas(): unknown[] {
    return [
      {
        name: 'read_file',
        description: 'Read the contents of a file in the workspace. Path must be relative to workspace root.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative path of the file to read' },
          },
          required: ['path'],
        },
      },
      {
        name: 'edit_file',
        description: 'Perform exact string replacement in a file. File must have been read with read_file first.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative file path' },
            oldString: { type: 'string', description: 'Exact string to replace' },
            newString: { type: 'string', description: 'Replacement string' },
            replaceAll: { type: 'boolean', description: 'Replace all occurrences' },
          },
          required: ['path', 'oldString', 'newString'],
        },
      },
      {
        name: 'write_file',
        description: 'Create or completely overwrite a file in the workspace.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative file path' },
            content: { type: 'string', description: 'File content to write' },
          },
          required: ['path', 'content'],
        },
      },
      {
        name: 'glob',
        description: 'Find files matching a glob pattern (e.g. "**/*.ts").',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Glob pattern to match' },
          },
          required: ['pattern'],
        },
      },
      {
        name: 'grep',
        description: 'Search file contents using regular expressions.',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Regex pattern to search for' },
          },
          required: ['pattern'],
        },
      },
      {
        name: 'bash',
        description: 'Execute a shell command inside the workspace root. Do not run commands that escape the workspace.',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'The shell command to execute' },
          },
          required: ['command'],
        },
      },
      {
        name: 'todo_write',
        description: 'Create or update the visible task list for multi-step work. Send the complete list each time; statuses are pending, in_progress or completed.',
        parameters: {
          type: 'object',
          properties: {
            todos: {
              type: 'array',
              description: 'The complete task list in display order',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', description: 'Stable id for this task' },
                  content: { type: 'string', description: 'Task description' },
                  status: {
                    type: 'string',
                    enum: ['pending', 'in_progress', 'completed'],
                    description: 'Task status',
                  },
                },
                required: ['content', 'status'],
              },
            },
          },
          required: ['todos'],
        },
      },
      {
        name: 'ask_user',
        description: 'Ask the user a structured question when requirements are genuinely ambiguous. Options plus free text. Use only for clarification, never for authorization.',
        parameters: {
          type: 'object',
          properties: {
            questions: {
              type: 'array',
              description: 'One or more questions to ask in a single request',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', description: 'Stable id for this question' },
                  header: { type: 'string', description: 'Short label (a few words)' },
                  question: { type: 'string', description: 'The question text' },
                  options: {
                    type: 'array',
                    description: 'Selectable options; omit to request free-form input',
                    items: {
                      type: 'object',
                      properties: {
                        label: { type: 'string' },
                        description: { type: 'string' },
                      },
                      required: ['label'],
                    },
                  },
                  multiple: { type: 'boolean', description: 'Allow selecting multiple options' },
                },
                required: ['header', 'question'],
              },
            },
          },
          required: ['questions'],
        },
      },
    ];
  }
}
