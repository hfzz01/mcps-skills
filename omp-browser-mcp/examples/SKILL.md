---
name: omp-browser
description: 用浏览器打开网页、操作内部系统或后台管理页面时使用。涉及页面导航、表单填写、点击按钮、抓取页面内容、截图核对视觉稿时触发。
---

# 浏览器操作规范

## 铁律

1. **先观察，再操作。** 每次动手前先调用 `browser_observe`。严禁凭猜测直接写 CSS 选择器或 XPath。
2. **用 ref 数字定位。** observe 输出的每一行以 `[数字]` 开头，后续操作直接传 `ref=该数字`。
   元素编号在每次 observe 后会刷新，页面变化后必须重新观察。
3. **必须收尾。** 全部浏览器工作结束后，最后一个 `browser_close` 一定要传 `kill=true`，否则会残留浏览器进程。

## 标准流程

```
browser_open(name="erp", url="...")      # 打开标签页
browser_observe(name="erp")              # 看页面上有什么
browser_fill(name="erp", ref=5, value="SO-2026")
browser_click(name="erp", ref=7)         # 点"查询"
browser_wait_for(name="erp", text="已完成")  # 动态页面要等
browser_observe(name="erp")              # 重新观察拿新编号
browser_extract(name="erp")              # 读结果
browser_close(name="erp", kill=true)     # 收尾
```

## 读取方式按成本排序

| 需求 | 用哪个 |
| --- | --- |
| 要操作元素 | `browser_observe` |
| 要读文字内容 | `browser_extract` |
| 要看视觉样式/布局/配色 | `browser_screenshot` |

**不要为了读文字而截图**——截图成本高出几十倍，而且 GLM 的视觉能力弱于文本能力。

## 常见错误处理

- **"没有匹配到任何元素"** → 重新 `browser_observe`。编号刷新了，或目标元素还没渲染出来（先 `browser_wait_for`）。
- **"不是可填写元素"** → 复选框、单选框、下拉框不用 `browser_fill`；复选框用 `browser_click`，下拉框用 `browser_select`。
- **页面一直加载不出** → 用 `browser_wait_for` 等具体文本出现，不要盲目加长超时。

## 需要登录的系统

**不要让 agent 自己走登录流程**——验证码、短信、OTP 会让它彻底卡死。

改用 connect 模式，接入你已登录的 Chrome：

```
browser_open(name="erp", mode="connect", cdp_url="http://127.0.0.1:9222")
```

前提是用带调试端口的方式启动 Chrome：

```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="%USERPROFILE%\chrome-debug-profile"
```

你手动登录一次，之后 agent 反复接入都带着登录态。close 时即使传 `kill=true`，也只会断开连接，**不会关闭你的 Chrome**。
