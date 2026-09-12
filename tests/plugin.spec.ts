import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import * as plugin from '../src/index'
import type { ApiTesterDeps, Config, PreparedRequest } from '../src/index'

interface RenderBlock { type: string; text: string }

interface RegisteredTool {
  name: string
  description: string
  parameters: Record<string, { type: string; required?: boolean }>
  output: { schema: unknown; render: (args: unknown, value: unknown) => RenderBlock[] }
  isConcurrencySafe?: (args: unknown) => boolean
  execute: (args: Record<string, unknown>, exec?: unknown) => Promise<Record<string, unknown>>
}

const testConfig: Config = { defaultTimeoutMs: 1_000, maxTimeoutMs: 5_000, maxResponseBytes: 10 }

function stubCtx() {
  const registered: RegisteredTool[] = []
  const ctx = { tools: { register: (def: unknown) => { registered.push(def as RegisteredTool); return () => {} } } }
  return { ctx: ctx as unknown as Context, registered }
}

function buildTools(deps?: ApiTesterDeps): Record<string, RegisteredTool> {
  const defs = plugin.createApiTesterTools(testConfig, deps) as unknown as RegisteredTool[]
  return Object.fromEntries(defs.map((def) => [def.name, def]))
}

/** Clock returning the listed ticks in order, repeating the last one. */
function fixedClock(...ticks: number[]): () => number {
  let i = 0
  return () => ticks[Math.min(i++, ticks.length - 1)] as number
}

describe('export face', () => {
  it('exports the real Cordis plugin contract', () => {
    expect(plugin.name).toBe('dsh-api-tester')
    expect(plugin.inject).toEqual(['tools'])
    expect(typeof plugin.apply).toBe('function')
    expect(plugin.Config).toBeTruthy()
    expect((plugin as { default?: unknown }).default).toBeUndefined()
  })

  it('apply registers api_request and api_collection_plan on ctx.tools', () => {
    const { ctx, registered } = stubCtx()
    plugin.apply(ctx, testConfig)
    expect(registered.map((tool) => tool.name).sort()).toEqual(['api_collection_plan', 'api_request'])
    for (const tool of registered) {
      expect(typeof tool.description).toBe('string')
      expect(tool.description.length).toBeGreaterThan(40)
      expect(tool.parameters).toBeTruthy()
      expect(typeof tool.output.render).toBe('function')
      expect(typeof tool.execute).toBe('function')
    }
  })
})

describe('api_request', () => {
  it('performs a validated request through the injected runFn seam and reports the response', async () => {
    const seen: PreparedRequest[] = []
    const { api_request } = buildTools({
      runFn: async (request) => {
        seen.push(request)
        return { status: 201, statusText: 'Created', headers: { 'content-type': 'application/json', 'x-trace': 't1' }, body: '{"id":7}' }
      },
      now: fixedClock(100, 350),
    })
    const result = await api_request.execute({ method: 'post', url: 'https://api.example.test/v1/things', headers: { 'x-token': 'abc' }, body: '{"a":1}', timeoutMs: 999_999 })
    expect(result).toEqual({
      ok: true,
      status: 201,
      statusText: 'Created',
      headers: ['content-type: application/json', 'x-trace: t1'],
      bodyText: '{"id":7}',
      truncated: false,
      durationMs: 250,
      error: '',
    })
    expect(seen).toHaveLength(1)
    expect(seen[0]!.method).toBe('POST')
    expect(seen[0]!.url).toBe('https://api.example.test/v1/things')
    expect(seen[0]!.headers).toEqual({ 'x-token': 'abc' })
    expect(seen[0]!.body).toBe('{"a":1}')
    // requested timeout is clamped to the configured maximum
    expect(seen[0]!.timeoutMs).toBe(testConfig.maxTimeoutMs)
    const blocks = api_request.output.render({}, result)
    expect(blocks[0]!.type).toBe('text')
    expect(blocks[0]!.text).toContain('HTTP 201 Created')
  })

  it('falls back to the default timeout when timeoutMs <= 0 and truncates oversized bodies', async () => {
    const seen: PreparedRequest[] = []
    const { api_request } = buildTools({
      runFn: async (request) => {
        seen.push(request)
        return { status: 200, statusText: 'OK', headers: {}, body: 'abcdefghij-overflow' }
      },
      now: fixedClock(0, 5),
    })
    const result = await api_request.execute({ method: 'GET', url: 'http://example.test/', headers: {}, body: '', timeoutMs: 0 })
    expect(seen[0]!.timeoutMs).toBe(testConfig.defaultTimeoutMs)
    expect(result.truncated).toBe(true)
    expect(result.bodyText).toBe('abcdefghij')
    expect(result.ok).toBe(true)
  })

  it('rejects non-http(s) URLs, unknown methods and malformed headers without touching the seam', async () => {
    let seamCalls = 0
    const { api_request } = buildTools({ runFn: async () => { seamCalls++; return { status: 200, statusText: 'OK', headers: {}, body: '' } } })
    const badUrl = await api_request.execute({ method: 'GET', url: 'ftp://example.test/x', headers: {}, body: '', timeoutMs: 100 })
    expect(badUrl).toMatchObject({ ok: false, status: 0, error: expect.stringContaining('absolute http(s) URL') })
    const badMethod = await api_request.execute({ method: 'TRACE', url: 'https://example.test', headers: {}, body: '', timeoutMs: 100 })
    expect(badMethod.ok).toBe(false)
    expect(String(badMethod.error)).toContain('not one of GET')
    const badHeaders = await api_request.execute({ method: 'GET', url: 'https://example.test', headers: 'nope', body: '', timeoutMs: 100 })
    expect(badHeaders.ok).toBe(false)
    expect(String(badHeaders.error)).toContain('headers')
    expect(seamCalls).toBe(0)
  })

  it('reports 4xx/5xx as failed with status preserved, and maps seam errors to ok=false', async () => {
    const { api_request } = buildTools({
      runFn: async (request) => {
        if (request.url.includes('boom')) throw new Error('socket reset')
        return { status: 500, statusText: 'Internal Server Error', headers: {}, body: 'oops' }
      },
      now: fixedClock(0, 12, 30, 42),
    })
    const serverError = await api_request.execute({ method: 'GET', url: 'https://api.example.test/five-hundred', headers: {}, body: '', timeoutMs: 50 })
    expect(serverError).toMatchObject({ ok: false, status: 500, bodyText: 'oops' })
    expect(String(serverError.error)).toContain('status 500')
    const transport = await api_request.execute({ method: 'GET', url: 'https://api.example.test/boom', headers: {}, body: '', timeoutMs: 50 })
    expect(transport).toMatchObject({ ok: false, status: 0, durationMs: 12, error: 'socket reset' })
    expect(transport.bodyText).toBe('')
  })
})

describe('api_collection_plan', () => {
  const baseArgs = (collection: unknown) => ({ collection })

  it('validates a good collection and normalizes a runnable plan offline', async () => {
    const { api_collection_plan } = buildTools()
    const collection = {
      name: '  Smoke Suite  ',
      requests: [
        { name: 'create', method: 'post', url: 'https://api.test/v1/things', body: '{"a":1}', timeoutMs: 250 },
        { method: 'get', url: 'https://api.test/v1/things/1', timeoutMs: 999_999 },
      ],
    }
    const value = await api_collection_plan.execute(baseArgs(collection))
    expect(value).toEqual({
      ok: true,
      collectionName: 'Smoke Suite',
      errors: [],
      steps: [
        { index: 0, name: 'create', method: 'POST', url: 'https://api.test/v1/things', timeoutMs: 250, hasBody: true },
        { index: 1, name: 'Request 2', method: 'GET', url: 'https://api.test/v1/things/1', timeoutMs: testConfig.maxTimeoutMs, hasBody: false },
      ],
      count: 2,
    })
    expect(api_collection_plan.isConcurrencySafe?.(baseArgs(collection))).toBe(true)
    const blocks = api_collection_plan.output.render({}, value)
    expect(blocks[0]!.text).toContain('2 step(s) planned')
  })

  it('rejects malformed documents: non-object, missing/empty requests', async () => {
    const { api_collection_plan } = buildTools()
    const notObject = await api_collection_plan.execute(baseArgs('hello'))
    expect(notObject).toMatchObject({ ok: false, count: 0 })
    expect(notObject.errors).toContain('collection must be a JSON object')
    const noRequests = await api_collection_plan.execute(baseArgs({ name: 'X' }))
    expect(noRequests.ok).toBe(false)
    expect(String(noRequests.errors[0])).toContain('requests must be an array')
    const empty = await api_collection_plan.execute(baseArgs({ name: 'X', requests: [] }))
    expect(empty.ok).toBe(false)
    expect(String(empty.errors[0])).toContain('at least one request')
    expect(empty.count).toBe(0)
  })

  it('collects per-request errors with indexes and keeps valid steps', async () => {
    const { api_collection_plan } = buildTools()
    const value = await api_collection_plan.execute(baseArgs({
      name: 'Mixed',
      requests: [
        { method: 'FETCH', url: 'notaurl' },
        { method: 'GET', url: 'https://ok.test/a', timeoutMs: -4 },
        'not-an-object',
        { method: 'delete', url: 'https://ok.test/b' },
      ],
    }))
    expect(value.ok).toBe(false)
    expect(value.errors).toEqual([
      'requests[0]: method "FETCH" is not one of GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS',
      'requests[0]: url must be an absolute http(s) URL, got "notaurl"',
      'requests[1]: timeoutMs must be a positive number of milliseconds',
      'requests[2]: must be an object',
    ])
    expect(value.steps).toEqual([
      { index: 3, name: 'Request 4', method: 'DELETE', url: 'https://ok.test/b', timeoutMs: 1_000, hasBody: false },
    ])
    expect(value.count).toBe(1)
    const blocks = api_collection_plan.output.render({}, value)
    expect(blocks[0]!.text).toContain('invalid')
  })
})
