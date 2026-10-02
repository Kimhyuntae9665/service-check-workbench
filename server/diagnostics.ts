import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Diagnosis, Step } from '../shared/contracts';
import type { Storage } from './storage';
import type { DiagnosticLab } from './lab';

export const REQUIRED_TOOLS = [
  'inspect_service',
  'probe_http',
  'probe_database',
  'read_production',
] as const;
export const TOOL_NAMES = [...REQUIRED_TOOLS, 'search_guides'] as const;
export type ToolName = (typeof TOOL_NAMES)[number];
type Probe = { status: Step['status']; summary: string; evidence: string[]; details: unknown };
const names: Record<ToolName, string> = {
  inspect_service: '서비스 실행 상태',
  probe_http: 'HTTP 연결 확인',
  probe_database: 'PostgreSQL 조회 확인',
  read_production: '생산실적 기능 확인',
  search_guides: '검증 가이드 검색',
};

export class Diagnostics {
  readonly client = new Client({ name: 'jeomgeomsil-diagnostic-client', version: '1.0.0' });
  readonly server = new McpServer({ name: 'jeomgeomsil-local-tools', version: '1.0.0' });
  connected = false;
  constructor(
    private lab: DiagnosticLab,
    private storage: Storage,
  ) {
    for (const name of REQUIRED_TOOLS) {
      this.server.registerTool(
        name,
        { description: names[name], inputSchema: { serviceId: z.literal('production-api') } },
        async () => {
          const result = await this.probe(name);
          return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
        },
      );
    }
    this.server.registerTool(
      'search_guides',
      { description: '저장된 재검증 가이드 검색', inputSchema: { query: z.string().max(200) } },
      async ({ query }) => {
        const guides = await this.storage.searchGuides(query);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                status: 'info',
                summary: `검증 가이드 ${guides.length}건`,
                evidence: guides.map((g) => `${g.id}: ${g.title}`),
                details: guides,
              } satisfies Probe),
            },
          ],
        };
      },
    );
  }
  async initialize() {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await this.server.connect(serverTransport);
    await this.client.connect(clientTransport);
    await this.client.listTools();
    this.connected = true;
  }
  private async fetchTarget(path: string) {
    const url = this.lab.endpoint + path;
    const response = await fetch(url, { signal: AbortSignal.timeout(2500), redirect: 'error' });
    return { url, status: response.status, body: await response.json() };
  }
  private async probe(name: (typeof REQUIRED_TOOLS)[number]): Promise<Probe> {
    if (name === 'inspect_service') {
      const running = this.lab.running;
      return {
        status: running ? 'pass' : 'fail',
        summary: running
          ? '로컬 HTTP 서비스가 실행 중입니다'
          : '로컬 HTTP 서비스가 중지되어 있습니다',
        evidence: [
          `HTTP listener.listening = ${running}`,
          `실제 리스너: ${this.lab.actualEndpoint}`,
          `연결 설정: ${this.lab.endpoint}`,
        ],
        details: {
          running,
          actualEndpoint: this.lab.actualEndpoint,
          connectorEndpoint: this.lab.endpoint,
        },
      };
    }
    if (name === 'probe_database') {
      if (!this.lab.databaseAllowed)
        return {
          status: 'fail',
          summary: '모의 DB 연결 권한 API가 쿼리를 거부했습니다',
          evidence: [
            'DB_PERMISSION_DENIED',
            'PostgreSQL 네이티브 인증이 아닌 애플리케이션 권한 게이트 재현',
            '권한 거부로 SQL 실행 안 함',
          ],
          details: { code: 'DB_PERMISSION_DENIED', simulation: 'application permission gate' },
        };
      try {
        const { rows } = await this.storage.db.query<{ database: string; answer: number }>(
          'SELECT current_database() AS database, $1::integer AS answer',
          [1],
        );
        return {
          status: rows[0]?.answer === 1 ? 'pass' : 'fail',
          summary: 'PGlite PostgreSQL에서 실제 SQL 조회가 성공했습니다',
          evidence: [
            `SELECT current_database(), $1::integer; parameter = 1`,
            `result = ${JSON.stringify(rows)}`,
          ],
          details: rows,
        };
      } catch (error) {
        return {
          status: 'fail',
          summary: '실제 PostgreSQL 조회가 실패했습니다',
          evidence: [error instanceof Error ? error.message : String(error)],
          details: { error: String(error) },
        };
      }
    }
    try {
      const result = await this.fetchTarget(name === 'probe_http' ? '/health' : '/production');
      const expected =
        name === 'probe_http'
          ? result.body?.status === 'ok'
          : Array.isArray(result.body?.records) && result.body.records.length > 0;
      const passed = result.status === 200 && expected;
      return {
        status: passed ? 'pass' : 'fail',
        summary: passed
          ? name === 'probe_http'
            ? 'HTTP /health가 200으로 응답했습니다'
            : `PostgreSQL 기반 생산실적 ${result.body.records.length}건을 조회했습니다`
          : `HTTP ${result.status}: ${name === 'probe_http' ? '상태 확인' : '생산실적 조회'} 실패`,
        evidence: [`GET ${result.url}`, `HTTP ${result.status}`, JSON.stringify(result.body)],
        details: result,
      };
    } catch (error) {
      const exception = error as Error & { cause?: { code?: string; message?: string } };
      const evidence = [
        `GET ${this.lab.endpoint}${name === 'probe_http' ? '/health' : '/production'}`,
        `${exception.name}: ${exception.message}`,
        exception.cause?.code ?? exception.cause?.message ?? '연결 응답 없음',
      ];
      return {
        status: 'fail',
        summary: '로컬 HTTP 대상에 연결할 수 없습니다',
        evidence,
        details: { error: exception.message, cause: exception.cause?.code ?? null },
      };
    }
  }
  async call(name: string, args: Record<string, unknown>): Promise<Step> {
    // The application allowlist and the MCP server both enforce the available tools.
    if (!TOOL_NAMES.includes(name as ToolName)) throw new Error('허용되지 않은 MCP 도구입니다');
    const tool = name as ToolName;
    const parsed =
      tool === 'search_guides'
        ? z
            .object({ query: z.string().max(200) })
            .strict()
            .parse(args)
        : z
            .object({ serviceId: z.literal('production-api') })
            .strict()
            .parse(args);
    const start = performance.now();
    const observedAt = new Date().toISOString();
    const result = await this.client.callTool({ name: tool, arguments: parsed });
    const content = result.content as { type: string; text?: string }[];
    const raw = content
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n');
    if (result.isError) throw new Error(`MCP 도구 실행 오류: ${raw}`);
    const value = z
      .object({
        status: z.enum(['pass', 'fail', 'info', 'error']),
        summary: z.string(),
        evidence: z.array(z.string()),
        details: z.unknown(),
      })
      .parse(JSON.parse(raw));
    return {
      id: randomUUID(),
      name: names[tool],
      tool,
      transport: 'mcp',
      status: value.status,
      summary: value.summary,
      observedAt,
      durationMs: Math.round(performance.now() - start),
      evidence: value.evidence,
      raw,
    };
  }
  async close() {
    this.connected = false;
    await this.client.close();
    await this.server.close();
  }
}

export function allChecksPassed(steps: Step[]) {
  return (
    REQUIRED_TOOLS.every((name) =>
      steps.some((step) => step.tool === name && step.status === 'pass'),
    ) && !steps.some((step) => step.status === 'fail' || step.status === 'error')
  );
}
export function actualFailure(steps: Step[]) {
  return REQUIRED_TOOLS.some((name) =>
    steps.some((step) => step.tool === name && step.status === 'fail'),
  );
}
export function diagnosisFromEvidence(steps: Step[]): Diagnosis {
  const service = steps.find((s) => s.tool === 'inspect_service');
  const http = steps.find((s) => s.tool === 'probe_http');
  const db = steps.find((s) => s.tool === 'probe_database');
  const failures = steps.filter((s) => s.status === 'fail');
  let cause: string | null = null;
  let nextAction =
    '원래 증상을 다시 재현하고 발생 시각·조건을 추가해 주세요. 현재 점검만으로 원인을 확정할 수 없습니다.';
  if (service?.status === 'fail') {
    cause = '생산실적 HTTP 서비스 중지';
    nextAction =
      '서비스를 시작한 뒤 같은 연결과 생산실적 조회를 재검증하세요. 실습실에서 정상 환경으로 바꾸면 서비스를 다시 시작합니다.';
  } else if (http?.status === 'fail' && service?.status === 'pass') {
    cause = '실행 중인 서비스와 연결 설정의 포트 불일치';
    nextAction =
      '실제 리스너와 연결 설정 주소를 대조하고 포트를 수정한 뒤 재검증하세요. 실습실의 정상 환경에서 연결 설정을 복구합니다.';
  } else if (db?.status === 'fail') {
    cause = '모의 DB 연결 권한 API의 접근 거부';
    nextAction =
      '애플리케이션의 DB 연결 권한 설정을 복구한 뒤 SQL 조회와 생산실적 기능을 재검증하세요. 이 실습은 네이티브 PostgreSQL 인증 장애가 아닙니다.';
  }
  return {
    title: cause ?? '현재 점검에서 장애를 재현하지 못했습니다',
    summary: cause
      ? `${failures.length}개 점검에서 실패를 확인했습니다. 실패 근거를 보존하고 환경을 복구한 뒤 재검증하세요.`
      : '필수 점검을 수행했지만 신고한 장애 원인은 확인되지 않았습니다.',
    cause,
    confidence: cause ? 'supported' : 'needs_check',
    evidenceIds: failures.map((s) => s.id),
    nextAction,
  };
}
