# proto-design 使用说明（给 AI 看）

配合 prototype-studio 使用：截图管存量页面，**这个工具管新需求页/改版页**——
让 agent 按存量系统的设计令牌和页面骨架画 HTML，产出后确定性检查过关才能交付。

## 铁律

1. **写页面必须先跑 `new`**：从 `layouts/` 复制骨架起手（list / detail / form / dashboard 四选一），
   禁止从空白文件写。骨架里的 `<!-- 骨架: xxx -->` 标记必须保留，check 靠它确认骨架来源。
2. **每个颜色值必须来自 DESIGN.md 令牌表或基础色**（#ffffff / #000000 / transparent）。
   出现表外色值 = error。拿不准就查 DESIGN.md，**不要猜**。
3. **间距只用阶梯值**（0/2/4/8/12/16/20/24/32/40/48），**字号只用阶梯值**（12/13/14/16/18/20/24）。
4. **布局用 el-row/el-col 栅格**，禁止 `position:absolute`（弹窗遮罩除外）。
5. **组件样式不自己写**：直接用 Element 的 class 结构（`.el-button` / `.el-table` / `.el-form-item` …），
   主题 CSS 由原型站注入。写 Vue 组件标签（`<el-table>`）没有用——原型是纯 HTML，样式挂在 class 上。
6. **交稿前必须跑 check，error 清零才算完成**。有 error 按提示逐条改，改完重跑。
   warning 不阻塞，但要过目。

## 标准流程

```
① tokens <前端仓路径>        # 一次性：从 IOC 前端仓提取设计令牌 → DESIGN.md + tokens.json
② new 页面名 --from=list     # 起手：复制骨架（list/detail/form/dashboard 按页面类型选）
③ 扩写骨架                   # 只往「替换区」填字段和内容，保持间距与结构节奏
④ check 页面名.html          # 合规检查，error 清零
⑤ 放进原型站                 # 文件拷到 prototype-studio 的 live/ 目录，pages.json 加一条 type:"live"
```

## 命令

| 命令 | 作用 |
|---|---|
| `node bin/proto-design.mjs tokens <前端仓路径>` | 提取设计令牌，生成 DESIGN.md + tokens.json（只跑一次，主题改了再跑） |
| `node bin/proto-design.mjs new <页面名> --from=list` | 从骨架复制起手页（list / detail / form / dashboard） |
| `node bin/proto-design.mjs check <html或目录>` | 合规检查；error 清零退出码 0，否则 1 |
| `node bin/proto-design.mjs check <html> --tokens=xxx.json` | 指定令牌文件（默认读当前目录 tokens.json） |

命令一律 `node bin/proto-design.mjs <命令>`，不要用 npx。

## DESIGN.md 是唯一颜色依据

`tokens` 命令扫前端仓的样式变量（`src/assets/style*`、`src/theme` 之类目录里的 SCSS/LESS/CSS 变量）：

- **检测到定制主题**：DESIGN.md 里的颜色就是本系统的真实令牌，全部必须用它。
- **未检测到**：DESIGN.md 用 Element 默认值兜底并明确标注。此时骨架里的灰阶和状态色可以直接用；
  如果用户说系统其实定制过，让用户指出变量文件后重新跑 tokens。
- 基础色 `#ffffff` / `#000000` 任何时候可用；令牌色的 rgba 半透明变体（如遮罩）可用。
- **若系统定制过主题，骨架中的状态色/灰阶要换成 DESIGN.md 对应令牌**（如 `#F56C6C` → danger 令牌、
  `#909399` → text-secondary 令牌）。

## 位置为什么不会跑偏

骨架就是布局锚点：筛选区、操作栏、表格、分页的间距和排布已经按存量系统范式写死，
agent 只填内容不改骨架节奏。同类真实页面的精确度量（区域坐标/尺寸）在
`prototype-studio/work/spec/`（capture 加 `--spec` 导出），画新页前可对照参考。

## 报错怎么处置

| 报错 | 原因 | 下一步 |
|---|---|---|
| `表外色值 #xxx → 建议改用 xxx` | 用了令牌表之外的颜色 | 按建议替换成对应令牌 |
| `间距 xxx 不在阶梯` | margin/padding/gap 用了任意值 | 换成建议的阶梯值 |
| `字号 xxx 不在阶梯` | font-size 任意值 | 12/13/14/16/18/20/24 里选 |
| `缺骨架标记` | 没从骨架起手或删了标记注释 | 重新 `new`，把已写内容搬进替换区 |
| `圆角 xxx 少见`（warning） | border-radius 用了非常见值 | 4px（输入/按钮）或 8px（卡片） |
| `用了 position:absolute`（warning） | 手工绝对定位 | 换 el-row/el-col 栅格 |
| `未找到 tokens.json` | 没跑过 tokens | 先跑 `tokens <前端仓路径>` |
| check 通过但样式难看 | 页面单独打开没有主题 CSS | 页面要在原型站里看（theme.css 已注入），或本地临时引 Element 主题 CSS 预览 |
