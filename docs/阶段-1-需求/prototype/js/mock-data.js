/**
 * Harness Full Enterprise Mock Database v2.2
 */

window.HARNESS_DB = {
  // 当前会话状态 (运行态)
  currentSession: {
    id: "sess_89f2a4",
    title: "修复 auth/token 边界溢出 bug 并补全单测",
    // 会话创建时绑定的工作区 (运行期绝对物理锁定)
    workspace: {
      path: "G:\\Projects\\auth-service",
      name: "auth-service",
      branch: "main",
      isLocked: true
    },
    // 当前会话中正在使用的模型 (运行期可自由切换)
    activeModelId: "deepseek-chat",
    // 当前会话挂载关联的知识库列表
    connectedKnowledgeBases: ["kb_arch_core", "kb_token_specs"],
    preset: "edit",
    tokens: { input: 14250, output: 2180, total: 16430, cost: "$0.024" }
  },

  // 最近工作区候选列表 (供新会话快速点选)
  recentWorkspaces: [
    { path: "G:\\Projects\\auth-service", name: "auth-service", branch: "main", lastUsed: "10分钟前" },
    { path: "G:\\Projects\\Agent\\harness", name: "harness", branch: "feat/core", lastUsed: "2小时前" },
    { path: "G:\\Projects\\gateway-proxy", name: "gateway-proxy", branch: "master", lastUsed: "昨天" }
  ],

  // 1. 工作区初始化设定配置 (Workspace Initialization & Governance)
  workspaceInitSettings: {
    defaultProjectRoot: "G:\\Projects",
    // 规则模板生成配置
    rulesTemplate: {
      standard: "ponytail-strict",
      strictTypeScript: true,
      zeroNativeAddons: true,
      commitStandard: "conventional-commits",
      requireReadBeforeWrite: true,
      gitCommitFormat: "<type>(<scope>): <subject>"
    },
    // 全局默认排除扫描的文件/目录
    globalIgnorePatterns: [
      ".git",
      "node_modules",
      "dist",
      "build",
      "coverage",
      "*.env",
      "*.pem",
      "*.key"
    ]
  },

  // 2. 独立知识库系统 (Knowledge Bases & RAG Console)
  knowledgeSystem: {
    // 专门独立的向量化嵌入模型设定 (Embedding Model Configuration)
    embeddingSetting: {
      providerType: "ollama-local", // ollama-local | openai-compatible
      modelId: "bge-m3",
      baseUrl: "http://127.0.0.1:11434",
      dimensions: 1024,
      batchSize: 32,
      status: "ready"
    },
    // 可选备用嵌入模型
    availableEmbeddingModels: [
      { id: "bge-m3", name: "BAAI/bge-m3 (本地Ollama · 1024维 · 多语言推荐)", type: "local", dims: 1024 },
      { id: "nomic-embed-text", name: "Nomic Embed Text (本地Ollama · 768维 · 高速)", type: "local", dims: 768 },
      { id: "text-embedding-3-small", name: "OpenAI text-embedding-3-small (远端 · 1536维)", type: "remote", dims: 1536 },
      { id: "text-embedding-3-large", name: "OpenAI text-embedding-3-large (远端 · 3072维)", type: "remote", dims: 3072 }
    ],
    // 独立知识库集合列表
    libraries: [
      {
        id: "kb_arch_core",
        name: "支付与认证中台核心架构规范",
        desc: "涵盖全局 JWT 签发、跨服务 Token 传递协议与数据库连接池优化规范。",
        docCount: 16,
        chunkCount: 248,
        vectorCount: 248,
        storageSize: "4.2 MB",
        chunkStrategy: "Markdown 标题感知切块 (500字, 50重叠)",
        updatedAt: "2026-09-13 18:00"
      },
      {
        id: "kb_token_specs",
        name: "代币安全与数值边界技术规格",
        desc: "防范 64 位整数溢出攻击、高精度数值运算与跨平台安全边界标准。",
        docCount: 8,
        chunkCount: 96,
        vectorCount: 96,
        storageSize: "1.8 MB",
        chunkStrategy: "滑动窗口切块 (800字, 80重叠)",
        updatedAt: "2026-09-12 14:20"
      },
      {
        id: "kb_company_rules",
        name: "研发安全与开源合规红线库",
        desc: "严禁代码明文上报、第三方开源许可证检查与安全审计基线。",
        docCount: 12,
        chunkCount: 140,
        vectorCount: 140,
        storageSize: "2.4 MB",
        chunkStrategy: "纯文本切块 (600字, 60重叠)",
        updatedAt: "2026-09-10 11:30"
      }
    ]
  },

  // 3. Provider 与模型配置
  providers: [
    {
      id: "p_deepseek",
      name: "DeepSeek 官方 API",
      type: "openai-compatible",
      baseUrl: "https://api.deepseek.com/v1",
      apiKeyMasked: "sk-dsk••••••••••••••••••••••••••••3f8a",
      envRef: "DEEPSEEK_API_KEY",
      status: "connected",
      modelsCount: 2
    },
    {
      id: "p_openrouter",
      name: "OpenRouter 聚合端点",
      type: "openai-compatible",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKeyMasked: "sk-or••••••••••••••••••••••••••••99b2",
      envRef: "OPENROUTER_API_KEY",
      status: "connected",
      modelsCount: 4
    },
    {
      id: "p_ollama",
      name: "本地 Ollama 实例",
      type: "ollama-local",
      baseUrl: "http://127.0.0.1:11434/v1",
      apiKeyMasked: "免密本地调用",
      envRef: "NONE",
      status: "connected",
      modelsCount: 2
    }
  ],

  // 全局可用模型总清单
  allModels: [
    { id: "deepseek-chat", name: "DeepSeek V3 (Chat)", provider: "DeepSeek 官方", context: "64k", capabilities: ["tools", "reasoning"], enabled: true, isDefault: true },
    { id: "deepseek-reasoner", name: "DeepSeek R1 (深度推理)", provider: "DeepSeek 官方", context: "64k", capabilities: ["tools", "reasoning"], enabled: true, isDefault: false },
    { id: "anthropic/claude-3.7-sonnet", name: "Claude 3.7 Sonnet (Hybrid)", provider: "OpenRouter", context: "200k", capabilities: ["tools", "reasoning"], enabled: true, isDefault: false },
    { id: "openai/gpt-4o", name: "GPT-4o (Omni)", provider: "OpenRouter", context: "128k", capabilities: ["tools", "vision"], enabled: true, isDefault: false },
    { id: "openai/gpt-4o-mini", name: "GPT-4o Mini (轻量/压缩专用)", provider: "OpenRouter", context: "128k", capabilities: ["tools"], enabled: true, isCompactionModel: true },
    { id: "qwen2.5-coder:32b", name: "Qwen 2.5 Coder 32B (本地离线)", provider: "本地 Ollama", context: "32k", capabilities: ["tools"], enabled: true, isDefault: false }
  ],

  // 会话列表
  sessions: [
    { id: "sess_89f2a4", title: "修复 auth/token 边界溢出 bug 并补全单测", time: "10 分钟前", active: true, folder: "auth-service" },
    { id: "sess_71c9b2", title: "重构 SQLite 迁移脚本以支持 WAL 模式", time: "2 小时前", active: false, folder: "harness" },
    { id: "sess_33e101", title: "排查 WebSocket 代理 15s 心跳断开问题", time: "昨天", active: false, folder: "gateway-proxy" }
  ],

  // MCP Servers
  mcpServers: [
    {
      id: "mcp_github",
      name: "github-mcp-server",
      transport: "stdio",
      command: "npx -y @modelcontextprotocol/server-github",
      status: "online",
      envRef: "GITHUB_TOKEN",
      enabled: true,
      tools: [
        { name: "mcp:github:create_issue", desc: "在指定仓库创建 issue", allowWithoutAsk: false },
        { name: "mcp:github:list_prs", desc: "检索活跃 PR 列表", allowWithoutAsk: true },
        { name: "mcp:github:create_pr", desc: "从当前分支创建 Pull Request", allowWithoutAsk: false }
      ]
    },
    {
      id: "mcp_sqlite",
      name: "sqlite-explorer",
      transport: "HTTP/SSE",
      endpoint: "http://127.0.0.1:8999/mcp/sse",
      status: "online",
      enabled: true,
      tools: [
        { name: "mcp:sqlite:query_read", desc: "执行只读 SQL 查询", allowWithoutAsk: true },
        { name: "mcp:sqlite:describe_table", desc: "查看表结构与索引定义", allowWithoutAsk: true }
      ]
    }
  ],

  // Skills 技能库
  skills: [
    {
      name: "systematic-debugging",
      scope: "project",
      source: ".harness/skills/systematic-debugging/SKILL.md",
      desc: "遭遇任何测试失败、编译报错或未预期 Bug 时，在提出修复方案前必须执行系统化排查流程。",
      whenToUse: "捕获测试断言错误、排查根因、防止病急乱投医",
      enabled: true,
      modelInvocable: true
    },
    {
      name: "test-driven-development",
      scope: "project",
      source: ".harness/skills/test-driven-development/SKILL.md",
      desc: "编写任何新功能或修复代码之前，先编写失败的单元测试用例（红-绿-重构闭环）。",
      whenToUse: "实现新需求、新增 API 模块",
      enabled: true,
      modelInvocable: true
    },
    {
      name: "git-worktree-isolation",
      scope: "user",
      source: "~/.harness/skills/git-worktree/SKILL.md",
      desc: "在不污染当前开发分支工作区的前提下，基于 Git Worktree 创建独立临时沙箱执行实验性代码测试。",
      whenToUse: "启动大型特性分支、多 Agent 并行开发",
      enabled: true,
      modelInvocable: true
    }
  ],

  // 插件内核装配清单
  plugins: [
    { seq: 1, name: "storage-sqlite", provides: "ctx.database", injects: "-", status: "active", enabled: true, desc: "Node 22 内置 node:sqlite 持久化驱动 (WAL)" },
    { seq: 2, name: "session-log", provides: "ctx.sessions", injects: "ctx.database", status: "active", enabled: true, desc: "追加式事件日志唯一真相与投影" },
    { seq: 3, name: "credentials", provides: "ctx.credentials", injects: "ctx.database", status: "active", enabled: true, desc: "引用式环境变量分层解析与 AES-256-GCM 动态加密" },
    { seq: 4, name: "permissions", provides: "ctx.permissions", injects: "ctx.database", status: "active", enabled: true, desc: "细粒度权限规则表与三档预设控制" },
    { seq: 5, name: "tools-core", provides: "ctx.tools", injects: "ctx.permissions", status: "active", enabled: true, desc: "先读后写文件工具、搜索与网络抓取" },
    { seq: 6, name: "shell-session", provides: "ctx.shell", injects: "ctx.permissions", status: "active", enabled: true, desc: "Node 原生子进程持久 Shell 与后台任务管理器" },
    { seq: 7, name: "context", provides: "ctx.tokenMeter, ctx.compaction", injects: "ctx.sessions", status: "active", enabled: true, desc: "Token 分层计量预估、自动压缩与结果裁剪" },
    { seq: 8, name: "spill", provides: "ctx.spillStore", injects: "-", status: "active", enabled: true, desc: "超大输出本地文件落盘机制" },
    { seq: 9, name: "mcp", provides: "ctx.mcpClient", injects: "ctx.tools, ctx.credentials", status: "active", enabled: true, desc: "Model Context Protocol 标准客户端" },
    { seq: 10, name: "agent-loop", provides: "ctx.agentLoop", injects: "ctx.sessions, ctx.tools, ctx.llm", status: "active", enabled: true, desc: "ReAct 核心决策与调度循环驱动" },
    { seq: 11, name: "orchestrator-pipeline", provides: "ctx.pipeline", injects: "ctx.agentLoop, ctx.sessions", status: "active", enabled: true, desc: "模式A：多角色流水线顺序协作引擎" },
    { seq: 12, name: "workflow-bpmn", provides: "ctx.workflowEngine", injects: "ctx.agentLoop, ctx.database", status: "active", enabled: true, desc: "模式C：BPMN 2.0 业务流程定义与状态机引擎" }
  ],

  // 模式A：流水线任务运行记录列表 (Pipeline Runs)
  pipelineRuns: [
    {
      id: "run_pipe_101",
      pipelineId: "pipe_feature_delivery",
      pipelineName: "Feature 全流程交付流水线",
      title: "针对 Issue #101 实现支付网关签名防重放",
      workspace: "G:\\Projects\\auth-service",
      startedAt: "2026-09-16 18:20",
      duration: "6m 57s",
      currentStageIndex: 2, // 0-based
      totalStages: 4,
      currentStageName: "TDD 编码与红绿重构",
      currentAgentRole: "Senior Dev Agent",
      status: "running", // running | waiting_gate | completed | failed
      gatePending: false,
      artifactsCount: 2
    },
    {
      id: "run_pipe_102",
      pipelineId: "pipe_bug_hunter",
      pipelineName: "紧急漏洞排查与热修流水线",
      title: "修复线上 Sentry 报警: JWT Token 解析越界",
      workspace: "G:\\Projects\\auth-service",
      startedAt: "2026-09-16 17:10",
      duration: "4m 12s",
      currentStageIndex: 1,
      totalStages: 3,
      currentStageName: "微创修复",
      currentAgentRole: "Patch Dev",
      status: "waiting_gate",
      gatePending: true,
      artifactsCount: 1
    },
    {
      id: "run_pipe_099",
      pipelineId: "pipe_feature_delivery",
      pipelineName: "Feature 全流程交付流水线",
      title: "重构 SQLite 驱动以支持纯 TS DatabaseSync",
      workspace: "G:\\Projects\\Agent\\harness",
      startedAt: "2026-09-16 14:00",
      duration: "11m 45s",
      currentStageIndex: 3,
      totalStages: 4,
      currentStageName: "测试验证与代码审计",
      currentAgentRole: "QA Auditor",
      status: "completed",
      gatePending: false,
      artifactsCount: 4
    }
  ],

  // 模式A：多角色流水线模板库 (Pipelines)
  pipelines: [
    {
      id: "pipe_feature_delivery",
      name: "Feature 全流程交付流水线",
      desc: "涵盖需求分析、架构设计、TDD编码实现与自动化测试验收的标准工程流水线",
      status: "ready",
      currentStageIndex: 2, // 正在执行第 3 阶段：编码
      stages: [
        {
          id: "stg_req",
          name: "需求分析与规格定义",
          role: "Product & Spec Agent",
          model: "deepseek-reasoner",
          tools: ["read_file", "grep", "ask_user"],
          gatekeeper: true,
          status: "completed",
          duration: "1m 12s",
          outputArtifact: "artifacts/spec-v1.md",
          summary: "已完成用户边界溢出场景梳理，产出 4 条验收规格"
        },
        {
          id: "stg_arch",
          name: "架构设计与接口契约",
          role: "Software Architect Agent",
          model: "deepseek-reasoner",
          tools: ["read_file", "glob", "knowledge_query"],
          gatekeeper: true,
          status: "completed",
          duration: "2m 05s",
          outputArtifact: "artifacts/arch-design.json",
          summary: "选定 BigInt 补丁方案，生成 token-guard 接口类型定义"
        },
        {
          id: "stg_code",
          name: "TDD 编码与红绿重构",
          role: "Senior Dev Agent",
          model: "deepseek-chat",
          tools: ["read_file", "edit_file", "bash", "test_runner"],
          gatekeeper: false,
          status: "running",
          duration: "3m 40s...",
          outputArtifact: "src/auth/token-guard.ts",
          summary: "正在编写针对溢出用例的失败测试并实施代码修复"
        },
        {
          id: "stg_qa",
          name: "测试验证与代码审计",
          role: "QA & Security Auditor",
          model: "deepseek-reasoner",
          tools: ["read_file", "bash", "git_diff"],
          gatekeeper: true,
          status: "pending",
          duration: "-",
          outputArtifact: "reports/audit-report.md",
          summary: "待编码完成后执行全局回归测试与安全边界静态扫描"
        }
      ]
    },
    {
      id: "pipe_bug_hunter",
      name: "紧急漏洞排查与热修流水线",
      desc: "日志采集定位、根本原因推导、精准微创修补与回归验证",
      status: "idle",
      currentStageIndex: 0,
      stages: [
        { id: "s1", name: "根因定位", role: "Bug Hunter", model: "deepseek-reasoner", tools: ["read_file", "grep"], gatekeeper: false },
        { id: "s2", name: "微创修复", role: "Patch Dev", model: "deepseek-chat", tools: ["read_file", "edit_file"], gatekeeper: true },
        { id: "s3", name: "回归验证", role: "Regression QA", model: "deepseek-chat", tools: ["bash"], gatekeeper: false }
      ]
    }
  ],

  // 模式C：BPMN 流程执行实例清单 (Workflow Instances)
  workflowInstances: [
    {
      id: "inst_901a",
      workflowId: "wf_pr_review_deploy",
      workflowName: "GitHub PR 智能评审与自动部署链路",
      triggerSource: "Webhook: PR #482 (alex/fix-overflow)",
      startedAt: "2026-09-16 18:40:02",
      duration: "1m 02s",
      activeNode: "Gateway_CoverageCheck (排他网关)",
      activeNodeType: "exclusiveGateway",
      status: "evaluating", // evaluating | running | suspended | completed | error
      variablesSummary: "prId: #482, coverage: 91.5%, lintErrors: 0",
      passedNodes: 3,
      totalNodes: 7
    },
    {
      id: "inst_902b",
      workflowId: "wf_pr_review_deploy",
      workflowName: "GitHub PR 智能评审与自动部署链路",
      triggerSource: "Webhook: PR #481 (sarah/refactor-router)",
      startedAt: "2026-09-16 18:15:30",
      duration: "3m 45s",
      activeNode: "Task_DeployPreview (预览环境发布)",
      activeNodeType: "serviceTask",
      status: "running",
      variablesSummary: "prId: #481, coverage: 88.0%, approved: true",
      passedNodes: 4,
      totalNodes: 7
    },
    {
      id: "inst_880x",
      workflowId: "wf_contract_audit",
      workflowName: "企业智能合约与合规性双盲审查",
      triggerSource: "Manual: Audit Contract v1.4",
      startedAt: "2026-09-16 16:20:00",
      duration: "8m 10s",
      activeNode: "Gateway_CrossVerify (双盲比对网关)",
      activeNodeType: "exclusiveGateway",
      status: "suspended",
      variablesSummary: "discrepancies: 2, legalRisk: 'Medium'",
      passedNodes: 5,
      totalNodes: 9
    }
  ],

  // 模式C：BPMN 2.0 业务流程定义与实例 (Workflows)
  workflows: [
    {
      id: "wf_pr_review_deploy",
      name: "GitHub PR 智能评审与自动部署链路",
      version: "v2.1",
      standard: "BPMN 2.0",
      sourceFile: "workflows/pr-review-flow.bpmn",
      activeInstances: 1,
      nodesCount: 7,
      variables: {
        prId: "#482",
        author: "alex",
        testCoverage: 91.5,
        lintErrors: 0,
        approvedByLead: true
      },
      currentExecution: {
        instanceId: "inst_901a",
        activeNodeId: "node_eval_coverage",
        history: [
          { node: "StartEvent_1", name: "PR 创建触发", time: "18:40:02", status: "passed" },
          { node: "Task_StaticLint", name: "Agent 静态代码扫描", time: "18:40:15", status: "passed", agent: "Linter Agent" },
          { node: "Task_RunUnitTests", name: "Agent 执行集成测试", time: "18:41:00", status: "passed", agent: "Test Runner Agent" },
          { node: "Gateway_CoverageCheck", name: "排他网关: 覆盖率是否 >= 85%?", time: "18:41:02", status: "evaluating" }
        ]
      }
    },
    {
      id: "wf_contract_audit",
      name: "企业智能合约与合规性双盲审查",
      version: "v1.0",
      standard: "BPMN 2.0",
      sourceFile: "workflows/contract-audit.bpmn",
      activeInstances: 0,
      nodesCount: 9,
      variables: {}
    }
  ],

  // 记忆治理中心数据 (Memory Governance & Reflection)
  memoriesData: {
    // 各工作区存储与反思配置
    workspaceConfigs: {
      "G:\\Projects\\auth-service": {
        storageMode: "sqlite",
        sqlitePathType: "relative",
        sqlitePath: ".harness/auth-memory.sqlite",
        fts5Enabled: true,
        extractionMode: "auto",
        activeModel: "deepseek-chat",
        totalEntries: 28,
        pendingReviewCount: 0,
        lastExtractedAt: "2026-09-17 14:15"
      },
      "G:\\Projects\\Agent\\harness": {
        storageMode: "sqlite",
        sqlitePathType: "relative",
        sqlitePath: ".harness/memory.sqlite",
        fts5Enabled: true,
        extractionMode: "semi-auto",
        activeModel: "claude-3-7-sonnet",
        totalEntries: 42,
        pendingReviewCount: 3,
        lastExtractedAt: "2026-09-17 10:20"
      },
      "G:\\Projects\\gateway-proxy": {
        storageMode: "markdown",
        markdownPath: ".harness/memory.md",
        extractionMode: "auto",
        activeModel: "gpt-4o",
        totalEntries: 14,
        pendingReviewCount: 0,
        lastExtractedAt: "2026-09-16 18:30"
      },
      "global": {
        storageMode: "hybrid",
        embeddingModelId: "bge-m3",
        topK: 5,
        threshold: 0.75,
        extractionMode: "semi-auto",
        totalEntries: 19,
        pendingReviewCount: 1,
        lastExtractedAt: "2026-09-17 09:00"
      }
    },

    // 记忆条目列表 (跨工作区)
    entries: [
      {
        id: "mem_01",
        workspace: "G:\\Projects\\auth-service",
        category: "rule",
        categoryName: "踩坑与规则",
        content: "JWT 密钥必须从 Vault 动态拉取，禁止硬编码在 process.env.JWT_SECRET 中，且每次轮换需保留旧密钥 15 分钟过渡。",
        sourceSessionId: "sess_89f2a4",
        status: "approved",
        createdAt: "2026-09-17 14:15",
        useCount: 12
      },
      {
        id: "mem_02",
        workspace: "G:\\Projects\\Agent\\harness",
        category: "style",
        categoryName: "开发约定",
        content: "所有原生 Node 模块严格采用 node: 前缀（如 node:sqlite, node:child_process），绝对禁用 node-gyp 与 C++ 拓展。",
        sourceSessionId: "sess_77a102",
        status: "approved",
        createdAt: "2026-09-16 11:30",
        useCount: 45
      },
      {
        id: "mem_03",
        workspace: "G:\\Projects\\Agent\\harness",
        category: "gotcha",
        categoryName: "踩坑与规则",
        content: "在 Windows 平台下执行子进程命令时，pwsh 传参引号必须使用双引号包裹，避免反引号转义导致的命令截断。",
        sourceSessionId: "sess_55b881",
        status: "pending_review",
        createdAt: "2026-09-17 09:40",
        useCount: 0
      },
      {
        id: "mem_04",
        workspace: "G:\\Projects\\gateway-proxy",
        category: "pref",
        categoryName: "架构偏好",
        content: "反向代理流式传输必须开启 TCP_NODELAY，同时为上游 SSE 响应禁用缓冲（X-Accel-Buffering: no）。",
        sourceSessionId: "sess_33c909",
        status: "approved",
        createdAt: "2026-09-15 16:50",
        useCount: 19
      },
      {
        id: "mem_05",
        workspace: "global",
        category: "pref",
        categoryName: "用户习惯",
        content: "在提交代码与编写文档时，除非用户明确要求，否则绝对禁止添加表情符号（Emoji）。",
        sourceSessionId: "sess_10a001",
        status: "approved",
        createdAt: "2026-09-14 08:20",
        useCount: 88
      }
    ]
  }
};
