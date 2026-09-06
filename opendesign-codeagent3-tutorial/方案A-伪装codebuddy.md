# 方案 A：CODEBUDDY_BIN 伪装（推荐，约 5 分钟）

## 原理

Open Design 的 Codebuddy 适配器（PR #3961，2026-06 合并）自带
**`CODEBUDDY_BIN` 环境变量**，官方支持覆盖二进制路径——设置后 daemon 的探测和 spawn
都走你指定的可执行文件。而 Codebuddy 的调用方式就是 Claude Code 的
`-p` + `--output-format stream-json`，"Claude Code 套壳"天然兼容这套调用。

也就是说：Open Design 以为自己在调 codebuddy，实际跑的是你的 codeagent3.0，
模型调用由套壳内置的 GLM-5.2 完成，全程不需要任何 API key。

## 步骤

### 1. 先做兼容性验证（如果还没做）

```bash
<CA3> -p "hi" --output-format stream-json
```

必须输出 claude 风格的 stream-json 事件流。不满足请转
[方案B-自定义适配器.md](方案B-自定义适配器.md)。

### 2. 设置环境变量并重启 daemon

在启动 daemon 的同一个 shell 里设置（或写入系统环境变量后重启）：

```bash
# bash / git-bash
export CODEBUDDY_BIN="E:/实际路径/codeagent3.0.exe"
pnpm tools-dev restart

# PowerShell
$env:CODEBUDDY_BIN = "E:\实际路径\codeagent3.0.exe"
```

### 3. 验证识别

```bash
curl -s http://127.0.0.1:7456/api/agents
```

应看到 codebuddy 条目：`streamFormat` 正常、`available: true`、
`executablePath` 指向你的二进制。

### 4. 试跑

Web UI（`http://localhost:3000`）顶部 agent picker 里选它，丢一个原型生成任务，
观察任务流式输出是否正常。

## 渐进验证技巧（本机装有真 codebuddy 时）

先**不设** `CODEBUDDY_BIN`，确认 Open Design + 真 codebuddy 的链路能通
（前提是 codebuddy 能登录腾讯平台）；链路通了再设 `CODEBUDDY_BIN` 换成 codeagent3.0。
这样出问题时能快速定位是"Open Design 配置问题"还是"套壳兼容性问题"。
如果内网连不上 codebuddy 平台，跳过这步直接换 BIN。

## 常见问题

| 现象 | 处理 |
|---|---|
| `available: false` / missing | `curl 127.0.0.1:7456/api/agents` 看 `executablePath` 是否指对；`--version` 探测失败也会标 missing，确认 `<CA3> --version` 退出码为 0 |
| 环境变量不生效 | 必须在 daemon 进程的环境里。dev 模式下重启 daemon 所在 shell；系统级设置后注销重登最稳 |
| 任务卡住无输出 | 套壳可能对 `--output-format` 参数报错，看 daemon 日志里 spawn 的完整命令行，手动重放排查 |
| 认证状态异常 | Codebuddy 适配器可能探测 codebuddy 的配置目录；若套壳配置目录结构不同，转方案 B 写专属适配器 |

## 什么时候升级到方案 B

- 需要自定义参数构造（如额外传 `--model`、系统提示词、工作目录白名单）
- 套壳的 stream-json 与 claude 有方言差异，需要 tweak 解析行为
- 想让它在 agent picker 里显示为独立条目（而不是顶着 "codebuddy" 的名字）
- 想给上游提 PR，成为官方支持的一等适配器

满足任一条 → [方案B-自定义适配器.md](方案B-自定义适配器.md)
