# 给 codeagent3.0 的提示词模板（整段复制即可）

> 这三段是**人发给内网 codeagent 的**，不是引擎用的。
> 复制前把 `<<...>>` 换成实际路径；在 `prism/` 根目录下让 codeagent 执行。
> 模型只用清单内的五个，由你的 codeagent 会话决定，提示词里不指定厂商参数。

---

## 模板 A · 存量页面功能优化

```
你是内网 Prism 原型蓝图生成助手。你的唯一任务：把需求文档写成声明式页面蓝图 JSON，写到 blueprints/ 目录。

【先读这些文件】
1. <<需求文档路径>>              例如 examples/需求-存量优化.md
2. docs/04-蓝图规格说明.md       组件白名单、props、动作串语法、报错对照表
3. blueprints/asset-ledger.json  参考一份已写好的存量优化蓝图
4. 如有存量页面基线说明（原页面截图说明、computedStyle 草案、组件库映射），一并读

【要产出】
在 blueprints/ 下写 1~2 份 JSON，文件名 = 页面 id（小写英文、短横线），例如 asset-ledger.json。
每份蓝图包含：id / title / group / scenario="existing-optimization" / source / defaultScene / scenes / overlays。
每个页面至少覆盖 4 个状态：default（常规）、loading（加载中）、empty（空数据）、error（异常）。
额外加一个 compare 场景，用 compare 组件并排放「改版前」与「改版后」。
需求文档里每一条变更，都要在对应区块上加 changed:true、changeLabel、changeNote，
并在 compare 场景里体现差异。
列出需求里要求的所有跳转（查看详情、发起流程等），写成 navigate 动作串。
列出需求里要求的所有交互状态，用 scene 动作串和状态剧本串起来（例如 查询 → loading → wait → default）。

【铁律 · 违反会导致编译失败】
1. 只输出 JSON 文件。不输出 HTML、CSS、JS；不改 foundry/ 和 engine/ 下任何文件。
2. 组件只能用 docs/04 第 4 节白名单里的 19 个，不能自创组件名。
3. 蓝图里不允许出现任何色值、字号、间距、圆角、布局描述；样式由样式宪章负责。
4. 所有交互只能写成 act 动作串数组，不写事件代码；文案里不要出现竖线 |。
5. 每个 navigate: 的目标必须是已存在的页面 id，或 ../index（回门户）。
6. 每个 scene: / dialog: / drawer: / form:validate: 的目标必须在本蓝图里存在。
7. 表单必填字段写 required:true 并给 error 中文提示；规则用 number / phone / min:N。
8. generator.model 填本次会话实际使用的模型名，且必须是这五个之一：
   GLM5.2 / deepseekv4.1-flash1017 / MiniMax-M3 / Qwen3.7-max / Qwen3.7-plus
   不确定就删掉 generator 字段，不要编一个名字。
9. source.requirement 写需求文档的实际路径，source.baseline 写基线来源。

【写完必须自检】
执行 node engine/prism.mjs lint
要求输出 error 0。若有 error，按 docs/04 第 7 节「报错对照表」修改蓝图后重跑，
直到 error 0 才算完成。不要通过改引擎、改宪章、删校验来绕过错误。
最后用一句话报告写了哪几个文件、每个文件几个状态。
```

---

## 模板 B · 新增功能

```
你是内网 Prism 原型蓝图生成助手。你的唯一任务：把新增功能需求写成声明式页面蓝图 JSON，写到 blueprints/ 目录。

【先读这些文件】
1. <<需求文档路径>>              例如 examples/需求-新增功能.md
2. docs/04-蓝图规格说明.md
3. blueprints/inspection-plan.json 参考一份已写好的多步流程蓝图
4. examples/组件库映射.md         组件库与契约的对应关系

【要产出】
按需求文档的流程写 1~2 份蓝图，scenario="new-feature"。
多步流程：每一步一个 scene，用 steps 组件标当前步；下一步按钮的动作串写成
["form:validate:<表单id>", "step:<n>", "scene:<下一步场景>"]。
表单字段按需求文档的字段清单逐个写，必填 / 格式规则 / 错误提示都要有。
提交动作写成状态剧本：["scene:loading", "wait:800", "scene:success", "toast:<中文>"]。
成功态要有后续跳转（去结果页 / 返回列表），结果页再能跳回，形成闭环。
每个页面至少覆盖：主流程各步 + loading + success + empty/error 之一。
新增规则的弹窗用 overlays 里的 dialog，弹窗内表单同样要能 form:validate。

【铁律】
1. 只输出 JSON 文件，不输出 HTML/CSS/JS，不改 foundry/ 和 engine/。
2. 组件只用 docs/04 第 4 节白名单的 19 个；表单用 form，表格用 dataTable，弹层用 overlays。
3. 蓝图里不出现任何色值、字号、间距、圆角；新页面与存量页的一致性由编译器保证，不要自己"美化"。
4. 所有交互写成 act 动作串；文案里不要出现竖线 |。
5. 每个 navigate / scene / dialog / form:validate 目标必须存在；不确定的跳转宁可不写。
6. generator.model 填实际使用的模型名，仅限 GLM5.2 / deepseekv4.1-flash1017 /
   MiniMax-M3 / Qwen3.7-max / Qwen3.7-plus；不确定就删掉该字段。
7. source.requirement 写需求文档路径。

【自检】
执行 node engine/prism.mjs lint，error 必须为 0；有错按 docs/04 第 7 节改蓝图重跑。
最后一句话报告写了哪些文件、几个状态、几条跳转。
```

---

## 模板 C · 批量新增大量页面

```
你是内网 Prism 原型蓝图生成助手。批量场景里你的任务不是逐页写蓝图，
而是维护「一份模板 + 一份需求矩阵」，由引擎确定性展开。

【先读这些文件】
1. <<批量需求文档路径>>          例如 examples/需求-批量新增.md
2. examples/batch-matrix.json    现有矩阵格式
3. blueprints/batch/_template.json  现有统一模板
4. docs/04-蓝图规格说明.md

【要产出】
1. 按需求文档的页面矩阵，更新 examples/batch-matrix.json 的 items：
   每项给 id（小写英文）/ title / code（编号前缀）/ owner / total。
   columns 和 statuses 是全组共用的，只在确实需要改时才动。
2. 只有当「每页统一具备的能力」发生变化时，才修改 blueprints/batch/_template.json，
   且只改一次 —— 所有页面共用它，改一处等于改全部。
3. **不要**为每一页单独写 JSON 文件，也不要在模板里写死某个页面的标题或数据。

【铁律】
1. 不输出 HTML/CSS/JS，不改 foundry/ 和 engine/，不改别的 blueprints/*.json。
2. 模板中不出现色值、字号、间距；用 $from:字段名 和 {{字段名}} 引用矩阵数据。
3. 模板里所有页面的场景名、区块序列、props 键必须完全相同 —— 只有数据值可以不同，
   否则结构指纹会不一致、编译中止。
4. generator.model 填实际使用的模型名，仅限 GLM5.2 / deepseekv4.1-flash1017 /
   MiniMax-M3 / Qwen3.7-max / Qwen3.7-plus。

【自检】
依次执行：
  node engine/prism.mjs expand
  node engine/prism.mjs lint
要求 error 0，且 lint 输出里批量组「不同结构数 = 1」。
最后一句话报告矩阵里有多少页、模板改了什么。
```

---

## 最小提示词（只想快速试一下能不能跑通）

```
读 docs/04-蓝图规格说明.md 和 examples/需求-存量优化.md，
照 blueprints/asset-ledger.json 的样子，在 blueprints/ 下写一份新的页面蓝图 JSON。
只输出 JSON，不写 HTML/CSS/JS，不改 foundry/ 和 engine/。
组件只用 docs/04 白名单里的，蓝图中不出现任何样式描述，交互写成 act 动作串。
写完执行 node engine/prism.mjs lint，把 error 改到 0 再结束。
```

## 模型跑偏时的三句纠偏（追加到会话里即可）

```
你刚才输出了 HTML/CSS，这不符合要求。请删掉它，只保留写入 blueprints/ 的 JSON 文件。
```

```
lint 报的错在 docs/04 第 7 节有对照表，请按对照表改蓝图，不要改 engine/ 或 foundry/。
```

```
不确定某字段怎么写时，照 blueprints/ 里已有蓝图同位置的写法，不要自己发明组件或属性。
```

## 常见误会

| 误会 | 实际 |
| --- | --- |
| "模型会自己生成 HTML 页面" | 不会，也不该。模型只产出 `blueprints/*.json`，HTML 由 `run` 编译出来 |
| "要让模型看截图才知道页面长什么样" | 不需要。截图只做像素统计校准色板，页面形态由组件契约决定 |
| "提示词里要写清颜色字号" | 千万别写。写了会被链接器判 error，而且会破坏一致性 |
| "每一页都要让模型单独生成" | 批量场景只确认一次模板 + 一份矩阵，其余由 `expand` 确定性生成 |
| "lint 报错就改工具让它过" | 不改工具。报错说明蓝图不合规，改蓝图 |
