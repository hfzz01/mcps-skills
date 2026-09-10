# prototype-studio

从**已经在跑的真实系统**批量截图，自动生成可点击、可跳转、可切换状态的原型站。

给做需求分析的人用的：已有页面不必重画，真实截图就是最好的原型素材；只有新增和改版的页面才需要真正"画"。

## 为什么不做成别的样子

| 常见做法 | 问题 |
|---|---|
| 用 Axure / Penpot 把系统重画一遍 | 几十个页面，画到天荒地老，还必然失真 |
| AI 看图生成 HTML | 内网视觉模型弱，生成结果跟真系统对不上，没法拿去评审 |
| 直接给开发看线上系统 | 讲不清变更点，也没有需求标注 |
| mock 掉接口跑一套假前端 | 交互是真的，但成本高一个量级，且要能跑起来 |

这个工具的思路：**能截的截，截不到的才画**。截图负责保真，热区负责跳转和交互，标注负责讲需求。

## 快速开始

```bash
cd prototype-studio

# 1. 生成配置骨架
node bin/proto.mjs init

# 2. 开一个浏览器，人工登录系统（有单点登录，只能人来）
node bin/proto.mjs launch

# 3. 运行时发现页面：动态菜单、参数页自动识别，
#    /detail/:id 这类页面会自动从列表页抠真实 id 填充
node bin/proto.mjs discover

# 4.（可选）测试环境数据太少？开 mock：把 2 条数据放大成 12 条
#    在 pages.json 里把 mock.enabled 改成 true

# 5. 批量截图 + 自动导出热区（等数据加载完才截，不会截到空骨架）
node bin/proto.mjs capture

# 6. 生成原型站
node bin/proto.mjs build
```

打开 `dist/index.html` 即可。要发给别人就用 `node bin/proto.mjs build --single`，产出一个自包含的 `dist-single/index.html`。

> 如果是让 codeagent / AI 来跑，把 `SKILL.md` 一起给它，那份是写给 AI 看的。

## 产物长什么样

- 左侧页面树，按分组组织，可搜索
- 中间是真实截图，鼠标移到可点区域会显示说明，点击跳转或切换状态
- 顶部状态条：弹窗、抽屉、校验报错都是同一页面的不同状态，点一下就切
- 右侧标注层：字段规则、校验逻辑、边界态，评审时关掉、给开发时打开
- 演示模式（`F`）隐藏所有面板，适合投屏讲
- `data-go="页面id"` 让可交互页跳回任意页面

## 目录结构

```
prototype-studio/
  bin/proto.mjs       命令行入口
  src/cdp.mjs         极简 CDP 客户端（零依赖）
  src/browser.mjs     浏览器发现与启动
  src/capture.mjs     批量截图 + 自动热区
  src/routes.mjs      Vue Router 扫描
  src/build.mjs       原型站生成
  src/template/       原型站页面模板
  examples/demo-site/ 样例产出：双击里面的 index.html 就能看到成品长什么样
  SKILL.md            给 AI 看的操作说明
  test/               本地自测用的样站与示例配置
```

运行后生成：`work/`（截图与中间数据）、`dist/`（原型站）、`dist-single/`（单文件版）。

## 几个设计取舍

- **零第三方依赖**。只用 Node 内置的 fetch 和 WebSocket 跟浏览器对话，不装 npm 包，
  避开内网 registry 抽风、依赖装一半的问题。需要 Node 20+。
- **不分发浏览器**。复用机器上已装的 Chrome / Edge，用 CDP 接管你已经登录好的标签页，
  绕开单点登录和验证码。绝不会关掉不属于自己的浏览器窗口。
- **热区自动导出**。截图时把可点击元素的坐标和文本一起抓下来，`a[href]` 能对上页面清单的
  自动变成跳转热区，不用手动画框。
- **坐标存百分比**。换个屏幕尺寸、重新截一次图，热区位置依然对得上。
- **file:// 可直接打开**。数据走 `data.js` 的 script 标签引入，绕开本地文件 fetch 的跨域限制。

## 常见问题

**截图是登录页** —— 没登录。执行 `launch`，在打开的浏览器里登录完再 `discover`/`capture`。

**路由抓不全（菜单是后端下发的、页面靠参数区分）** —— 别用静态扫描，跑 `discover`：
在已登录的浏览器里直接问系统"你都有哪些页面"，动态菜单和参数页都能拿到，
`/detail/:id` 会自动填上真实 id。

**截图里列表是空的、只有两三条数据** —— 在 pages.json 里开 `mock`，工具会在浏览器层
把接口响应拦下来放大（2 条变 12 条，主键、名称、分页数同步改写），也可以用自己写的
JSON 整体替换。后端不用动。

**热区太少或没有** —— 页面没渲染完。加 `ready` 选择器或 `readyText`；列表页配
`minRows`，等数据真正加载完才截。

**弹窗状态没截到** —— `actions.click` 没点中。换成更精确的文字，或直接写 CSS 选择器。

**想让新页面跟系统长得一样** —— 在 pages.json 里配 `themeCss`，指向前端仓
`node_modules/element-ui/lib/theme-chalk/index.css`，手写的新需求页就会套上同一套样式。

**页面太多想分批** —— `capture --only=id1,id2` 只采指定页面。

## 许可证

MIT
