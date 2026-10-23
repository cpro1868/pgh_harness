# 2026-10-06 语音播报子系统架构与详细设计 (WBS-Speech)

> 文档标识：`docs/superpowers/specs/2026-10-06-speech-subsystem-design.md`  
> 归属版本：`v0.3.0`  
> 关联决策：`CONTEXT.md` (D76)  
> 目标模块：`MOD-12 语音播报与无障碍交互模块`  
> 参考项目：`reference/dsh-speak`

---

## 1. 背景与业务价值

在大模型编码任务（修 Bug、跑集成测试、重构、流水线运行）中，单次回合执行通常需要数十秒到数分钟。开发者频繁在 IDE、终端与 Harness 页面之间切换。
引入语音播报能力能够让开发者**脱离屏幕监视**，在后台任务结束或智能体产出最终成果时，通过听觉第一时间获悉结论与状态。

---

## 2. 关键架构决策与技术选型 (D76)

- **纯前端 Web Speech API 路线**：
  - 严格恪守总纲八荣八耻与安全铁律：**零 Native 编译、禁用 MSVC/node-gyp、零外部重量级 TTS 服务依赖**；
  - 采用浏览器原生标准 `window.speechSynthesis` 与 `SpeechSynthesisUtterance`，跨 Windows 10/11、macOS、Linux 纯纯同构；
  - 自动探测并优选系统高保真自然中文音色（如 Microsoft Xiaoxiao/Yunxi Natural Voice 或系统中文引擎）。
- **文本清洗分层架构 (Text Cleaning Pipeline)**：
  - 定义在 `@harness/protocol` (`src/speech.ts`)，作为跨端与协议同构的纯函数 `cleanSpeechText(text, options)`；
  - 消除会让语音合成静默失败（Silent Failure）或语调怪异的干扰元素：
    1. 屏蔽代码围栏（替换为「代码块已省略」提示语）；
    2. 剔除 HTML 标签与 Markdown 语法符号（`*`、`_`、`#`、`>`）；
    3. Markdown 链接提取可读文本、剔除裸 URL；
    4. 彻底剔除 Unicode Emoji（`\u{1F300}-\u{1FAFF}` 等）与乱码符号；
    5. 收敛多余回车空行为单空格；
    6. 超长文本截断防护（默认 300 字，防过长疲劳）。
- **单例队列与即时打断 (Interruptible Singleton)**：
  - 前端封装 `PGHSpeech` 单例控制器 (`apps/server/client/js/speech.js`)；
  - 发起新播报前自动 `cancel()` 前置朗读，杜绝语音叠加混乱；
  - 状态响应式广播（`onStateChange`），实时同步顶栏与卡片播放/停止状态。

---

## 3. 详细设计与接口契约

### 3.1 数据契约与存储偏好 (LocalStorage)

```typescript
export interface SpeechSettings {
  enabled: boolean;        // 语音播报总开关
  autoRead: boolean;       // 回合完成是否自动朗读最终回复
  rate: number;            // 语速 (0.5 - 2.0，默认 1.0)
  pitch: number;           // 音调 (0.5 - 1.5，默认 1.0)
  volume: number;          // 音量 (0.0 - 1.0，默认 1.0)
  readInlineCode: boolean; // 是否朗读行内代码
  maxChars: number;        // 单次最大字符截断 (默认 300)
}
```

### 3.2 文本清洗核心算法流程

```mermaid
flowchart TD
    RAW[原始 Markdown 回复文本] --> CODE_BLOCK[剔除 ``` 代码块并替换为占位文本]
    CODE_BLOCK --> HTML[过滤 HTML 标签]
    HTML --> INLINE[处理行内代码 `code`]
    INLINE --> LINK[提取 [标题](链接) 纯标题并剔除 URL]
    LINK --> EMOJI[正则剥离 Unicode Emoji 与特殊符号]
    EMOJI --> WHITESPACE[多换行与多空格折叠为单空格]
    WHITESPACE --> TRUNCATE[超限截断与听觉提示尾缀]
    TRUNCATE --> CLEANED[输出纯净自然可读文本]
```

---

## 4. 界面与交互设计

1. **主会话工作台 (`run-chat.html`)**：
   - 顶栏右侧新增「🔊 语音开 / 🔇 已静音」快速切换按钮，状态持久化到本地存储；
   - 每条 Agent 回答气泡的操作区追加「🔊 朗读」重播按钮；
   - 轮次结束事件（`eventType === 'done'`）且非手动终止时，触发自动播报。
2. **系统设置控制台 (`config-settings.html`)**：
   - 左侧导航追加「🔊 语音播报与朗读偏好」板块；
   - 提供可视化配置开关、语速与音量滑动条；
   - 提供「🔈 试听语音效果」验证按钮。

---

## 5. 验收测试与质量保障

- **TC-01-13 单元测试**：针对 `cleanSpeechText` 覆盖代码块替换、Emoji 过滤、空格收敛与长文本截断；
- **全量门禁**：通过 `pnpm check`（TypeScript 严格收窄、ESLint 零警告、全套件单元测试 100% 绿灯）。
