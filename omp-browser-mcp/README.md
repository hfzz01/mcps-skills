# omp-browser-mcp

把 **oh-my-pi（omp）** 的浏览器机制，改造成能在 **Claude Code 套壳 + GLM-5.2 + 内网** 环境下直接用的 MCP server。

omp 本体装不了——它要接自己的模型供应商，而你没有外部 API key。但它的浏览器**机制**可以完整搬过来：Claude Code 有 MCP 扩展点，把这套能力做成一个本地 MCP server 注册进去即可。

**依赖只有两个**：`@modelcontextprotocol/sdk` + `puppeteer-core`。不含任何浏览器二进制，运行时自动找本机已装的 Chrome / Edge。

---

## 一、相对 omp 做了哪些改造

| 维度 | omp 原设计 | 本实现 | 改动原因 |
| --- | --- | --- | --- |
| 调用形态 | 在 eval 运行时里**写代码**操作句柄 | **原子工具 + ref 数字定位** | GLM-5.2 写 JS 操作句柄容易出错；数字 ref 远比拼选择器可靠 |
| 元素定位 | `aria-ref=e5` / `tab.id(5)` 字符串 | observe 输出 `[5]`，直接传 `ref: 5` | 弱模型用数字最稳，无需记忆语法 |
| 观察 | Playwright ARIA 源码打包进页面跑 | 自包含页面内 DOM 遍历，零外部资产 | 可完全离线，不依赖 Playwright 资产文件 |
| 浏览器来源 | headless / spawned / connected / relay | **headless / connect** | relay 需要装 Chrome 扩展，内网推行成本高；connect 走系统 Chrome + CDP 即可复用登录态 |
| 登录态 | browser-relay 扩展接管 | **CDP 接入用户已登录的 Chrome** | 效果接近，零安装，且内网机器本就装了 Chrome/Edge |
| 浏览器分发 | Chrome for Testing + donor cache | **优先复用本机 Chrome/Edge**，找不到才用缓存 | 内网免分发二进制 |
| 收尾提醒 | 回合结束注入 user-role 提示 | **每次响应尾部回灌提醒** | MCP 无法注入消息，改为在工具返回值里提醒 |

**保留的 omp 设计**：三级超时预算（零匹配 2s 快速失败）、owned 与不拥有的区分（绝不杀用户浏览器）、Stealth 默认开启、截图 1568px/500KB 像素预算、引用计数回收、报错信息可操作化。

---

## 二、安装

### 从 GitHub 拉取

本工具位于 `hfzz01/mcps-skills` 仓库的 `omp-browser-mcp/` 子目录。

```bash
# 方式 A：稀疏克隆，只拉这一个目录（推荐，最快）
git clone --depth 1 --filter=blob:none --sparse https://github.com/hfzz01/mcps-skills.git
cd mcps-skills
git sparse-checkout set omp-browser-mcp
cd omp-browser-mcp
npm install
```

```bash
# 方式 B：整仓克隆
git clone --depth 1 https://github.com/hfzz01/mcps-skills.git
cd mcps-skills/omp-browser-mcp
npm install
```

> 想用 `npx -y github:hfzz01/omp-browser-mcp` 一条命令直接跑的话，需要**单独建一个同名仓库**——npm 的 GitHub 简写不支持子目录。目前没这么做，是因为它更适合作为 mcps-skills 的一部分。

> 仓库**故意不提交 `package-lock.json`**：内网 npm 通常指向内部镜像，lock 文件会把包地址锁死在公网 registry，反而导致安装失败。

### 装完自检

```bash
# 直接启动 server：不报错就说明依赖完整（stdio 模式，Ctrl+C 退出）
node src/index.js
```

若报 `Cannot find package 'proxy-agent'` 之类的模块缺失，说明 `npm install` 时被杀毒软件/安全策略拦掉了部分文件——**这不是包本身的问题，删掉 `node_modules` 重装即可**。

### 分发给内网其他机器

```bash
# 1. 在已装好的机器上打包（含 node_modules）
tar czf omp-browser-mcp.tgz omp-browser-mcp/

# 2. 内网机器解压即用，无需联网、无需下载浏览器
tar xzf omp-browser-mcp.tgz
node omp-browser-mcp/src/index.js
```

> 关键点：`puppeteer-core` 不含浏览器二进制，运行时会自动找**本机已安装的 Chrome / Edge**。内网机器只要装了其中之一，就不需要分发任何浏览器文件。
> 查找顺序：环境变量指定 → 系统 Chrome/Edge → 其他工具已下载的缓存（`~/.agent-browser`、`ms-playwright`、`~/.cache/puppeteer`）。

---

## 三、注册到 Claude Code

### 方式一：命令行（推荐）

```bash
claude mcp add omp-browser -- node "E:/CODE/mcps-skills/omp-browser-mcp/src/index.js"
```

### 方式二：项目级配置文件

在项目根目录创建 `.mcp.json`（会随项目分发，团队共享）：

```json
{
  "mcpServers": {
    "omp-browser": {
      "command": "node",
      "args": ["E:/CODE/mcps-skills/omp-browser-mcp/src/index.js"],
      "env": {
        "OMP_BROWSER_HEADLESS": "1",
        "OMP_BROWSER_CDP_URL": "http://127.0.0.1:9222"
      }
    }
  }
}
```

### 方式三：用户级（所有项目可用）

写入 `~/.claude.json` 的 `mcpServers` 段，或用：

```bash
claude mcp add --scope user omp-browser -- node "E:/CODE/mcps-skills/omp-browser-mcp/src/index.js"
```

> 虽然内网 npx 可用，注册 MCP 仍建议指向**本地绝对路径**：npx 方式每次启动都要重新解析包，冷启动明显更慢；绝对路径是最稳也最快的。

### 验证

在 Claude Code 里执行 `/mcp`，应看到 `omp-browser` 已连接，工具列表 13 个。

---

## 四、给 GLM-5.2 配一份使用约束（重要）

弱模型容易「不看页面就瞎点」。把下面内容存成 `.claude/skills/omp-browser/SKILL.md`（项目级）或 `~/.claude/CLAUDE.md`（全局），能显著提升成功率：

```markdown
---
name: omp-browser
description: 用浏览器操作网页、内部系统、后台管理页面时使用。
---

# 浏览器操作规范

1. **先观察再操作**：每次操作页面前先调用 browser_observe，拿到元素编号。
   严禁凭猜测直接写 CSS 选择器或 XPath。
2. **用 ref 定位**：observe 输出每行以 `[数字]` 开头，后续操作直接传 ref=该数字。
   元素编号在每次 observe 后会刷新，页面变化后必须重新观察。
3. **优先用便宜的读取方式**：读文字用 browser_extract，操作元素用 browser_observe。
   只有在需要看视觉样式、布局、配色时才用 browser_screenshot。
4. **动态页面要等待**：点击后如果页面异步加载，先 browser_wait_for 等目标文本出现，再观察。
5. **必须收尾**：所有浏览器工作结束后，最后一个 browser_close 必须传 kill=true，
   否则会残留浏览器进程。
6. **需要登录的系统**：改用 connect 模式接入用户已登录的 Chrome，
   不要让 agent 自己走登录流程——验证码和短信会卡死。
```

---

## 五、工具清单（13 个）

| 工具 | 用途 |
| --- | --- |
| `browser_open` | 打开/复用命名标签页（headless 或 connect） |
| `browser_observe` | 观察页面，返回可交互元素 + 数字 ref |
| `browser_click` | 点击 |
| `browser_type` | 逐字输入 |
| `browser_fill` | 整体填值 |
| `browser_press` | 按键 |
| `browser_select` | 下拉选择 |
| `browser_goto` | 导航 |
| `browser_wait_for` | 等文本/元素/URL |
| `browser_screenshot` | 截图（零依赖压缩到 1568px/500KB） |
| `browser_extract` | 抽取正文纯文本 |
| `browser_evaluate` | 兜底执行 JS |
| `browser_close` | 关闭标签页 |

---

## 六、两种模式

### headless（默认）

agent 自己启动独立浏览器，用完即毁。适合公开页面、无需登录的任务。

```
browser_open(name="wiki", url="https://...")
```

### connect（内网带登录系统的关键）

接入**你自己已登录的 Chrome**，共享 profile 从而天然带登录态。

**准备**：用带调试端口的快捷方式启动 Chrome（**建议 IT 统一分发这个快捷方式**，一次配置长期有效）：

```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="%USERPROFILE%\chrome-debug-profile"
```

**使用**：

```
browser_open(name="erp", mode="connect", cdp_url="http://127.0.0.1:9222")
```

三个要点：

- 你手动登录一次，之后 agent 反复接入都带着登录态，**不用导出 cookie，也不用让 agent 走登录流程**（验证码/短信/OTP 会卡死 agent）。
- 可用 `target` 参数接管某个已打开的特定标签页（传 URL 片段）；留空则新开标签页。
- **close 时即使传 kill=true，也只会断开连接，绝不关闭你的 Chrome**——这一点已写进代码和返回值，并在测试里验证过。

### 为什么内网优先选 connect 而非让 agent 自己登录

| 方案 | 问题 |
| --- | --- |
| 导出/导入 storage state | 要写文件、时效短、SSO token 经常失效 |
| 让 agent 走登录流程 | 遇验证码/短信/OTP 必卡死 |
| **CDP 接入已登录 Chrome** | 登录态天然存在，零维护 |

---

## 七、环境变量（全部可选）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `OMP_BROWSER_EXECUTABLE` | 自动探测 | 显式指定浏览器可执行文件 |
| `OMP_BROWSER_CDP_URL` | `http://127.0.0.1:9222` | connect 模式默认端点 |
| `OMP_BROWSER_HEADLESS` | `1` | 设 `0` 时 headless 模式也显示窗口（便于人工观察） |
| `OMP_BROWSER_STEALTH` | `1` | Stealth 默认开启，设 `0` 关闭 |
| `OMP_BROWSER_SCREENSHOT_DIR` | 不落盘 | 截图保存目录 |
| `OMP_BROWSER_ACTION_TIMEOUT_MS` | `8000` | 交互类超时 |
| `OMP_BROWSER_QUICK_TIMEOUT_MS` | `20000` | 观察/等待类超时 |
| `OMP_BROWSER_ZERO_MATCH_MS` | `2000` | 选择器零匹配快速失败 |
| `OMP_BROWSER_OBSERVE_LIMIT` | `60` | 单次 observe 元素上限 |
| `OMP_BROWSER_MAX_IMAGE_EDGE` | `1568` | 截图边长上限 |
| `OMP_BROWSER_MAX_IMAGE_BYTES` | `512000` | 截图体积目标 |
| `OMP_BROWSER_REMIND` | `1` | 设 `0` 关闭收尾提醒 |

---

## 八、测试

```bash
# 起一个本地测试站点
python -m http.server 8099 --bind 127.0.0.1

# 完整流程冒烟（headless）
node test/smoke.mjs

# connect 模式（接管已登录浏览器）
node test/connect.mjs
```

两个测试均已在 Windows + Node 22 + Chrome 152 上验证通过，覆盖：MCP 握手、工具列表、观察、文本定位点击、ref 填值、等待、正文抽取、截图压缩、错误提示、进程回收、以及「kill 不杀用户浏览器」这条安全语义。

---

## 九、已知边界

- **不支持 file:// 协议**。内网处理本地 HTML 请起 HTTP 服务（这是 CDP 侧的通用限制）。
- **不支持多标签页并发操作同一浏览器上下文**（引用计数是串行的，设计如此）。
- **无 browser-relay 的「不抢焦点」能力**。connect 模式下 agent 操作会激活标签页；需要并行人工操作时，可另开一个 Chrome 实例专供 agent 使用。
- **shadow DOM 默认不穿透**，需要时给 observe 传 `pierce: true`。
- **截图压缩是零依赖的**：尺寸用 CDP 的 `deviceScaleFactor` 缩放（截完立刻还原），体积用 webp/jpeg 质量档位递减。上游 omp 用 sharp 做这件事，这里刻意去掉了——sharp 会带 19MB 的平台二进制，是内网分发里最重的一块。代价是压缩率略逊于 sharp（同一张图 29KB vs 28KB，可忽略）。

---

## 十、与 omp 的对应关系（便于后续跟进上游）

| omp 概念 | 本实现位置 |
| --- | --- |
| 四种 kind 与引用计数 | `src/browser.js` |
| `observe()` / `ariaSnapshot()` 双视图 | `src/observe.js`（`view: list \| tree`） |
| `resolveHandle` + 选择器前缀 | `src/actions.js`（`text/`、`aria/`、`xpath/` 走 Puppeteer 内置 handler） |
| 三级超时预算 | `src/config.js` + `src/actions.js` |
| Stealth | `src/browser.js` → `stealthScript()` |
| 截图像素预算 | `src/screenshot.js` |
| Chromium 复用 | `src/config.js` → `resolveExecutable()` |
| 回合结束回灌提醒 | `src/index.js` → `reminder()` |

上游若在 `browser` 折叠进 eval 后有新机制，可对照这张表增量移植。
