# prototype-studio 使用说明（给 AI 看）

把已经在跑的真实系统批量截图，自动生成**可点击、可跳转、可切换状态**的原型站。
产物是一个文件夹（或单个 HTML），双击就能看，不需要联网、不需要起服务。

## 铁律

1. **不要画界面**。所有页面截图必须来自真实系统，禁止自己写 HTML 伪造界面、禁止生成假图。
   唯一例外是 `live` 类型的新需求页（下面第五节）。
2. **不要修改被测系统的代码**。工具是只读地访问系统。
3. 命令一律用 `node bin/proto.mjs <命令>`，**不要用 npx**（内网离线会失败）。
4. 一次只改一处配置，改完立刻重跑验证，不要攒着一起改。
5. 只重采失败的页面：`node bin/proto.mjs capture --only=页面id`。不要动不动全量重跑。

## 标准流程

```
init → routes（可选）→ launch（人工登录）→ probe → capture → build
```

- `launch` 这一步**必须由人来登录系统**（有单点登录、验证码），AI 无法代替。
  执行 `launch` 后要停下来告诉用户："请在刚打开的浏览器里登录系统，登录完成后告诉我"，
  收到用户确认再继续。不要在没登录的情况下直接 capture，截下来会全是登录页。
- 登录完成后先 `probe` 确认能接管，再 `capture`。

## 命令

| 命令 | 作用 |
|---|---|
| `node bin/proto.mjs init` | 生成 pages.json 骨架和 live/ 目录 |
| `node bin/proto.mjs routes <前端src目录>` | 扫 Vue Router 自动生成页面清单 |
| `node bin/proto.mjs launch` | 开一个带调试端口的浏览器，供人工登录 |
| `node bin/proto.mjs probe` | 检查能不能接管浏览器 |
| `node bin/proto.mjs capture` | 批量截图并自动导出热区，产出 work/ |
| `node bin/proto.mjs build` | 生成原型站到 dist/ |
| `node bin/proto.mjs build --single` | 生成单文件版到 dist-single/，可直接发给别人 |

常用参数：`--only=id1,id2` 只采指定页面；`--config=xxx.json` 指定配置文件；`--out=目录` 指定输出目录。

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
  "wait": 1500,
  "ready": ".el-table__row",
  "actions": [
    { "state": "dialog", "click": "text:新增事件", "wait": 600, "back": "text:取消" }
  ],
  "notes": [
    { "t": "查询条件", "d": "时间默认近 7 天", "x": 17, "y": 8 }
  ]
}
```

- `id`：英文短名，全站唯一。
- `url`：相对 baseUrl 的路径，也可以写完整网址。
- `wait`：截图前的等待毫秒数。列表没出来就调大（3000）。
- `ready`：等这个选择器出现再截图，比死等更可靠。可选。
- `actions`：截完默认图后，再点一下元素截一张状态图（弹窗、抽屉、校验报错都这么做）。
  - `state` 用英文短名，会作为状态名显示。
  - `click` 写法：`text:按钮文字`（推荐）或 CSS 选择器。
  - `back`：该状态下点哪个元素回到默认状态，例如弹窗的「取消」。可选。
- `notes`：需求标注。`x`/`y` 是百分比坐标，填了才会在截图上显示气泡；不填只在右侧列表显示。

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

| 报错 | 原因 | 下一步 |
|---|---|---|
| 连不上浏览器调试端口 | 浏览器没带调试端口启动 | 执行 `launch`，或手动加 `--remote-debugging-port=9222` 启动 |
| 没有可接管的页面标签 | 浏览器里没开页面 | 在被调试的浏览器里打开一个页面再跑 |
| 截图全是登录页 | 没登录 | 先 `launch` 让人登录，确认登录成功再 `capture` |
| 某个页面 0 个热区 | 页面没渲染完 | 调大 `wait`，或加 `ready` 选择器 |
| 状态图没截到 | 点击没生效 | `click` 改用更精确的文字，或换成 CSS 选择器；也可以调大 `wait` |
| 找不到 site.json | 还没采集 | 先跑 `capture` 再跑 `build` |
| 截图太大存不下 | 页面超长 | 调小 `shot.maxBytes`，或调小 `shot.maxWidth` |
| 页面报超时 | 系统响应慢 | 调大该页的 `wait`；用 `--only=该页id` 单独重试 |

采集结束后如果提示有页面出错，看 `work/site.json` 里的 `errors` 字段，改完配置用 `--only` 单独重采。

## 交付

- 自己看/放在共享盘：用默认的 `dist/`，整个文件夹一起拷。
- 发给别人（微信、邮件）：用 `build --single`，产出 `dist-single/index.html` 单个文件，直接发。
- 快捷键：`F` 演示模式，`Esc` 退出，`N` 标注开关，`H` 热区开关，`←` 后退。
