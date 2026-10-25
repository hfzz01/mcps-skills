# proto-design

原型页设计规范工具：**从存量前端仓提取设计令牌，对 AI 生成的原型页做确定性合规检查**。

解决的问题：让 codeagent 直接画原型时，产出普遍存在两个毛病——
**位置不对**（布局凭想象，没有骨架和度量锚点）和**样式不对**（不按存量系统的设计令牌，
写一堆 Element 默认色和任意间距）。

思路是三层：

1. **立规矩** —— `SKILL.md` 写死铁律（禁表外色值、必须从骨架起手、间距字号只用阶梯值）
2. **给锚点** —— `tokens` 命令从存量仓提取真实设计令牌产出 `DESIGN.md`；
   `layouts/` 提供四种按 Element 真实 DOM 结构写的页面骨架（列表/详情/表单/看板）
3. **做校验** —— `check` 命令确定性扫描生成页：表外色值、间距越阶、字号越阶、缺骨架标记，
   **error 清零才算完成**，不依赖模型自觉

零第三方依赖，Node 20+，`npm install` 都不需要。

## 用法

```bash
# 一次性：从 IOC 前端仓提取设计令牌（有定制主题提定制值，没有就退 Element 默认并标注）
node bin/proto-design.mjs tokens D:/code/ioc-web

# 起手：从骨架复制一个页面
node bin/proto-design.mjs new evt-list --from=list

# （agent 往替换区填内容）

# 交付前：合规检查，error 清零才算完成
node bin/proto-design.mjs check evt-list.html
```

给 AI 用时把 `SKILL.md` 喂给它——那是写给 codeagent3.0 + GLM-5.2 的操作说明。

## 与 prototype-studio 的关系

不替代，补位：

- `prototype-studio` 的 capture/build/mock 继续管**存量页面**（截图 + 热区 + 原型站壳）
- `proto-design` 管**新需求页 / 改版页**：agent 按规矩生成 → check 过检 →
  文件放进 prototype-studio 的 `live/` 目录，作为 live 页进原型站
  （`themeCss` 注入 Element 主题，`#/页面/状态` 跳转协议完全一致）

```
截图（存量页）──┐
                ├── prototype-studio build ──→ 可交互原型站
live 页（新需求页，proto-design 产出）──┘
```

## 目录

```
proto-design/
  bin/proto-design.mjs   CLI：tokens / check / new
  src/tokens.mjs         令牌提取（SCSS/LESS/CSS 变量扫描 + Element 默认兜底）
  src/check.mjs          确定性合规检查
  layouts/               页面骨架：list / detail / form / dashboard
  SKILL.md               给 AI 看的操作说明（铁律 + 流程 + 报错处置）
  test/                  模拟前端仓 + 正反例页面
```

## 检查项一览

| 级别 | 项 | 说明 |
|---|---|---|
| error | 表外色值 | 不在 DESIGN.md 令牌表/基础色，附最近令牌替换建议 |
| error | 间距越阶 | margin/padding/gap 不在 {0,2,4,8,12,16,20,24,32,40,48} |
| error | 字号越阶 | font-size 不在 {12,13,14,16,18,20,24} |
| error | 缺骨架标记 | 没有 `<!-- 骨架: xxx -->` |
| warning | position:absolute | 栅格布局应用 el-row/el-col |
| warning | 圆角少见 | 一般 4px（输入/按钮）或 8px（卡片） |

## 设计取舍

- **提炼物 > 源码**：不让 agent 直接读存量页面源码（几百行里布局约束不到 20 行，噪音稀释注意力），
  而是喂提取出来的 DESIGN.md（令牌）和骨架（布局范式），信息密度高一个量级。
- **确定性校验 > 模型自觉**：色值/间距/字号是可静态判定的，用脚本检查 100% 可靠，
  弱模型跳不过这道门。
- **骨架即锚点**：Element 的样式挂在真实 DOM 结构的 class 上（原型是纯 HTML 没有 Vue），
  骨架按 Element 真实 DOM 写，位置与范式直接继承存量系统，agent 只填内容。
- 渲染对比闭环（视觉模型比对截图反馈修正）留作后续：前三层上了仍有明显偏差再上，先小页试点。
