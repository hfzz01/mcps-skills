# 方案 B：本地 profile 自定义适配器（更正式）

## 原理

Open Design 的 agent 适配器是**纯数据对象**（`RuntimeAgentDef`），官方文档明说
"加一个 CLI 是 one-file change，无需改引擎"。关键在于 `streamFormat` 字段——
直接填 `"claude-stream-json"` 就能**复用引擎现有的解析器**，零引擎改动。
用户本地 profile 由 `local-profiles.ts` 的 `readLocalAgentProfileDefs` 合并进
`AGENT_DEFS`，正是为这种扩展准备的。

社区先例：Codebuddy、Trae、Kimi CLI 都是这样进的主库，接受度高。

## 步骤

### 1. 参照现有适配器新建 def 文件

在 `apps/daemon/src/runtimes/defs/` 下参照 `claude.ts` 或 `codebuddy.ts`，
新建 `codeagent3.ts`，关键字段：

```ts
// RuntimeAgentDef 关键字段（字段名以仓库内当前类型定义为准）
bin: "codeagent3",                    // daemon 会在 PATH / 搜索目录里探测这个名字
fallbackBins: ["codeagent3.0"],
versionArgs: ["--version"],
streamFormat: "claude-stream-json",   // 复用现有解析器，零引擎改动
buildArgs: (prompt, imagePaths, extraDirs, opts) =>
  ["-p", prompt, "--output-format", "stream-json" /*, 按需追加 */],
promptViaStdin: true,                 // 视套壳支持情况；不支持则走 argv 传 prompt
fallbackModels: [{ id: "glm-5.2", name: "GLM-5.2" }],
```

字段说明：

| 字段 | 作用 |
|---|---|
| `bin` / `fallbackBins` | 二进制探测名，多个备选名按顺序试 |
| `versionArgs` | 版本探测参数，探测失败会被标 `missing` |
| `streamFormat` | 输出解析器选择；套壳输出 claude 风格就选 `claude-stream-json`，纯文本选 `plain` |
| `buildArgs` | 每次 spawn 时构造参数，prompt/图片/目录都在这里拼 |
| `fallbackModels` | UI 上显示的模型名（实际由套壳内部决定，这里只是展示） |

### 2. 注册进 registry

两种方式任选：

- **改代码**：把 def 注册进 `registry.ts` 的 `BASE_AGENT_DEFS`（改源码，升级会冲突）；
- **用户 profile（推荐）**：按官方 local-profile 机制放置，由
  `local-profiles.ts` 合并，不动上游代码，git pull 不受影响。

### 3. 重启验证

```bash
pnpm tools-dev restart
curl -s http://127.0.0.1:7456/api/agents
```

agent picker 里出现独立条目（名字、模型名都按你的 def 显示）即成功。

### 4. （可选）提 PR 进上游

def 是 one-file change，社区已有 Codebuddy、Trae、Kimi 等同款先例，
把 `codeagent3.ts` 加上文档改动即可提 PR，合入后所有人开箱即用。

## 调试技巧

- daemon 日志里能看到 spawn 的完整命令行，拿这条命令手动在终端重放，
  最快定位参数/输出格式问题。
- 如果套壳的 stream-json 事件与 claude 有方言差异（比如事件名不同），
  先检查是否只是缺字段——很多套壳只是少发了某个事件类型，解析器一般能容忍；
  真不兼容再考虑 fork 解析器或加一层转换。
- `--version` 输出格式怪异导致探测失败时，检查 def 里是否有输出校验逻辑可绕过。

## 与方案 A 的对比

| | 方案 A（CODEBUDDY_BIN） | 方案 B（自定义适配器） |
|---|---|---|
| 开发量 | 0 | 几十行 |
| 显示名 | "codebuddy" | 可自定义为 codeagent3.0 / GLM-5.2 |
| 参数定制 | 无 | buildArgs 完全可控 |
| 升级影响 | 无（环境变量） | 走 profile 则无 |
| 适用 | 快速验证、轻度使用 | 长期使用、团队推广、提 PR |

建议路径：先用方案 A 跑通验证链路 → 确认值得长期用再上方案 B。
