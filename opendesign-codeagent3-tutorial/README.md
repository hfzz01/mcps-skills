# Open Design 接入 codeagent3.0 教程

> 适用场景：内网环境、无任何模型 `baseUrl` / `apiKey`，只有一个 Claude Code 套壳的 CLI
> （codeagent3.0，内置 GLM-5.2），想把 Open Design 用作 AI 生成原型的工作台。
>
> 核心思路：**不碰模型层**。Open Design 的 BYOK 需要真实 API 凭证，此路不通；
> 但它支持把外部 agent CLI 注册为运行时（runtime）——把 codeagent3.0 接进去，模型调用
> 全部由套壳自己完成。

## 目录

| 文件 | 内容 |
|---|---|
| [README.md](README.md) | 本文件：原理、前置准备、兼容性验证 |
| [方案A-伪装codebuddy.md](方案A-伪装codebuddy.md) | 推荐首选。约 5 分钟，零代码，环境变量即可 |
| [方案B-自定义适配器.md](方案B-自定义适配器.md) | 更正式。几十行代码写一个本地适配器，可提 PR 进上游 |
| [排坑清单.md](排坑清单.md) | 安装/运行已知坑位与处理办法 |

## 为什么是这条路

Open Design（nexu-io/open-design）的 agent 适配器是**纯数据对象**（`RuntimeAgentDef`），
2026-06 合并的 PR #3961 内置了 **Codebuddy 适配器**——Codebuddy 本身就是"stream-json 兼容
Claude Code 的套壳 CLI（模型含 GLM）"，与 codeagent3.0 同构。所以接入方式有两种：

1. **方案 A**：用适配器自带的 `CODEBUDDY_BIN` 环境变量，把二进制指到 codeagent3.0，
   让 Open Design 把它当 codebuddy 调用。
2. **方案 B**：在 `apps/daemon/src/runtimes/defs/` 写一个专属适配器，复用现有的
   `claude-stream-json` 解析器，作为一等公民出现在 agent picker 里。

两条路**都不需要** `ANTHROPIC_API_KEY`、`baseUrl` 或任何模型凭证。

## 前置准备

### 1. 安装 Open Design

```bash
git clone https://github.com/nexu-io/open-design.git
cd open-design
corepack enable
pnpm install
pnpm tools-dev run web     # 前台跑 daemon + web
```

- **Node 必须 24**（Node 22 起不来）。可用 `export PATH="/path/to/node24:$PATH"` 前置。
- 浏览器开 `http://localhost:3000`；daemon API 在 `http://127.0.0.1:7456`。
- 首次启动若没检测到任何 CLI 会弹 **BYOK 欢迎框——直接关掉，不要填 key**（你也没有）。

### 2. 确认 codeagent3.0 可执行文件路径

codeagent3.0 通常不在 PATH 里，先找到实际路径（下文以 `<CA3>` 代指）：

```bash
where codeagent3.0     # 或在安装目录里找 .cmd / .exe
```

### 3. 验证 headless 兼容性（决策点）

```bash
<CA3> -p "hi" --output-format stream-json
<CA3> --version
```

| 现象 | 结论 |
|---|---|
| 输出 claude 风格 stream-json 事件流（`system` / `assistant` / `result`） | **方案 A 可行**，直接去 [方案A](方案A-伪装codebuddy.md) |
| 只有纯文本输出 | 走 **方案 B**，`streamFormat: 'plain'` |
| 不支持 `-p` headless | 先找套壳的等价参数（Claude Code 系一般是 `-p` / `--print`）；实在没有则任何 runtime 都无法调度它 |

## 决策速查树

```
codeagent3.0 支持 -p + stream-json？
├─ 是 → 方案 A（CODEBUDDY_BIN，5 分钟）→ 不够用再升级方案 B
├─ 只有纯文本 → 方案 B，streamFormat 用 'plain'
└─ 不支持 headless → 先确认套壳的等价参数，否则无法被任何 runtime 调度
```

## 接入成功的标志

```bash
curl -s http://127.0.0.1:7456/api/agents
```

对应条目 `available: true`，且 `executablePath` 指向 codeagent3.0 的真实路径；
Web UI 顶部 agent picker 里能选中它并跑通一个原型生成任务。

## 相关背景

- Open Design 的设计灵感来源里明确写着 multica，"不自己跑模型、只编排现有 agent CLI"
  是这类项目共通的架构；公共插座标准是 ACP（Agent Client Protocol）。
- 如果未来想让 codeagent3.0 同时接入 Zed / JetBrains / Multica / Vibe Kanban，
  一次性的正确投入是给它包一层 ACP server，之后所有支持 ACP 的平台全部通吃。
