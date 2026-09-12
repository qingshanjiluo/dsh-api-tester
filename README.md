# dsh-api-tester

DeepSeek Harness 插件：单次 HTTP 请求执行 + API 测试集合离线校验。所有 HTTP 走可注入的 fetch 缝隙（默认 Node 全局 fetch），测试与工具内部逻辑不触网。

## 安装

```bash
npx -y @deepseek-ai/dsh plugin --profile web add @qingshanjiluo/dsh-api-tester
```

## 工具

| 工具名 | 描述 |
|--------|------|
| `api_request` | 执行恰好一次 HTTP 请求（method / url / headers / body / timeoutMs），返回状态、响应头、正文（超出预算截断并标记 `truncated`）。请求超时钳制到 `maxTimeoutMs`，并转发调用方取消信号。 |
| `api_collection_plan` | 离线校验 API 集合 JSON（`{ name, requests: [{ name?, method, url, body?, timeoutMs? }] }`），逐条给出带索引的错误信息，并输出归一化后的可执行步骤计划（不发起任何网络请求）。 |

## 配置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `defaultTimeoutMs` | number | `30000` | 请求缺省超时（毫秒），调用方传 `timeoutMs <= 0` 时使用 |
| `maxTimeoutMs` | number | `120000` | 允许的最大超时，超出会被钳制 |
| `maxResponseBytes` | number | `65536` | 响应正文写入工具输出的最大字符数，超出截断 |

## 开发

```bash
npm install
npx tsc --noEmit
npm run build
npx vitest run
node scripts/load-smoke.mjs
```

HTTP 执行与时钟均为可注入缝隙（`createApiTesterTools(config, { runFn, now })`），单元测试喂假响应，零网络、零子进程。

## License

MIT
