# mcps-skills

内网自用的工具与教程集合。**所有方案都以「不依赖任何外部 API key 或云端服务」为前提**——这是本仓库存在的理由。

| 目录 | 内容 |
|---|---|
| [`omp-browser-mcp/`](omp-browser-mcp/) | 浏览器自动化 MCP server：a11y 观察 + 数字 ref 定位 + CDP 接管已登录浏览器 |
| [`prototype-studio/`](prototype-studio/) | 原型站生成器：批量截取真实系统 + 自动导出热区，产出可跳转可交互的原型站（零第三方依赖） |
| [`multica-ioc-req-squad/`](multica-ioc-req-squad/) | Multica 需求小队设计：五个通用能力单元 + 配置驱动的流程控制，内网自托管可直接装配 |
| [`opendesign-codeagent3-tutorial/`](opendesign-codeagent3-tutorial/) | Open Design 接入 codeagent3.0 的两条方案（伪装 codebuddy / 自定义适配器），含排坑清单 |

## 环境前提

- 内网 npm registry 可用：`npm install` / `npx` 正常拉包。**要 API key 才有问题，不是不能联网装包**
- 浏览器类工具一律用 `puppeteer-core` 复用机器上已有的 Chrome/Edge，**不分发浏览器二进制**
- 不往仓库塞二进制、模型文件或 >10MB 的资产

## License

MIT
