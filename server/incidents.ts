import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  Guide,
  IncidentDetail,
  Run,
  ScenarioId,
  Service,
  Step,
  Workspace,
} from '../shared/contracts';
import {
  actualFailure,
  allChecksPassed,
  diagnosisFromEvidence,
  Diagnostics,
  REQUIRED_TOOLS,
} from './diagnostics';
import { DiagnosticLab, scenarioDefinitions } from './lab';
import { LIVE_MODEL, liveDiagnosis, OpenAiGateway, type LlmGateway } from './llm';
import { Storage } from './storage';

export class ApiProblem extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
class SerialLock {
  private tail: Promise<void> = Promise.resolve();
  async run<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  }
}
const createSchema = z
  .object({
    title: z.string().trim().min(2).max(120),
    symptom: z.string().trim().min(5).max(2000),
    serviceId: z.literal('production-api'),
    priority: z.enum(['medium', 'high']).default('medium'),
  })
  .strict();

export class IncidentService {
  mode: 'demo' | 'live' = 'demo';
  private lock = new SerialLock();
  private active = new Set<string>();
  private health: Service['status'] = 'unknown';
  private checkedAt: string | null = null;
  constructor(
    public storage: Storage,
    public diagnostics: Diagnostics,
    public lab: DiagnosticLab,
    private llm: LlmGateway = new OpenAiGateway(),
    private injectedLive = false,
  ) {}
  get liveConfigured() {
    return this.injectedLive || Boolean(process.env.OPENAI_API_KEY);
  }
  async workspace(): Promise<Workspace> {
    const [incidents, guides] = await Promise.all([
      this.storage.listIncidents(),
      this.storage.listGuides(),
    ]);
    const runs = await this.storage.db.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM runs',
    );
    return {
      services: [
        {
          id: 'production-api',
          name: '생산실적 조회',
          description: '라인별 생산실적과 조회 상태를 확인하는 샘플 서비스',
          environment: '로컬 장애 실습실 · 샘플 데이터',
          endpoint: this.lab.endpoint,
          status: this.health,
          lastCheckedAt: this.checkedAt,
        },
      ],
      incidents,
      guides: guides.map(
        ({
          symptom: _s,
          conditions: _c,
          checks: _checks,
          resolution: _r,
          verification: _v,
          ...summary
        }) => summary,
      ),
      metrics: {
        open: incidents.filter((i) => i.status !== 'verified').length,
        verified: incidents.filter((i) => i.status === 'verified').length,
        checks: runs.rows[0].count,
      },
      runtime: {
        mode: this.mode,
        provider: this.mode === 'live' ? 'openai' : 'none',
        model: this.mode === 'live' ? LIVE_MODEL : null,
        mcp: this.diagnostics.connected ? 'connected' : 'disconnected',
        storage: 'pglite',
        liveConfigured: this.liveConfigured,
      },
      currentScenario: this.lab.scenario,
      scenarioDefinitions,
    };
  }
  async detail(id: string): Promise<IncidentDetail> {
    const incident = await this.storage.getIncident(id);
    if (!incident) throw new ApiProblem(404, 'INCIDENT_NOT_FOUND', '장애 접수를 찾을 수 없습니다');
    return {
      ...incident,
      runs: (await this.storage.listRuns(id)).map((row) => row.data),
      guide: await this.storage.incidentGuide(id),
    };
  }
  async create(input: unknown) {
    const value = createSchema.parse(input);
    const now = new Date().toISOString();
    const incident = {
      ...value,
      id: randomUUID(),
      serviceName: '생산실적 조회',
      status: 'open' as const,
      createdAt: now,
      updatedAt: now,
      lastRunId: null,
    };
    await this.storage.saveIncident(incident);
    return this.detail(incident.id);
  }
  async changeScenario(input: unknown) {
    const { scenario } = z
      .object({ scenario: z.enum(['healthy', 'service_down', 'wrong_port', 'db_auth']) })
      .strict()
      .parse(input);
    return this.lock.run(async () => {
      await this.lab.change(scenario as ScenarioId);
      this.health = 'unknown';
      this.checkedAt = null;
      for (const incident of await this.storage.listIncidents())
        if (incident.status === 'verified')
          await this.storage.saveIncident({
            ...incident,
            status: 'needs_review',
            updatedAt: new Date().toISOString(),
          });
      return this.workspace();
    });
  }
  async runtime(input: unknown) {
    const { mode } = z
      .object({ mode: z.enum(['demo', 'live']) })
      .strict()
      .parse(input);
    if (mode === 'live' && !this.liveConfigured)
      throw new ApiProblem(
        409,
        'LIVE_NOT_CONFIGURED',
        'Live 모드에는 프로젝트 .env의 OPENAI_API_KEY가 필요합니다. 키를 UI에 입력하지 마세요.',
      );
    return this.lock.run(async () => {
      this.mode = mode;
      return this.workspace();
    });
  }
  async run(id: string, input: unknown): Promise<Run> {
    const { kind } = z
      .object({ kind: z.enum(['diagnose', 'recheck']) })
      .strict()
      .parse(input);
    if (this.active.has(id))
      throw new ApiProblem(409, 'RUN_IN_PROGRESS', '이 장애를 이미 점검 중입니다');
    this.active.add(id);
    try {
      return await this.lock.run(async () => {
        const incident = await this.detail(id);
        const mode = this.mode;
        const revision = this.lab.revision;
        const start = performance.now();
        const startedAt = new Date().toISOString();
        const { runs: _runs, guide: _guide, ...summary } = incident;
        await this.storage.saveIncident({
          ...summary,
          status: 'investigating',
          updatedAt: startedAt,
        });
        const steps: Step[] = [];
        for (const tool of REQUIRED_TOOLS) {
          const probeStarted = performance.now();
          const observedAt = new Date().toISOString();
          try {
            steps.push(await this.diagnostics.call(tool, { serviceId: incident.serviceId }));
          } catch (error) {
            steps.push({
              id: randomUUID(),
              name: 'MCP 점검 오류',
              tool,
              transport: 'mcp',
              status: 'error',
              summary: 'MCP 점검을 완료하지 못했습니다',
              observedAt,
              durationMs: Math.round(performance.now() - probeStarted),
              evidence: [error instanceof Error ? error.message : String(error)],
              raw: JSON.stringify({ error: String(error) }),
            });
          }
        }
        steps.push(
          await this.diagnostics.call('search_guides', {
            query: diagnosisFromEvidence(steps).cause ?? incident.symptom.slice(0, 200),
          }),
        );
        let diagnosis = diagnosisFromEvidence(steps),
          llmError: string | null = null,
          inputTokens = 0,
          outputTokens = 0;
        if (mode === 'live') {
          try {
            const result = await liveDiagnosis(this.llm, this.diagnostics, incident.symptom, steps);
            diagnosis = result.diagnosis;
            inputTokens = result.inputTokens;
            outputTokens = result.outputTokens;
          } catch (error) {
            const message = error instanceof Error ? error.message : 'AI 분석 실패';
            const key = process.env.OPENAI_API_KEY;
            llmError = key ? message.replaceAll(key, '[redacted]') : message;
            diagnosis = {
              title: 'AI 분석을 완료하지 못했습니다',
              summary: '실제 도구 근거는 보존했습니다. AI 응답 오류를 확인한 뒤 다시 점검하세요.',
              cause: null,
              confidence: 'needs_check',
              evidenceIds: [],
              nextAction: 'AI 설정 또는 응답 오류를 확인하고 진단을 다시 실행하세요.',
            };
          }
        }
        const previous = await this.storage.listRuns(id);
        const source = previous
          .filter(
            (r) =>
              r.actual_failure &&
              r.data.status === 'failed' &&
              r.data.diagnosis.confidence === 'supported' &&
              r.data.diagnosis.cause,
          )
          .at(-1);
        const failed = actualFailure(steps);
        const complete = allChecksPassed(steps);
        const verified = kind === 'recheck' && complete && Boolean(source) && !llmError;
        const status: Run['status'] = llmError
          ? 'inconclusive'
          : failed
            ? 'failed'
            : verified
              ? 'passed'
              : 'inconclusive';
        if (verified)
          diagnosis = {
            title: '같은 서비스의 필수 점검이 모두 통과했습니다',
            summary:
              '최근 실패 점검 뒤 서비스, HTTP, SQL, 생산실적 조회를 다시 실행해 복구를 확인했습니다.',
            cause: source!.data.diagnosis.cause,
            confidence: 'supported',
            evidenceIds: steps.filter((s) => s.status === 'pass').map((s) => s.id),
            nextAction: '복구 절차를 기록해 재검증 가이드를 생성할 수 있습니다.',
          };
        else if (kind === 'recheck' && complete && !source && !llmError)
          diagnosis = {
            ...diagnosisFromEvidence(steps),
            nextAction:
              '확인된 실패 점검 근거가 없어 해결 완료로 처리할 수 없습니다. 증상을 재현하고 먼저 원인을 확인하세요.',
          };
        const completedAt = new Date().toISOString();
        const run: Run = {
          id: randomUUID(),
          incidentId: id,
          kind,
          startedAt,
          completedAt,
          status,
          mode,
          steps,
          diagnosis,
          usage: { inputTokens, outputTokens, durationMs: Math.round(performance.now() - start) },
          llmError,
        };
        await this.storage.saveRun(run, revision, failed);
        await this.storage.saveIncident({
          ...summary,
          status: verified ? 'verified' : status === 'failed' ? 'open' : 'needs_review',
          lastRunId: run.id,
          updatedAt: completedAt,
        });
        this.health = complete
          ? 'healthy'
          : steps.find((s) => s.tool === 'inspect_service')?.status === 'fail'
            ? 'down'
            : 'degraded';
        this.checkedAt = completedAt;
        return run;
      });
    } finally {
      this.active.delete(id);
    }
  }
  async guide(id: string, input: unknown): Promise<Guide> {
    const { resolution } = z
      .object({ resolution: z.string().trim().min(5).max(2000).optional() })
      .strict()
      .parse(input);
    return this.lock.run(async () => {
      const incident = await this.detail(id);
      const records = await this.storage.listRuns(id);
      const latest = records.at(-1);
      if (
        !latest ||
        latest.data.kind !== 'recheck' ||
        latest.data.status !== 'passed' ||
        !allChecksPassed(latest.data.steps) ||
        latest.fixture_revision !== this.lab.revision ||
        incident.status !== 'verified'
      )
        throw new ApiProblem(
          409,
          'VERIFICATION_REQUIRED',
          '가이드 생성에는 현재 환경의 최근 재검증 통과가 필요합니다',
        );
      const source = records
        .filter(
          (r) =>
            r.actual_failure &&
            r.data.status === 'failed' &&
            r.data.diagnosis.confidence === 'supported' &&
            r.data.diagnosis.cause,
        )
        .at(-1);
      if (!source) throw new ApiProblem(409, 'DIAGNOSIS_REQUIRED', '확인된 실패 점검이 필요합니다');
      const existing = await this.storage.incidentGuide(id);
      if (existing) return existing;
      const cause = source.data.diagnosis.cause!;
      const sourceService = source.data.steps.find((s) => s.tool === 'inspect_service');
      const sourceConnection =
        sourceService?.evidence
          .filter((e) => e.startsWith('실제 리스너:') || e.startsWith('연결 설정:'))
          .join(' / ') ?? '원본 점검 근거 참조';
      const guide: Guide = {
        id: randomUUID(),
        title: `${cause} · 재검증 가이드`,
        serviceId: incident.serviceId,
        cause,
        createdAt: new Date().toISOString(),
        sourceIncidentId: id,
        sourceRunId: source.data.id,
        verificationRunId: latest.data.id,
        symptom: incident.symptom,
        conditions: `로컬 장애 실습실 · 샘플 생산실적 데이터 / 재현 당시 ${sourceConnection} / 관측: ${source.data.startedAt}. 최근 실패 점검과 현재 재검증을 연결한 기록입니다.`,
        checks: source.data.steps
          .filter((s) => s.tool !== 'search_guides')
          .map((s) => `${s.name}: ${s.summary} (${s.observedAt})`),
        resolution:
          resolution ??
          '장애 실습실에서 정상 환경으로 전환해 로컬 HTTP 리스너, 연결 주소, 모의 DB 권한 게이트를 복구했습니다. 실제 운영 환경에는 해당하지 않는 샘플 복구 기록입니다.',
        verification: latest.data.steps
          .filter((s) => REQUIRED_TOOLS.includes(s.tool as (typeof REQUIRED_TOOLS)[number]))
          .map((s) => `${s.name}: ${s.summary} (${s.observedAt})`)
          .join('\n'),
      };
      await this.storage.saveGuide(guide);
      return guide;
    });
  }
}
