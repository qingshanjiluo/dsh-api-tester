# dsh-api-tester

> DeepSeek Harness API 测试客户端

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## ✨ 功能特性

- 🚀 **HTTP 请求**: 支持 GET/POST/PUT/PATCH/DELETE，自定义 headers/body
- ✅ **断言测试**: 状态码、响应体、JSON Path、响应时间断言
- 📦 **集合运行**: 批量执行请求集合，统计通过率
- 🎭 **Mock 数据**: 从 JSON Schema 生成 mock 数据
- 🔧 **变量替换**: 支持 `{{variable}}` 模板变量

## 📦 安装

```bash
npm install dsh-api-tester
```

## 🛠️ 工具

| 工具名 | 描述 | 参数 |
|--------|------|------|
| `api_request` | 发送 HTTP 请求 | `method`, `url`, `headers`, `body` |
| `api_test` | 发送请求并运行断言 | `method`, `url`, `assertions` |
| `api_collection_run` | 运行请求集合 | `file`, `env` |
| `api_mock` | 生成 mock 数据 | `schema` |

## 📋 命令

- `/api get <url>` — GET 请求
- `/api post <url> <body>` — POST 请求
- `/api test <url> <assertions>` — 测试请求
- `/api mock <schema>` — 生成 mock

## ⚙️ 配置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `enabled` | boolean | `true` | 启用插件 |
| `defaultTimeout` | number | `30000` | 请求超时(ms) |
| `followRedirects` | boolean | `true` | 跟随重定向 |
| `verifySsl` | boolean | `true` | 验证 SSL |

## 📄 License

MIT
