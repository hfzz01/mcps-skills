# Prism 一致性报告

生成时间：2026-11-07T09:30:29.034Z

## 一、单一事实源

| 项 | 值 |
| --- | --- |
| 样式宪章 charter.css 哈希 | `27becad3059bfb20` |
| 宪章变量数 | 64 |
| 组件契约 contracts.mjs 哈希 | `4179855a9ef0c1d7` |
| 契约组件数 | 19（pageHead、notice、filterBar、toolbar、dataTable、statGrid、chartGrid、descList、form、steps、tabs、sceneBar、emptyState、loadingState、successState、diffNote、compare、panel、timeline） |
| components.css 色值字面量 | 0（链接器已强制校验） |
| 页面内联样式 | 仅允许引用 var()，模型输出中无样式字段 |

所有页面引用同一份 `assets/charter.css` 与 `assets/components.css`，
配色 / 字号 / 间距 / 圆角 / 组件形态由文件路径强制同源，页面无法覆盖。

## 二、编译期校验结果

| 校验项 | 结果 |
| --- | --- |
| 蓝图 error 数 | 0 ✓ 清零 |
| 蓝图 warning 数 | 0 |
| 组件引用合法性 | ✓ 全部命中契约白名单 |
| 页面跳转可达性 | ✓ 全部目标存在 |
| 状态 / 弹层可达性 | ✓ 全部可达 |

## 三、产出规模

| 指标 | 数量 |
| --- | --- |
| 页面 | 16 |
| 场景 / 状态面板 | 68 |
| 区块实例 | 299 |
| 表单 / 输入控件 | 17 / 53 |
| 交互动作串 / 跳转 | 455 / 68 |
| 弹层 | 17 |
| 按场景 | existing-optimization 2 页 · new-feature 2 页 · batch 12 页 |

## 四、模型使用审计（编译期白名单）

允许清单：GLM5.2 / deepseekv4.1-flash1017 / MiniMax-M3 / Qwen3.7-max / Qwen3.7-plus。蓝图若声明清单外模型，编译直接中止。

| 模型 | 产出蓝图数 |
| --- | --- |
| Qwen3.7-max | 1 |
| GLM5.2 | 1 |
| Qwen3.7-plus | 1 |
| deepseekv4.1-flash1017 | 1 |
| MiniMax-M3 | 12 |

工具侧不调用任何模型；模型只在内网 codeagent 会话里把需求文档转成声明式蓝图，
输出中若混入任何色值 / 字号 / 间距描述，链接器同样判为 error。

## 五、批量一致性（结构指纹）

结构指纹 = 对「场景 → 区块序列 → 组件名 + props 键」做 SHA256，**不含任何数据值**。
批量组要求所有页面指纹相同：数据不同、结构必须一致。

| 批量组 | 页数 | 不同结构数 | 指纹 | 结论 |
| --- | --- | --- | --- | --- |
| special-ledger | 12 | 1 | `bf10c65a9cf8` | ✓ 完全一致 |

## 六、页面清单

| 页面 id | 标题 | 场景 | 状态数 | 结构指纹 |
| --- | --- | --- | --- | --- |
| asset-ledger | 资产台账 | existing-optimization | 6 | `a4a5b4bdbdbc` |
| asset-detail | 资产详情 | existing-optimization | 4 | `8df4d0675d36` |
| inspection-plan | 智能巡检编排 | new-feature | 6 | `04f829850ba8` |
| inspection-result | 巡检结果看板 | new-feature | 4 | `7c613b0b16b6` |
| ledger-station | 站点资产台账 | batch | 4 | `bf10c65a9cf8` |
| ledger-transformer | 主变设备台账 | batch | 4 | `bf10c65a9cf8` |
| ledger-sensor | 传感设备台账 | batch | 4 | `bf10c65a9cf8` |
| ledger-network | 网络设备台账 | batch | 4 | `bf10c65a9cf8` |
| ledger-cabinet | 控制柜台账 | batch | 4 | `bf10c65a9cf8` |
| ledger-power | 电源设备台账 | batch | 4 | `bf10c65a9cf8` |
| ledger-line | 输电线路台账 | batch | 4 | `bf10c65a9cf8` |
| ledger-meter | 计量装置台账 | batch | 4 | `bf10c65a9cf8` |
| ledger-protect | 保护装置台账 | batch | 4 | `bf10c65a9cf8` |
| ledger-comm | 通信设备台账 | batch | 4 | `bf10c65a9cf8` |
| ledger-spare | 备品备件台账 | batch | 4 | `bf10c65a9cf8` |
| ledger-tool | 工器具台账 | batch | 4 | `bf10c65a9cf8` |

---

结论：布局、配色、字号、间距、组件形态、交互状态均由编译期不变量约束；
模型只产出声明式蓝图，不产出任何 HTML/CSS，因此不存在「模型画歪」的通路。
