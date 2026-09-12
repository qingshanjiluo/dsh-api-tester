/**
 * API 测试插件：通过可注入 fetch 缝隙执行单次 HTTP 请求，并离线校验 API 测试集合为执行计划。
 * @module @qingshanjiluo/dsh-api-tester
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

export const name = 'dsh-api-tester'
export const inject = ['tools']

/** 部署配置。 */
export interface Config {
  /** 请求缺省超时（毫秒），当调用方传 timeoutMs<=0 时使用。 */
  defaultTimeoutMs: number
  /** 允许的最大超时（毫秒），超出会被钳制。 */
  maxTimeoutMs: number
  /** 响应正文写入工具输出的最大字符数，超出截断并置 truncated=true。 */
  maxResponseBytes: number
}

/** Schemastery 配置 schema。 */
export const Config: z<Config> = z.object({
  defaultTimeoutMs: z.number().default(30_000),
  maxTimeoutMs: z.number().default(120_000),
  maxResponseBytes: z.number().default(65_536),
})

/* ------------------------------------------------------------------ */
/* 可注入缝隙（tests 喂假实现，绝不触网）                                */
/* ------------------------------------------------------------------ */

/** 经过校验、可直接发给 fetch 的请求。 */
export interface PreparedRequest {
  method: string
  url: string
  headers: Record<string, string>
  body: string
  timeoutMs: number
  /** 调用方取消信号（来自 exec.signal），默认可缺省。 */
  signal?: AbortSignal
}

/** 缝隙返回的最小响应形状（无需真实 Response 对象）。 */
export interface RawResponse {
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
}

/** HTTP 执行缝隙。 */
export type RunFn = (request: PreparedRequest) => Promise<RawResponse>

/** 工具依赖缝隙集合。 */
export interface ApiTesterDeps {
  /** 覆盖 HTTP 执行（测试注入假响应）。 */
  runFn?: RunFn
  /** 覆盖时钟（测试固定 durationMs）。 */
  now?: () => number
}

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])

/** 默认缝隙实现：Node 全局 fetch + AbortController 超时，并转发调用方取消。 */
export const defaultRunFn: RunFn = async (request) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), request.timeoutMs)
  const forwardAbort = () => controller.abort()
  if (request.signal?.aborted) controller.abort()
  else request.signal?.addEventListener('abort', forwardAbort, { once: true })
  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body.length > 0 ? request.body : undefined,
      redirect: 'follow',
      signal: controller.signal,
    })
    const headers: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      headers[key] = value
    })
    return {
      status: response.status,
      statusText: response.statusText,
      headers,
      body: await response.text(),
    }
  } finally {
    clearTimeout(timer)
    request.signal?.removeEventListener('abort', forwardAbort)
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeHeaders(value: unknown): Record<string, string> | string {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) return 'headers must be a JSON object of string keys to string values'
  const out: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== 'string') return `headers["${key}"] must be a string`
    out[key] = raw
  }
  return out
}

function isValidHttpUrl(url: unknown): url is string {
  if (typeof url !== 'string' || url.length === 0) return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function errorMessage(error: unknown, callerSignal?: AbortSignal): string {
  if (callerSignal?.aborted) return 'request aborted by caller'
  if (error instanceof Error) {
    return error.name === 'AbortError' ? 'request aborted: timeout exceeded' : error.message
  }
  return String(error)
}

/* ------------------------------------------------------------------ */
/* 工具工厂                                                            */
/* ------------------------------------------------------------------ */

/**
 * 构建本插件的全部工具定义。
 * @param config - 部署配置（超时/大小预算）。
 * @param deps - 可注入缝隙（runFn / now），默认走 Node fetch 与 Date.now。
 */
export function createApiTesterTools(config: Config, deps: ApiTesterDeps = {}) {
  const runFn = deps.runFn ?? defaultRunFn
  const now = deps.now ?? (() => Date.now())

  const apiRequest = defineTool({
    name: 'api_request',
    description:
      'Perform exactly one HTTP request and return the response. Call with method (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS, case-insensitive), url (absolute http(s) URL), headers (JSON object mapping header names to string values, pass {} if none), body (request payload string, pass "" if none) and timeoutMs (milliseconds; 0 uses the plugin default). Returns the status line, response headers as "Name: value" lines, and the body text (truncated to the configured budget, flagged by truncated).',
    parameters: {
      method: { type: 'string', required: true, description: 'HTTP method, one of GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS.' },
      url: { type: 'string', required: true, description: 'Absolute http:// or https:// URL to request.' },
      headers: { type: 'json', required: true, description: 'JSON object of header name to header value (both strings); pass {} when there are no headers.' },
      body: { type: 'string', required: true, description: 'Request body text; pass an empty string when there is no body.' },
      timeoutMs: { type: 'number', required: true, description: 'Abort the request after this many milliseconds; 0 means use the plugin default timeout.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true, description: 'True when the request completed with a 2xx/3xx status; false on transport failure, timeout, validation error or 4xx/5xx.' },
          status: { type: 'number', required: true, description: 'HTTP status code, or 0 when no response was received.' },
          statusText: { type: 'string', required: true, description: 'HTTP status text from the response; empty when no response.' },
          headers: { type: 'array', required: true, description: 'Response headers as "Name: value" lines.', items: { type: 'string' } },
          bodyText: { type: 'string', required: true, description: 'Response body text, truncated to the configured budget when needed.' },
          truncated: { type: 'boolean', required: true, description: 'True when bodyText was cut off by the size budget.' },
          durationMs: { type: 'number', required: true, description: 'Wall-clock duration of the attempt in milliseconds.' },
          error: { type: 'string', required: true, description: 'Failure reason (validation, timeout or transport); empty string when none.' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.ok
          ? `HTTP ${value.status} ${value.statusText} (${value.durationMs}ms)\n${value.bodyText}`
          : `api_request failed: ${value.error || `HTTP ${value.status} ${value.statusText}`} (${value.durationMs}ms)\n${value.bodyText}`.trimEnd(),
      }],
    },
    timeoutMs: config.maxTimeoutMs + 5_000,
    async execute(args, exec) {
      const method = typeof args.method === 'string' ? args.method.trim().toUpperCase() : ''
      if (!ALLOWED_METHODS.has(method)) {
        return { ok: false, status: 0, statusText: '', headers: [], bodyText: '', truncated: false, durationMs: 0, error: `method "${args.method}" is not one of GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS` }
      }
      if (!isValidHttpUrl(args.url)) {
        return { ok: false, status: 0, statusText: '', headers: [], bodyText: '', truncated: false, durationMs: 0, error: `url must be an absolute http(s) URL, got "${String(args.url)}"` }
      }
      const headers = normalizeHeaders(args.headers)
      if (typeof headers === 'string') {
        return { ok: false, status: 0, statusText: '', headers: [], bodyText: '', truncated: false, durationMs: 0, error: headers }
      }
      const body = typeof args.body === 'string' ? args.body : ''
      const requested = typeof args.timeoutMs === 'number' && Number.isFinite(args.timeoutMs) && args.timeoutMs > 0 ? args.timeoutMs : config.defaultTimeoutMs
      const timeoutMs = Math.min(requested, config.maxTimeoutMs)

      const startedAt = now()
      const signal = exec?.signal
      try {
        const response = await runFn({ method, url: args.url, headers, body, timeoutMs, signal })
        const durationMs = Math.max(0, now() - startedAt)
        const rawBody = typeof response.body === 'string' ? response.body : ''
        const truncated = rawBody.length > config.maxResponseBytes
        const bodyText = truncated ? rawBody.slice(0, config.maxResponseBytes) : rawBody
        const headerLines = Object.entries(response.headers ?? {}).map(([key, value]) => `${key}: ${value}`)
        const ok = response.status >= 200 && response.status < 400
        return {
          ok,
          status: response.status,
          statusText: response.statusText ?? '',
          headers: headerLines,
          bodyText,
          truncated,
          durationMs,
          error: ok ? '' : `server responded with status ${response.status}`,
        }
      } catch (error) {
        return {
          ok: false,
          status: 0,
          statusText: '',
          headers: [],
          bodyText: '',
          truncated: false,
          durationMs: Math.max(0, now() - startedAt),
          error: errorMessage(error, signal),
        }
      }
    },
  })

  const apiCollectionPlan = defineTool({
    name: 'api_collection_plan',
    description:
      'Validate an API collection JSON document offline (no network calls) and return a normalized execution plan. The collection must be an object shaped { name: string, requests: [{ name?: string, method: string, url: string, body?: string, timeoutMs?: number }] } with at least one request. Each request needs a supported HTTP method and an absolute http(s) URL. Returns ok, per-entry errors with request indexes, and the normalized steps list you would then run one-by-one with api_request.',
    parameters: {
      collection: { type: 'json', required: true, description: 'The collection JSON document: { name, requests: [{ name?, method, url, body?, timeoutMs? }] }.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true, description: 'True when the collection validated without errors and the plan is runnable.' },
          collectionName: { type: 'string', required: true, description: 'Normalized collection name ("Untitled Collection" when missing or blank).' },
          errors: { type: 'array', required: true, description: 'Validation errors prefixed with the request index; empty when ok.', items: { type: 'string' } },
          steps: {
            type: 'array',
            required: true,
            description: 'Normalized executable steps for the valid requests, in collection order.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                index: { type: 'number', required: true, description: 'Zero-based position of the request inside collection.requests.' },
                name: { type: 'string', required: true, description: 'Step name ("Request N" when the entry omitted it).' },
                method: { type: 'string', required: true, description: 'Uppercased HTTP method.' },
                url: { type: 'string', required: true, description: 'Absolute http(s) URL.' },
                timeoutMs: { type: 'number', required: true, description: 'Effective timeout: entry value clamped to the plugin maximum, or the plugin default.' },
                hasBody: { type: 'boolean', required: true, description: 'True when the entry carried a non-empty body string.' },
              },
            },
          },
          count: { type: 'number', required: true, description: 'Number of executable steps in the plan.' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.ok
          ? `collection "${value.collectionName}" ok — ${value.count} step(s) planned`
          : `collection "${value.collectionName}" invalid:\n${value.errors.join('\n')}`,
      }],
    },
    isConcurrencySafe: () => true,
    async execute(args) {
      const errors: string[] = []
      const collection = args.collection as unknown
      if (!isPlainObject(collection)) {
        return { ok: false, collectionName: 'Untitled Collection', errors: ['collection must be a JSON object'], steps: [], count: 0 }
      }
      const rawName = collection.name
      const collectionName = typeof rawName === 'string' && rawName.trim().length > 0 ? rawName.trim() : 'Untitled Collection'

      const requests = collection.requests
      if (!Array.isArray(requests)) {
        errors.push('collection.requests must be an array')
        return { ok: false, collectionName, errors, steps: [], count: 0 }
      }
      if (requests.length === 0) {
        errors.push('collection.requests must contain at least one request')
      }

      type Step = { index: number; name: string; method: string; url: string; timeoutMs: number; hasBody: boolean }
      const steps: Step[] = []
      requests.forEach((entry, index) => {
        let entryOk = true
        if (!isPlainObject(entry)) {
          errors.push(`requests[${index}]: must be an object`)
          return
        }
        const method = typeof entry.method === 'string' ? entry.method.trim().toUpperCase() : ''
        if (!ALLOWED_METHODS.has(method)) {
          errors.push(`requests[${index}]: method "${String(entry.method)}" is not one of GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS`)
          entryOk = false
        }
        if (!isValidHttpUrl(entry.url)) {
          errors.push(`requests[${index}]: url must be an absolute http(s) URL, got "${String(entry.url)}"`)
          entryOk = false
        }
        let timeoutMs = config.defaultTimeoutMs
        if (entry.timeoutMs !== undefined) {
          if (typeof entry.timeoutMs !== 'number' || !Number.isFinite(entry.timeoutMs) || entry.timeoutMs <= 0) {
            errors.push(`requests[${index}]: timeoutMs must be a positive number of milliseconds`)
            entryOk = false
          } else {
            timeoutMs = Math.min(entry.timeoutMs, config.maxTimeoutMs)
          }
        }
        if (!entryOk) return
        const rawNameValue = entry.name
        steps.push({
          index,
          name: typeof rawNameValue === 'string' && rawNameValue.trim().length > 0 ? rawNameValue.trim() : `Request ${index + 1}`,
          method,
          url: entry.url as string,
          timeoutMs,
          hasBody: typeof entry.body === 'string' && entry.body.length > 0,
        })
      })

      return { ok: errors.length === 0, collectionName, errors, steps, count: steps.length }
    },
  })

  return [apiRequest, apiCollectionPlan]
}

/**
 * 注册工具。
 * @param ctx - 携带 ctx.tools 的注册上下文。
 * @param config - 部署显式配置。
 */
export function apply(ctx: Context, config: Config): void {
  for (const tool of createApiTesterTools(config)) {
    ctx.tools.register(tool)
  }
}
