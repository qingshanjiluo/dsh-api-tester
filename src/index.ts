/**
 * dsh-api-tester — API测试客户端
 *
 * 功能：
 * 1. HTTP请求
 * 2. 断言测试
 * 3. 集合运行
 * 4. Mock数据
 *
 * 工具：api_request, api_test, api_collection_run, api_mock
 * 命令：/api
 * 配置：enabled
 */
import { existsSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import { z } from 'zod';

export const name = 'dsh-api-tester';
export const inject = ['settings', 'tools', 'commands'];

const configSchema = z.object({
  enabled: z.boolean().default(true),
  defaultTimeout: z.number().default(30000),
  followRedirects: z.boolean().default(true),
  verifySsl: z.boolean().default(true),
});

type Config = z.infer<typeof configSchema>;

interface RequestOptions {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
}

interface Response {
  status: number;
  headers: Record<string, string>;
  body: string;
  timing: number;
}

interface Assertion {
  type: string;
  expected: any;
}

function buildCurlCommand(options: RequestOptions, config: Config): string {
  const parts: string[] = ['curl', '-s', '-w', '\\n%{http_code}\\n%{time_total}'];

  if (!config.verifySsl) {
    parts.push('-k');
  }

  if (config.followRedirects) {
    parts.push('-L');
  }

  parts.push('-X', options.method);
  parts.push('--connect-timeout', String(Math.floor((options.timeout ?? config.defaultTimeout) / 1000)));

  if (options.headers) {
    for (const [key, value] of Object.entries(options.headers)) {
      parts.push('-H', `'${key}: ${value}'`);
    }
  }

  if (options.body) {
    parts.push('-d', `'${options.body.replace(/'/g, "'\\''")}'`);
  }

  parts.push(`'${options.url}'`);

  return parts.join(' ');
}

export function executeRequest(options: RequestOptions, config: Config): Response {
  const start = Date.now();
  const command = buildCurlCommand(options, config);

  try {
    const output = execSync(command, {
      timeout: options.timeout ?? config.defaultTimeout,
      encoding: 'utf-8',
      windowsHide: true,
    });

    const lines = output.trim().split('\n');
    const status = parseInt(lines[lines.length - 2], 10);
    const timing = parseFloat(lines[lines.length - 1]) * 1000;
    const bodyLines = lines.slice(0, -2);
    const body = bodyLines.join('\n');

    return {
      status,
      headers: {},
      body,
      timing: timing || Date.now() - start,
    };
  } catch (error: any) {
    const elapsed = Date.now() - start;
    return {
      status: 0,
      headers: {},
      body: error.message || 'Request failed',
      timing: elapsed,
    };
  }
}

export function parseResponse(response: string): any {
  try {
    return JSON.parse(response);
  } catch {
    return response;
  }
}

export function applyVariables(template: string, variables: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  return result;
}

export function runAssertions(response: Response, assertions: Assertion[]): { passed: boolean; results: any[] } {
  const results: any[] = [];

  for (const assertion of assertions) {
    let passed = false;

    switch (assertion.type) {
      case 'status_equals':
        passed = response.status === assertion.expected;
        break;
      case 'body_contains':
        passed = response.body.includes(assertion.expected);
        break;
      case 'json_path_equals': {
        const data = parseResponse(response.body);
        const parts = assertion.expected.path.split('.');
        let value: any = data;
        for (const part of parts) {
          if (value && typeof value === 'object') {
            value = value[part];
          } else {
            value = undefined;
            break;
          }
        }
        passed = value === assertion.expected.value;
        break;
      }
      case 'response_time_less_than':
        passed = response.timing < assertion.expected;
        break;
    }

    results.push({ type: assertion.type, passed });
  }

  return {
    passed: results.every((r) => r.passed),
    results,
  };
}

export function formatRequestForDisplay(request: RequestOptions): string {
  return buildCurlCommand(request, {
    enabled: true,
    defaultTimeout: 30000,
    followRedirects: true,
    verifySsl: true,
  });
}

export function formatResponseForDisplay(response: Response): string {
  const preview = response.body.length > 200 ? response.body.substring(0, 200) + '...' : response.body;
  return `Status: ${response.status}\nTime: ${response.timing.toFixed(0)}ms\nBody:\n${preview}`;
}

export function apply(settings: any) {
  const config = configSchema.parse(settings);

  settings.tools.api_request = {
    description: 'Send an HTTP request',
    parameters: z.object({
      method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
      url: z.string().describe('The request URL'),
      headers: z.string().optional().describe('JSON string of headers'),
      body: z.string().optional(),
      timeout: z.number().optional(),
    }),
    execute: async (params: any) => {
      const headers = params.headers ? JSON.parse(params.headers) : {};
      const response = executeRequest(
        {
          method: params.method,
          url: params.url,
          headers,
          body: params.body,
          timeout: params.timeout,
        },
        config
      );

      return {
        status: response.status,
        body: response.body,
        headers: response.headers,
        timing: `${response.timing.toFixed(0)}ms`,
      };
    },
  };

  settings.tools.api_test = {
    description: 'Send request and run assertions',
    parameters: z.object({
      method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
      url: z.string(),
      headers: z.string().optional(),
      body: z.string().optional(),
      assertions: z.string().describe('JSON array of assertions'),
    }),
    execute: async (params: any) => {
      const headers = params.headers ? JSON.parse(params.headers) : {};
      const assertions: Assertion[] = JSON.parse(params.assertions);

      const response = executeRequest(
        {
          method: params.method,
          url: params.url,
          headers,
          body: params.body,
        },
        config
      );

      const result = runAssertions(response, assertions);
      return {
        passed: result.passed,
        results: result.results,
        response: formatResponseForDisplay(response),
      };
    },
  };

  settings.tools.api_collection_run = {
    description: 'Run a collection of requests from a JSON file',
    parameters: z.object({
      file: z.string().describe('Path to collection JSON file'),
      env: z.string().optional().describe('Environment variables JSON'),
    }),
    execute: async (params: any) => {
      if (!existsSync(params.file)) {
        return { error: `File not found: ${params.file}` };
      }

      const content = readFileSync(params.file, 'utf-8');
      const collection = JSON.parse(content);
      const env = params.env ? JSON.parse(params.env) : {};
      const summary = { total: 0, passed: 0, failed: 0, results: [] as any[] };

      for (const req of collection.requests) {
        const url = applyVariables(req.url, env);
        const body = req.body ? applyVariables(req.body, env) : undefined;

        const response = executeRequest(
          {
            method: req.method,
            url,
            headers: req.headers || {},
            body,
          },
          config
        );

        const result = req.assertions ? runAssertions(response, req.assertions) : { passed: true, results: [] };

        summary.total++;
        if (result.passed) {
          summary.passed++;
        } else {
          summary.failed++;
        }

        summary.results.push({
          name: req.name,
          status: response.status,
          passed: result.passed,
          assertions: result.results,
        });
      }

      return summary;
    },
  };

  settings.tools.api_mock = {
    description: 'Generate a mock response from JSON schema',
    parameters: z.object({
      schema: z.string().describe('JSON schema string'),
    }),
    execute: async (params: any) => {
      const schema = JSON.parse(params.schema);
      const mock = generateMock(schema);
      return { mock };
    },
  };

  settings.commands.api = {
    description: 'API testing command',
    execute: async (args: string[]) => {
      const subcommand = args[0];

      switch (subcommand) {
        case 'get': {
          const url = args[1];
          if (!url) return 'Usage: /api get <url>';
          const response = executeRequest({ method: 'GET', url }, config);
          return formatResponseForDisplay(response);
        }

        case 'post': {
          const url = args[1];
          const body = args[2];
          if (!url) return 'Usage: /api post <url> [body]';
          const response = executeRequest({ method: 'POST', url, body }, config);
          return formatResponseForDisplay(response);
        }

        case 'test': {
          const url = args[1];
          const assertionsStr = args[2];
          if (!url || !assertionsStr) return 'Usage: /api test <url> <assertions-json>';
          const response = executeRequest({ method: 'GET', url }, config);
          const assertions: Assertion[] = JSON.parse(assertionsStr);
          const result = runAssertions(response, assertions);
          return JSON.stringify(result, null, 2);
        }

        case 'mock': {
          const schemaStr = args[1];
          if (!schemaStr) return 'Usage: /api mock <schema-json>';
          const schema = JSON.parse(schemaStr);
          return JSON.stringify(generateMock(schema), null, 2);
        }

        default:
          return 'Usage: /api <get|post|test|mock>';
      }
    },
  };
}

function generateMock(schema: any): any {
  if (schema.type === 'object' && schema.properties) {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries<any>(schema.properties)) {
      result[key] = generateMock(value);
    }
    return result;
  }

  if (schema.type === 'array' && schema.items) {
    return [generateMock(schema.items)];
  }

  switch (schema.type) {
    case 'string':
      if (schema.enum) return schema.enum[0];
      if (schema.format === 'email') return 'test@example.com';
      if (schema.format === 'date') return '2026-01-01';
      if (schema.format === 'date-time') return '2026-01-01T00:00:00Z';
      return schema.example || 'string';
    case 'number':
    case 'integer':
      if (schema.enum) return schema.enum[0];
      return schema.example ?? 0;
    case 'boolean':
      return schema.example ?? false;
    default:
      return null;
  }
}
