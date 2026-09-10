# prototype-studio 使用说明（给 AI 看）

把已经在跑的真实系统批量截图，自动生成**可点击、可跳转、可切换状态**的原型站。
产物是一个文件夹（或单个 HTML），双击就能看，不需要联网、不需要起服务。

## 铁律

1. **不要画界面**。所有页面截图必须来自真实系统，禁止自己写 HTML 伪造界面、禁止生成假图。
   唯一例外是 `live` 类型的新需求页（下面第六节）。
2. **不要修改被测系统的代码**。工具是只读地访问系统。
3. 命令一律用 `node bin/proto.mjs <命令>`，**不要用 npx**。
4. 一次只改一处配置，改完立刻重跑验证，不要攒着一起改。
5. 只重采失败的页面：`node bin/proto.mjs capture --only=页面id`。不要动不动全量重跑。
6. **页面清单以 discover 为准**。`routes` 静态扫描只能看到源码里写死的路由，
   动态注入的路由、参数页它都看不见。只有 discover 不可用（菜单结构非标准）时才退回 routes。

## 标准流程

```
init → launch（人工登录）→ discover（自动发现页面）→ 人工检查 pages.json → capture → build
```

- `launch` 这一步**必须由人来登录系统**（有单点登录、验证码），AI 无法代替。
  执行 `launch` 后要停下来告诉用户："请在刚打开的浏览器里登录系统，登录完成后告诉我"，
  收到用户确认再继续。不要在没登录的情况下直接 discover/capture，抓到和截到的会全是登录页。
- 登录完成后先 `probe` 确认能接管，再 `discover`。
- `discover` 会逐个点击左侧菜单（约 1-2 分钟），拿到每个页面的真实 URL（含 query 参数）。
- **discover 跑完必须停下让用户过一遍 pages.json**：删掉不需要的页面、改中文分组名，
  确认后再 capture。

## 命令

| 命令 | 作用 |
|---|---|
| `node bin/proto.mjs init` | 生成 pages.json 骨架和 live/ 目录 |
| `node bin/proto.mjs discover` | 在已登录的浏览器里运行时发现页面，写入 pages.json |
| `node bin/proto.mjs discover --no-click` | 只读取不点击菜单（更快，但拿不到带 query 的真实地址） |
| `node bin/proto.mjs routes <前端src目录>` | 静态扫描 Vue Router（备选，抓不全动态路由） |
| `node bin/proto.mjs launch` | 开一个带调试端口的浏览器，供人工登录 |
| `node bin/proto.mjs probe` | 检查能不能接管浏览器 |
| `node bin/proto.mjs capture` | 批量截图并自动导出热区，产出 work/ |
| `node bin/proto.mjs build` | 生成原型站到 dist/ |
| `node bin/proto.mjs build --single` | 生成单文件版到 dist-single/，可直接发给别人 |

常用参数：`--only=id1,id2` 只采指定页面；`--config=xxx.json` 指定配置文件；`--out=目录` 指定输出目录。

## discover 帮你解决了什么

- **动态菜单**：后端返回、`addRoutes` 注入的路由，运行时全部可见（菜单 DOM 的
  `index` 属性 + Vue Router 运行时实例 + 逐个点击菜单拿真实地址，三个来源合并）。
- **参数页**：`/event/detail/:id` 这种页面会被自动填上真实 id（从列表页的链接里抠），
  变成 `url: "/event/detail/{{seed1}}"`，vars 里带着真实值，capture 时能直接打开。
- **链接去重**：列表页 20 行数据的详情链接只算 1 个页面（真实值存在 vars 的 auto1 里），
  不会把页面清单撑爆。

pages.json 里的 `vars` 就是这些真实参数值，格式：

```json
"vars": {
  "seed1": { "from": "/event/list", "pattern": "", "value": "EVT20260001" }
}
```

- `value` 有值就直接用；没有值就访问 `from` 页面现场抠。
- `pattern` 是正则（带捕获组），想自己指定从哪种链接里抽值时才填。

## 数据太少 / 空列表怎么办（mock）

测试环境经常只有两三条数据，甚至空列表，截出来没法评审。在 pages.json 里开 mock，
工具会在浏览器层把接口响应**拦下来放大或替换**，后端不用动：

```json
"mock": {
  "enabled": true,
  "dir": "mocks",
  "mode": "auto",
  "amplify": { "factor": 6, "max": 20, "variants": true },
  "match": ["/api/", "/service/"],
  "record": true,
  "rules": []
}
```

- `amplify`：把真实响应里的列表数组复制 N 份，主键改写、名称加序号、分页 total 同步。
  测试环境有 2 条就能变 12 条。这是最常用的，**先试这个**。
- `rules`：整体替换。`[{ "contains": "event/list", "file": "event-list.json" }]`，
  在 `mocks/event-list.json` 里放一份完整响应 JSON（可以从 record 的产物改）。
- `record: true`：把真实响应存到 `mocks/` 目录，改一改就能当 rules 的替换文件用。
- `match`：只拦 URL 含这些串的请求，避免误伤静态资源。

capture 结束时会打印「接口拦截：放大 N 个」的汇总，确认生效。
**注意**：放大只改截图里的数据，不影响真实系统。

## pages.json 怎么写

顶层字段：

```json
{
  "title": "IOC 综合运营平台",
  "subtitle": "需求分析 · 可交互原型",
  "baseUrl": "http://10.x.x.x:8080",
  "browser": { "host": "127.0.0.1", "port": 9222, "keyword": "IOC" },
  "viewport": { "width": 1920, "height": 1080 },
  "shot": { "maxWidth": 1568, "maxBytes": 500000 },
  "hotspots": { "includeCandidates": false },
  "vars": {},
  "mock": { "enabled": false },
  "out": { "dir": "work", "dist": "dist" },
  "themeCss": "D:/code/ioc-web/node_modules/element-ui/lib/theme-chalk/index.css",
  "pages": []
}
```

`browser.keyword`：标签标题或网址里包含这个词时优先接管，避免抓错标签页。
`themeCss`：把前端仓里的 Element UI 主题 CSS 填进来，新需求页就会跟真系统长得一样。找不到就删掉这行，不影响其他功能。

pages 数组里每一条：

```json
{
  "id": "evt-list",
  "title": "事件列表",
  "group": "事件管理",
  "url": "/event/list",
  "wait": 800,
  "ready": "",
  "readyText": "",
  "minRows": 3,
  "networkIdle": 700,
  "actions": [
    { "state": "dialog", "click": "text:新增事件", "wait": 600, "back": "text:取消" }
  ],
  "notes": [
    { "t": "查询条件", "d": "时间默认近 7 天", "x": 17, "y": 8 }
  ]
}
```

- `id`：英文短名，全站唯一。
- `url`：相对 baseUrl 的路径，也可以写完整网址；支持 `{{变量名}}` 占位符（见 vars）。
- `wait`：截图前的额外等待毫秒数。默认已等网络静默，一般不用调大。
- `ready`：等这个选择器出现再截图。可选。
- `readyText`：等页面出现这段文字再截图（如「共 12 条」）。可选。
- `minRows`：等表格至少渲染出 N 行。数据加载慢时比 wait 可靠；配合「数据太少的处置」
  一节，行数不够时会提示开 mock。可选。
- `networkIdle`：等请求静默的毫秒数（默认 700，即 0.7 秒没有新请求才开始截）。
  图表页可以调大到 2000。设 0 关闭。
- `actions`：截完默认图后，再点一下元素截一张状态图（弹窗、抽屉、校验报错都这么做）。
  - `state` 用英文短名，会作为状态名显示。
  - `click` 写法：`text:按钮文字`（推荐）或 CSS 选择器。
  - `back`：该状态下点哪个元素回到默认状态，例如弹窗的「取消」。可选。
- `notes`：需求标注。`x`/`y` 是百分比坐标，填了才会在截图上显示气泡；不填只在右侧列表显示。

**热区是自动生成的**：`a[href]` 与页面清单对上就变成跳转；菜单/面包屑等没有 href 的元素
按文本对页面标题匹配；列表里指向同一详情页的不同 id 链接会归到同一个详情页。

## 新需求页（live 类型）

截图里不存在的全新页面，用可交互 HTML 写：

1. 在 `live/` 下写一个 HTML 片段（不需要 html/body 标签，写内容和 style、script 即可）。
2. 在 pages.json 里加一条：

```json
{ "id": "dispatch", "title": "智能派单（新增需求）", "group": "事件管理",
  "type": "live", "file": "live/dispatch.html", "notes": [] }
```

3. 任意元素加 `data-go="目标页面id"` 即可跳转到别的页面，例如：

```html
<button data-go="evt-list">返回事件列表</button>
```

live 页里的 style 和 script 都会正常生效。

## 报错怎么处置

| 报错 / 现象 | 原因 | 下一步 |
|---|---|---|
| 连不上浏览器调试端口 | 浏览器没带调试端口启动 | 执行 `launch`，或手动加 `--remote-debugging-port=9222` 启动 |
| 没有可接管的页面标签 | 浏览器里没开页面 | 在被调试的浏览器里打开一个页面再跑 |
| 截图全是登录页 | 没登录 | 先 `launch` 让人登录，确认登录成功再 `discover`/`capture` |
| **discover 一个页面都没发现** | 未登录 / 接管错标签 / 菜单结构非标准 | 依次排查：登录态 → `probe` 看接管了谁 → 退回 `routes` 静态扫描 |
| **静态扫描漏页面（动态菜单、参数页）** | 路由来自后端或 addRoutes | 用 `discover` 替代 `routes`；参数页的 id 由 discover 自动从列表页抠 |
| **capture 提示 {{xxx}} 没取到值** | vars 里对应的变量缺 value 且 from 页面抠不到 | 手工在 vars 里补 `"value": "真实id"`（从浏览器里复制一个） |
| **截图里列表是空的 / 只有几条** | 测试环境没数据 | 开 `mock`（见「数据太少」一节），amplify 先行 |
| 日志出现「只有 N 行数据（期望 M 行）」 | 数据不足或加载慢 | 数据真的少就开 mock；加载慢就调大 `minRows` 的等待（`readyTimeout`） |
| 某个页面 0 个热区 | 页面没渲染完 | 确认 mock/数据没问题后，加 `ready` 或 `readyText` |
| 状态图没截到 | 点击没生效 | `click` 改用更精确的文字，或换成 CSS 选择器；也可以调大 `wait` |
| 找不到 site.json | 还没采集 | 先跑 `capture` 再跑 `build` |
| 截图太大存不下 | 页面超长 | 调小 `shot.maxBytes`，或调小 `shot.maxWidth` |
| 页面报超时 | 系统响应慢 | 调大该页 `readyTimeout`；用 `--only=该页id` 单独重试 |

采集结束后如果提示有页面出错，看 `work/site.json` 里的 `errors` 字段，改完配置用 `--only` 单独重采。

## 交付

- 自己看/放在共享盘：用默认的 `dist/`，整个文件夹一起拷。
- 发给别人（微信、邮件）：用 `build --single`，产出 `dist-single/index.html` 单个文件，直接发。
- 快捷键：`F` 演示模式，`Esc` 退出，`N` 标注开关，`H` 热区开关，`←` 后退。
