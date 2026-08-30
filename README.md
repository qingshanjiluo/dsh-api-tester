# dsh-api-tester

> DeepSeek Harness API 测试客户端插件

## 功能

- 🚀 **HTTP 请求**: 支持 GET/POST/PUT/PATCH/DELETE，自定义 headers/body
- ✅ **断言测试**: 状态码、响应体、JSON Path、响应时间断言
- 📦 **集合运行**: 批量执行请求集合，统计通过率
- 🎭 **Mock 数据**: 从 JSON Schema 生成 mock 数据
- 🔧 **变量替换**: 支持 `{{variable}}` 模板变量

## 工具

| 工具名 | 说明 |
|--------|------|
| `api_request` | 发送 HTTP 请求 |
| `api_test` | 发送请求并运行断言 |
| `api_collection_run` | 运行请求集合 |
| `api_mock` | 生成 mock 数据 |

## 命令

- `/api get <url>` — GET 请求
- `/api post <url> <body>` — POST 请求
- `/api test <url> <assertions>` — 测试请求
- `/api mock <schema>` — 生成 mock

## License

MIT
