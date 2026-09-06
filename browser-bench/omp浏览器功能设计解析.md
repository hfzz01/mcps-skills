# oh-my-pi（omp）浏览器功能设计解析

> 项目：`github.com/can1357/oh-my-pi`，命令名 `omp`，官网 `omp.sh`
> 性质：Pi（Mario Zechner / badlogic 的 `pi-mono`）的深度 fork，由 Can Bölük（@can1357）维护
> 规模：~55k 行 Rust 核心 + TypeScript，32 个内置工具，MIT

## 0. 一句话概括它的设计

**omp 不把浏览器做成"一堆 `browser_*` 工具 schema"，而是做成一个持久化的浏览器运行时 + 代码执行单元。**

Agent 不是在"调工具"，而是在一个隔离的标签页运行时里**写代码操作句柄**：

```javascript
// 工具层面的形态
browser action:"open"  name:"wiki" url:"https://en.wikipedia.org"
browser action:"run"   name:"wiki" code:"await tab.observe(); await tab.click('text/Log in');"
browser action:"close" name:"wiki" kill:true

// run 单元内部（omp 里已折叠进 eval，可直接 await）
const tab = await browser.open("https://example.com");
const title = await tab.run(() => document.title);
```

官方对 `browser` 工具的定义：

> Puppeteer tabs over headless Chromium, CDP-attached apps, or your own Chrome via the relay.

---

## 1. 工具形态：单工具三段式，不是工具集

整个浏览器能力**只注册一个工具 `browser`**，靠 `action` 分派：

| action | 作用 |
| --- | --- |
| `open` | 创建或复用一个**命名标签页**，返回 tab 句柄 |
| `run` | 在该标签页里执行一段 JS 单元 |
| `close` | 关闭标签页，释放浏览器引用 |

参数（LLM 可见的 schema）：

```
action      open | run | close（必填）
name        标签页名，会话内唯一（必填）
url         open 时的初始 URL
waitUntil   load | domcontentloaded | networkidle0 | networkidle2
headless    覆盖本次启动方式
timeout     本次调用预算（ms，默认 120000）
target      附加到已运行浏览器时的 URL 片段提示
viewport    { width, height, deviceScaleFactor }
dialogs     accept | dismiss（自动处理 JS 弹窗）
code        run 的 JS 函数体
kill        close 时是否终止自己拥有的浏览器进程
```

**命名标签页**是个不起眼但很关键的设计：Agent 可以同时开多个标签页，用名字区分（"wiki" / "console" / "jira"），跨回合复用，不需要每次重新导航。

---

## 2. 四种浏览器来源（kind）

| kind | 机制 | 归属 | 典型用途 |
| --- | --- | --- | --- |
| **headless** | 进程内启动无头 Chromium（`puppeteer-core` + `@puppeteer/browsers`） | owned | 常规自动化、截图 |
| **spawned** | detached 启动指定可执行文件，通过空闲 CDP 端口 attach | owned | **驱动 Electron / 自研桌面应用** |
| **connected** | 连接已有 CDP 端点 | 不拥有，只 disconnect | 复用已开 CDP 的浏览器 |
| **relay** | 经本地 Browser Relay 接管用户正在用的 Chrome | 不拥有，**绝不杀** | **复用登录态，不抢焦点** |

区分"是否拥有"是整个生命周期管理的基石：

- owned（headless / spawned）：最后一个标签页关闭后**自动回收进程**；`kill:true` 立即终止。
- connected / relay：只 disconnect，**永远不关闭用户的浏览器**（`kill` 对它们只等于 disconnect）。

---

## 3. Tab API 全表（26 个能力）

`run` 单元里 `tab` 句柄暴露的完整接口，按用途分组：

**观察（Agent 的"眼睛"）**

| 方法 | 返回 |
| --- | --- |
| `observe({ includeAll, viewportOnly })` | 可交互元素列表 + 视口/滚动信息（详见第 4 节） |
| `ariaSnapshot(selector, opts)` | 带 `ref(eN)` 的 aria 树快照 |
| `screenshot(opts)` | 截图，落盘 + 返回给模型 |
| `extract(format)` | 正文抽取（默认 markdown，基于 Readability） |
| `url()` / `title()` | 当前地址 / 标题 |

**操作**

| 方法 | 说明 |
| --- | --- |
| `click(selector)` | 点击 |
| `type(selector, text)` | 逐字输入（delay 8ms） |
| `fill(selector, value)` | 填值，**智能区分文本类 / textarea / contenteditable**，非可填元素直接报错 |
| `press(key, { selector })` | 按键，可先聚焦某元素 |
| `select(selector, ...values)` | 下拉选择 |
| `uploadFile(selector, ...paths)` | 上传（路径相对会话 cwd 解析） |
| `scroll(dx, dy)` | 滚轮滚动 |
| `drag(from, to)` | 拖拽 |
| `scrollIntoView(selector)` | 滚动到元素（instant + center） |

**导航与等待**

| 方法 | 说明 |
| --- | --- |
| `goto(url, { waitUntil })` | 导航 |
| `waitFor(selector, { timeout })` | 等元素可操作 |
| `waitForSelector(sel, { timeout, visible, hidden })` | 通用选择器等待 |
| `waitForNavigation({ waitUntil, timeout })` | 等导航完成 |
| `waitForUrl(pattern, { timeout })` | 等 URL 匹配（字符串包含或正则，200ms 轮询） |
| `waitForResponse(pattern, { timeout })` | 等网络响应 |

**逃生舱**

| 方法 | 说明 |
| --- | --- |
| `evaluate(fn, ...args)` | 直接执行原始 JS，兜底一切 |
| `id(id)` | 取回 `observe` 缓存的元素句柄 |
| `ref(refId)` | 按 `aria-ref=eN` 解析元素句柄 |
| `page` / `browser` | 原始 Puppeteer 对象，完全不设限 |

`page` 和 `browser` 直接暴露，意味着**这套 API 没有天花板**——任何 CDP 能做到的事，Agent 都能写 JS 做到。

---

## 4. 核心设计：双视图观察机制

这是 omp 浏览器最值得学的部分。它给 Agent 提供**两套并行的"看页面"方式**，而不是二选一。

### 4.1 `observe()` —— 结构化元素清单 + 数字 id

走 Puppeteer 的 `page.accessibility.snapshot({ interestingOnly })`，遍历树后返回：

```javascript
{
  url, title,
  viewport: { width, height },
  scroll: { x, y, width, height, scrollWidth, scrollHeight },
  elements: [
    { id: 1, role: "button", name: "查询", states: [] },
    { id: 2, role: "textbox", name: "订单号", value: "SO-2026", states: ["required"] },
    { id: 3, role: "checkbox", name: "含税", states: ["checked=true"] },
    ...
  ]
}
```

三个关键取舍：

1. **默认只收可交互元素**。判据是 `INTERACTIVE_AX_ROLES`（18 种：button / link / textbox / combobox / listbox / option / checkbox / radio / switch / tab / menuitem / menuitemcheckbox / menuitemradio / slider / spinbutton / searchbox / treeitem），外加「带有 checked / pressed / selected / expanded / focused 任一状态」的节点。要全量需显式 `includeAll: true`。
2. **`viewportOnly` 可只收视口内元素**，长页面先局部观察，省 token。
3. **状态被压成 `states` 数组**（`disabled`、`checked=true`、`required`、`focused`…），而不是一堆布尔字段——省 token 且易读。

同时它会**重置元素缓存并把 id 计数归零**，然后为每个元素 `cacheElement(id, handle)`。所以 `id` 只在**下一次 observe 之前**有效，之后用 `tab.id(n)` 直接拿句柄，不用重新查选择器。

**顺带返回滚动信息**很实用：Agent 不用额外调一次 `evaluate` 就知道页面有多长、当前滚到哪、还能不能往下滚。

### 4.2 `ariaSnapshot()` —— aria 树 + `ref(eN)`

第二条路径：**把 Playwright 官方的 ARIA snapshot 源码打包成 CJS，在页面里跑**，产出带 ref 的树状文本（`ref(e1)`、`ref(e2)`…）。

实现上有两个讲究：

- **求值器在 worker 里构建，不在页面里建**（`new Function` 包一层一次性 module 作用域），所以**页面 CSP 拦不住它**。
- 必须用 `page.evaluate` 打到**主世界（MAIN world）**，因为 Playwright 那套源码把 ref 挂在元素的 `_ariaRef` 扩展属性上，只有主世界能看到。**`window` 上什么都不装**，不留痕。

### 4.3 选择器前缀体系

两套视图对应两套定位方式，都通过字符串前缀区分：

```
aria/        按 aria 语义定位
text/        按文本定位
xpath/       XPath
pierce/      穿透 shadow DOM
aria-ref=eN  aria 快照 ref（Playwright MCP 风格）
aria-ref/eN  同上
ariaref/eN   同上
eN  /  @eN   裸 ref 简写
p-aria/ p-text/ p-xpath/ p-pierce/   旧版前缀，兼容保留
```

解析裸 ref 时校验 `/^e\d+$/`，不匹配就当普通选择器处理。

**还有一道防御**：正则 `PLAYWRIGHT_ONLY_SELECTOR_RE` 会主动拒绝 Playwright 专有语法（`:has-text(`、`:text(`、`:visible`、`:near(`、`:above(` 等），报错提示 Agent 换用受支持的前缀。因为底层是 Puppeteer，这些语法会静默失效——**宁可显式报错，也不让 Agent 在一个永远匹配不到的选择器上空转**。

另外 `assertSelectorString()` 会识别常见误用：如果传进来的是 ElementHandle 或 Promise，报错会直接说破——"是不是漏了 await？用 `(await tab.id(n)).click()` 或传字符串 `aria-ref=eN`"。

### 4.4 为什么两套并存

| | `observe()` | `ariaSnapshot()` |
| --- | --- | --- |
| 输出 | JSON 元素清单 | 缩进文本树 |
| 定位 | 数字 id → `tab.id(n)` | `ref(eN)` 字符串 |
| 优势 | 结构清晰、token 可控、带状态与滚动信息 | 保留层级上下文，适合复杂嵌套组件 |
| 适合 | 表单填写、列表操作等绝大多数场景 | 需要理解 DOM 层级结构的场景 |

一个走**扁平结构化**（省 token、好解析），一个走**层级文本**（保上下文）。两套视图共享同一套 `resolveHandle`，所以混用也没问题。

---

## 5. 三级超时预算体系

这是工程细节里最见功力的地方。它不设一个全局超时，而是**分层下压**：

```
OP_DEADLINE_SLACK_MS      = 1000   // 每个 op 比单元格预算提前 1s 到期
QUICK_OP_TIMEOUT_MS       = 20000  // 观察/截图类
ACTION_OP_TIMEOUT_MS      = 8000   // 点击/输入类
ZERO_MATCH_FAIL_FAST_MS   = 2000   // 选择器零匹配，直接判失败
ZERO_MATCH_POLL_MS        = 250
```

预算推导：

```javascript
budgetBound = max(1, cellTimeoutMs - 1000)
quickOpMs   = min(budgetBound, 20000)
actionOpMs  = min(budgetBound, 8000)
```

三个意图很清楚：

1. **预留 1 秒 headroom**，让 op 级超时**先于**单元格超时触发。这样拿到的是"点击超时了"这种可诊断错误，而不是外层一句笼统的 timeout。
2. **交互类比观察类更短的超时**（8s vs 20s）。点一下没反应，8 秒足够判定失败，没必要干等。
3. **零匹配快速失败**（2s）。选择器写错是最常见的错误，2 秒就告诉 Agent「这个选择器没匹配到可见元素」，而不是耗满预算。

---

## 6. 隔离的标签页运行时

> It drives Chromium or Electron in an isolated tab runtime.

用 Node 的 `worker_threads`：**每个标签页一个独立 worker**。

- 正常路径 `spawnTabWorker()`，失败时退化到 `spawnInlineWorker()`（同进程，仍保持接口一致）。
- 超时或可恢复错误时 `recycleTimedOutWorkerTab()`：terminate 旧 worker → 起新 worker → 重新初始化 → 接管同一个浏览器连接。
- 若新 worker 起来时已开了一个 page，会 `closeAbandonedWorkerPage` 把孤儿页面关掉，避免泄漏。

**价值**：Agent 写的任意 JS 崩了、死循环了、把页面搞坏了，都只影响那一个 worker。浏览器和其他标签页不受牵连，worker 重启即可恢复。这是「让模型直接写代码」这个大胆决定能成立的前提。

---

## 7. run 单元：作用域注入与尾表达式

### 作用域

注入到单元里的东西非常克制：

```
page  browser  tab          —— 浏览器面
display  print  console     —— 输出面
assert  wait  sleep         —— 控制面
```

（omp 原版还有 `read / write / env / tree / tool / agent / parallel / pipeline / phase / log / budget` 等宿主 helper，移植版刻意去掉了，调用即报清晰错误而非 `ReferenceError`。）

### 尾表达式自动返回值

移植自 omp 的 `returnFinalExpression`：用 AST 解析单元代码，**若最后一条顶层语句是表达式语句或显式 `return`**，就改写为 `await __setFinalExpr((expr))`，把值透出给调用方。

工具描述里专门给模型讲清楚了这个语义：

> A run cell reports returnValue only when its last top-level statement is an expression or an explicit `return <expr>`; a cell ending in any other statement omits returnValue entirely, which is normal and not an error.

——**主动预防模型把"没有 returnValue"误判成失败**。这种对模型行为的预判和兜底，贯穿整个设计。

解析失败时不改写、原样执行，让运行时自己报错（不会因为 AST 解析失败就废掉合法代码）。

---

## 8. 截图：像素预算与格式阶梯

不是简单截个图丢给模型，而是有明确的成本约束：

```
默认上限    maxWidth / maxHeight = 1568 px
目标体积    maxBytes = 500 KB
```

降级策略是一条**先降质量、再降尺寸**的阶梯：

1. 元数据探测；
2. resize 到 1568px 内；
3. 在 `png / jpeg / webp` 三种格式里**挑最小的那个**（`webp` 优先，可用 `noWebP` 关闭）；
4. 仍超预算 → 质量阶梯 → 尺寸阶梯，逐步压缩直到达标。

依赖 `sharp`；若 `sharp` 不可用则**原样透传并打一条 warn**，不阻断流程。

**为什么是 1568**：这是 Claude 等视觉模型官方推荐的单图边长上限。说明这套设计是**按真实模型的视觉预算反推的**，而不是拍脑袋。

---

## 9. browser-relay：登录态问题的最优解

`@oh-my-pi/browser-relay` 是一个 **Chrome 扩展 + 本地中继**，让浏览器 API 直接驱动你**已经打开的标签页**。

### 架构

```
Chrome 扩展  ──dial out──>  ws://127.0.0.1:<port>/ext
                            本地 Relay（HTTP + WS）
                              ├─ /json/version  伪装 Chrome CDP discovery
                              ├─ /json/list
                              └─ /cdp           伪装 CDP 端点
Agent ──连接 /cdp──> Relay ──RPC──> 扩展 ──chrome.debugger──> 标签页
```

关键在于**伪装成标准 CDP 端点**。上层 Puppeteer 完全感知不到中间有一层中继，`puppeteer.connect()` 原样工作，整套 Tab API 无差别可用。

### 四个专门的机制

**1. `OMP.claimTarget`** —— 自定义 CDP 域，让 Agent 显式"认领"某个标签页为驱动目标。Relay 收到后记入连接的 claims 集合，并触发分组同步。**未被认领的标签页不会被打扰**。

**2. 标签页分组（tab grouping）** —— 被驱动的标签页自动归入一个可视分组（可配置标题/配色），**让用户一眼看出哪些页面正被 Agent 操作**。实现上有细节：

- 分组 RPC **绝不并发**，走队列串行排空，每批最多 20 个；
- 若标签页**已在用户自己的分组里**，标记 `groupOptOut = true`，**永不重新分组**（尊重用户的组织方式）；
- 用户把标签页拖出分组 → 同样 `groupOptOut`，不再归组。

**3. debugger ban 恢复** —— Chrome 的 `chrome.debugger` 在某些页面会附加失败（扩展页、应用商店等）。Relay 的处理：

- 附加失败 → 标记 `banned = true`，不再重试（避免反复弹权限提示骚扰用户）；
- **页面发生导航 → 自动清除 ban**（新文档，可以再试一次）。

**4. 不抢焦点** —— 官方原话：

> the browser relay can adopt Chrome tabs you already have open **without stealing focus**.

中继转发 `Target.activateTarget` 时才切标签，常规操作不激活窗口。**你在旁边正常用浏览器，Agent 在后台干活**，互不干扰。

### 为什么它比别的方案强

对比常见的登录态处理：

| 方案 | 问题 |
| --- | --- |
| 导出/导入 storage state | 要写文件、时效短、SSO token 经常失效 |
| 让 Agent 走登录流程 | 遇验证码/短信/OTP 就卡死 |
| `--auto-connect` 直连已开 Chrome | 需要浏览器启动时就带 `--remote-debugging-port`，且拿到的是整个浏览器 |
| **browser-relay** | 按需接管单个标签页；登录态天然存在；不抢焦点；绝不杀用户的浏览器 |

对内网普遍存在的 SSO / 验证码 / 短信登录，这是目前见过投入产出比最高的方案。

---

## 10. Stealth 默认开启

> Stealth is on by default.

无侵入部分的实现：`evaluateOnNewDocument` 注入脚本 + UA 覆盖。注入脚本以资源文件形式随包分发（分文件编号，含 navigator 伪装、插件列表伪造、WebGL/权限等项），在文档创建前注入。

这一项 Playwright MCP 默认不带。对有反自动化检测的内网门户是刚需。

---

## 11. 进程生命周期：引用计数 + 三层防泄漏

浏览器进程泄漏是这类工具最常见的翻车点。omp 用了三道防线：

**1. 引用计数**：`registry` 按 key 持有浏览器，计数归零才真正回收。（移植版的 changelog 里就有一条修复：创建后忘了注册进表，导致同 key 重复 open 每次都新起一个 Chromium。）

**2. 会话/插件级清理**：会话销毁（`session/disposed`）时释放该会话创建的标签页；插件卸载时释放全部标签页。

**3. 主动提示模型收尾** ——最有意思的一层：

- 工具描述和 `kill` 参数说明里**反复强调**"最后一次 close 一定要带 `kill: true`"；
- `close` 的返回消息会**明确告知**浏览器是否仍存活（其他标签页还持有）还是已随本标签终止，形成即时反馈；
- 若某回合结束时仍有未关闭的标签页，会**注入一条一次性 user-role 提示**（"仍有 N 个标签未关，收尾请用 kill:true"），不唤醒 driver，只在下一回合被模型看到；同一批只提示一次，全部关闭后复位；可用环境变量关闭，同时打 warn 日志记录泄漏。

**这不是靠模型自觉，而是把收尾动作设计成了会被反复提醒的闭环。**

---

## 12. Chromium 复用策略（对内网极有价值）

需要 headless Chromium 时，按序解析，**全部落空才下载**：

1. `PUPPETEER_EXECUTABLE_PATH` / 指定可执行文件；
2. 系统已安装的 Chrome / Chromium（macOS 除外）；
3. 本包缓存里已有的 Chrome for Testing；
4. **其他工具缓存里已下载的版本 —— 直接复制，不重新下载**：
   `DSH_BROWSER_DONOR_CACHE`、`~/.omp/puppeteer`（oh-my-pi）、`PUPPETEER_CACHE_DIR`、`~/.cache/puppeteer`；
5. 以上都没有，才从 Chrome for Testing 下载。

第 4 步只认 `@puppeteer/browsers` 的缓存布局（`chrome/<platform>-<buildId>/`）。构建号一致直接用，否则取该缓存里最新的一版——**仍然省掉一次下载**。复制整个构建目录并保留可执行位，落到本包缓存后与来源解耦（原工具清理自己的缓存不影响这边）。复制失败则退化为直接启动来源里的二进制。

> 注意：Playwright 的缓存（`chromium-<revision>`）**不在支持范围**——revision 编号无法映射到 Chrome for Testing 的 buildId。

内网环境下，这意味着**只要内网任何一台机器曾经下过 Chromium，其他机器就能复制复用**，不必各自连外网。

---

## 13. 架构演进：浏览器折叠进 eval（2026-09-04）

最新提交 `feat(tools): folded browser and computer into eval`：

> - Replaced standalone tool schemas with session-gated JavaScript and Python preludes.
> - Added direct tab, window, and element handles with approval-aware host calls.
> - Kept browser MCP filtering synchronized with live prelude availability.

含义：`browser` 和 `computer` 不再是独立工具 schema，而是变成 eval 持久化运行时里**预置的编程 API**，通过共享 prelude 注入。配套给了 tab / window / element 的直接句柄，宿主调用带 approval-aware 审批门控。

值得注意的是最后一条——**浏览器 MCP 的过滤与 prelude 的实时可用性保持同步**。说明作者没把工具 schema 这条路堵死，两条路径并存。

---

## 14. 关于本文的资料来源与可信度

omp 仓库体量大（55k+ 行），本次分析采用了两条相互印证的路径：

1. **官方 README**（一手）：工具定位、三种驱动目标、Stealth 默认、relay 不抢焦点、eval 折叠。
2. **`dsh-browser-tool`（npm）源码**（一手代码）：这是一个**核心逻辑从 oh-my-pi browser 工具移植而来**的独立包，随包发布 `lib/`，其源码注释明确标注了移植来源（如 `Ported verbatim from oh-my-pi relay/protocol.ts`、`Ported from oh-my-pi's shared JsRuntime`）。

因此本文中：

- **第 3–8、11–12 节的具体数值与实现细节**，来自移植包源码，**可信度高**，但反映的是 omp 浏览器工具的**设计形态**；
- omp 当前 HEAD 已把浏览器折叠进 eval（第 13 节），**接口形态可能已从独立 `browser` 工具变为 eval prelude API**，但底层机制（Tab API、双视图、超时预算、worker 隔离、relay）应保持一致；
- 移植包明确列出与 omp 的差异：去掉 omp 专属 helper；stealth 只保留无侵入部分；截图用 `sharp` 而非 `Bun.Image`；final-expression 用 `@babel/parser` 而非完整 babel。

---

## 15. 照搬到内网的可抄清单

按投入产出比排序：

| 优先级 | 抄什么 | 为什么 |
| --- | --- | --- |
| **P0** | **browser-relay 思路**（扩展 + 中继，接管已登录标签页，不抢焦点） | 内网系统普遍要 SSO/验证码，这是登录态问题的最优解 |
| **P0** | **双视图观察 + 数字 id / ref 定位** | a11y 路线不依赖视觉模型，适配 GLM-5.2 + qwen3.6-VL 的环境 |
| **P1** | **三级超时预算 + 零匹配快速失败** | 直接决定长流程的稳定性和可诊断性 |
| **P1** | **Stealth 设为默认** | 别等被内网门户拦了再回头加 |
| **P1** | **Chromium 复用（donor cache）** | 内网离线分发成本直线下降 |
| **P2** | **每 tab 一个 worker 隔离** | 模型写 JS 出错时不炸掉整个会话 |
| **P2** | **引用计数 + 回合结束回灌提示** | 消除浏览器进程泄漏 |
| **P2** | **截图 1568px / 500KB 预算 + 格式阶梯** | 视觉侧成本可控 |
| **P3** | **「折叠进 eval」** | 建议**暂缓**：要求模型能写 JS 操作句柄，对弱模型是负担。先走工具 schema 路线 |

### 结合本环境的两条具体建议

1. **不要照抄"写代码"这个形态**。omp 敢让模型直接写 JS，是因为它的目标用户配的是 Claude/GPT 级模型。你的环境是 GLM-5.2，建议保留**工具 schema 调用形态**，只抄它的**底层机制**（双视图观察、超时预算、worker 隔离、relay），把 Tab API 包成显式工具参数暴露给模型。

2. **CDP 是最大公约数**。omp 用 Puppeteer + CDP，agent-browser 直连 CDP，Playwright 最终也落 CDP。内网选型时**优先保证 CDP 通路**（尤其是能连到本机 Edge/Chrome 的 `--remote-debugging-port`），上层引擎随时可换不心疼。

---

*整理时间：2026-09-05*
