# Prism · 规格驱动的可交互 HTML 原型铸造台

**定位**：仅在内网环境使用与运行的、从需求文档生成多页面可交互 HTML 原型的方案。
**本方案为独立新建**：不复用、不兼容、不参考、不读取本仓库内任何既有原型工具或既有产物。

---

## 一句话机制

> 模型只写**声明式页面蓝图**（JSON：有哪些区块、用哪个组件、放什么数据、点了去哪、有哪些状态）；
> 一台**零依赖确定性编译器**把蓝图铸造成 HTML。
> 配色、字号、间距、组件形态、交互状态只在「样式宪章 + 组件契约」里写一次，所有页面共享。

所以一致性不是"生成后检查"，而是**编译期不变量**：模型不写 HTML/CSS，就没有"位置画歪、样式用错"的通路；
批量出 100 页也只是同一张模板换数据，天然同源。

---

## 快速开始（内网）

要求：**Node 22+**（用到内置 `fetch` / 全局 `WebSocket`）。不需要 `npm install`，不需要 API key，不需要联网。

```bash
cd prism

# 0. 全链路自检（含 PNG 编解码、提取、展开、校验、铸造、产物检查）
node engine/prism.mjs selftest

# 1. 一次性：从存量系统校准样式宪章（三选一或都用，草案需人工确认）
node engine/prism.mjs charter D:/code/ioc-web/src --kind=repo     # 代码仓变量
node engine/prism.mjs charter 原页面截图.png --kind=image          # 截图色板/分区
node engine/prism.mjs charter --kind=dom --port=9222               # 受控浏览器 computedStyle

# 2. 内网 codeagent 按 docs/04-蓝图规格说明.md 产出 blueprints/*.json
# 3. 批量场景：把需求矩阵展开成 N 份蓝图
node engine/prism.mjs expand

# 4. 编译期校验（组件合法性 / 跳转可达 / 模型白名单 / 结构指纹）
node engine/prism.mjs lint

# 5. 铸造
node engine/prism.mjs compile
```

产出在 `dist/`：

```
dist/
├── index.html                  原型门户（三类场景入口 + 全部页面导航）
├── pages/*.html                16 个独立页面，双击即可打开
├── assets/charter.css          样式宪章（唯一色值/字号/间距来源）
├── assets/components.css       组件形态（只引用宪章变量）
├── assets/runtime.js           交互运行时（动作串解释）
├── manifest.json               页面清单 + 跳转图
└── consistency-report.md       一致性报告（含模型审计与结构指纹）
```

**分发**：把整个 `dist/` 目录拷走即可；`file://` 下直接可用，无网络请求、无后端、无 CDN、无外部字体。
若只想发单页，必须连同 `assets/` 一起发（页面引用相对路径）。

---

## 目录结构

| 路径 | 作用 |
| --- | --- |
| `foundry/charter.css` | **样式宪章**：整套原型唯一允许出现色值、字号、间距、圆角、阴影的地方 |
| `foundry/components.css` | 组件形态，只引用宪章变量；链接器强制扫描，出现色值字面量即编译失败 |
| `foundry/contracts.mjs` | **组件契约**：19 个组件的确定性 render + 合法 props 白名单 |
| `foundry/runtime.js` | 交互运行时：解释蓝图里的动作串，页面里零手写脚本 |
| `engine/compiler.mjs` | 蓝图 → 独立 HTML；所有状态预编译成 DOM 面板 |
| `engine/linker.mjs` | 编译期不变量：组件校验、跳转/状态/弹层可达、模型白名单、样式字段拦截、结构指纹 |
| `engine/expand.mjs` | 需求矩阵 → N 份结构相同的批量蓝图 |
| `engine/extract-*.mjs` | 四类输入通道：代码仓 / 截图 / 受控浏览器 /（组件库见下） |
| `engine/selftest.mjs` | 全链路自检（自己造 PNG 再解码，不依赖外部素材） |
| `engine/verify-browser.mjs` | 真实 Chrome 里 `file://` 打开并实际点击的验收脚本 |
| `blueprints/` | 模型产出物：声明式 JSON，人工不写 HTML |
| `examples/` | 三份示例需求文档、批量需求矩阵、组件库映射、模拟代码仓 |
| `docs/` | 方案边界 / 模型约束 / 三类场景产出 / 蓝图规格说明 |
| `dist/` | **交付物**：可直接打开并操作的多页面原型集合 |

---

## 本机实测结果（Windows / Node 22.22.2 / Chrome headless）

| 验证 | 结果 |
| --- | --- |
| `selftest` 全链路 | 19 项，19 通过 |
| `lint` | 16 份蓝图，error 0 / warning 0 |
| `compile` | 16 页、20 条跳转边、68 个状态面板、299 个区块、53 个输入控件、455 个动作串 |
| 批量一致性 | 12 页结构指纹 `bf10c65a9cf8`，仅 1 种结构 |
| 真实浏览器 `file://` 点击验收 | 18 项，18 通过（跳转 / 输入 / 校验 / 状态切换 / 弹窗 / 变更标记 / 批量一致） |

---

## 方案边界速览

- **做**：需求文档 → 声明式蓝图 → 编译期保证一致的多页面可交互原型；覆盖存量优化、新增功能、批量新增三类场景。
- **不做**：真实后端、生产代码、像素级 1:1 复刻、图像语义识别、模型微调、任何外部 API 调用。
- **模型**：只用 `GLM5.2` / `deepseekv4.1-flash1017` / `MiniMax-M3` / `Qwen3.7-max` / `Qwen3.7-plus`；
  白名单由链接器在编译期强制，工具侧零模型调用。详见 [docs/02-模型使用约束.md](docs/02-模型使用约束.md)。
- **截图**：不交给模型看图，只做确定性像素量化；存量页优先用受控浏览器读 computedStyle。

完整边界见 [docs/01-方案边界.md](docs/01-方案边界.md)，三类场景产出见 [docs/03-三类需求与原型产出.md](docs/03-三类需求与原型产出.md)，
给内网模型看的蓝图写法见 [docs/04-蓝图规格说明.md](docs/04-蓝图规格说明.md)。
