import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import type { AddressInfo } from 'node:net';
import { request as httpRequest } from 'node:http';
import { createApplication } from '../server/app';
import { ApiProblem } from '../server/incidents';
import type { LlmGateway } from '../server/llm';
import type { IncidentDetail, ScenarioId, Workspace } from '../shared/contracts';

const expectProblem = (code: string) => (error: unknown) =>
  error instanceof ApiProblem && error.code === code;
const newIncident = {
  title: '생산실적 조회 오류',
  symptom: '생산실적 화면을 열면 응답이 없습니다.',
  serviceId: 'production-api',
  priority: 'high',
};

test('fresh workspace contains one open illustrative incident and no fabricated results', async () => {
  const application = await createApplication();
  try {
    const workspace = await application.incidents.workspace();
    assert.equal(workspace.incidents.length, 1);
    assert.equal(workspace.incidents[0].status, 'open');
    assert.equal(workspace.services[0].status, 'unknown');
    assert.equal(workspace.services[0].lastCheckedAt, null);
    assert.equal(workspace.guides.length, 0);
    assert.equal(workspace.runtime.mcp, 'connected');
    const incident = await application.incidents.detail(workspace.incidents[0].id);
    assert.equal(incident.runs.length, 0);
    await assert.rejects(
      application.incidents.guide(incident.id, {}),
      expectProblem('VERIFICATION_REQUIRED'),
    );
    const first = await application.incidents.run(incident.id, { kind: 'diagnose' });
    assert.equal(first.status, 'inconclusive');
    assert.equal(first.diagnosis.cause, null);
    assert.equal(first.steps.filter((s) => s.status === 'pass').length, 4);
    const recheck = await application.incidents.run(incident.id, { kind: 'recheck' });
    assert.equal(recheck.status, 'inconclusive');
    await assert.rejects(
      application.incidents.guide(incident.id, {}),
      expectProblem('VERIFICATION_REQUIRED'),
    );
  } finally {
    await application.close();
  }
});

test('three real MCP fault paths are isolated and only fresh healthy rechecks generate guides', async () => {
  const application = await createApplication();
  try {
    for (const scenario of ['service_down', 'wrong_port', 'db_auth'] as ScenarioId[]) {
      const incident = await application.incidents.create(newIncident);
      await application.incidents.changeScenario({ scenario });
      const run = await application.incidents.run(incident.id, { kind: 'diagnose' });
      assert.equal(run.status, 'failed');
      assert.equal(run.steps.length, 5);
      assert.ok(
        run.steps.every((s) => s.transport === 'mcp' && s.raw && s.observedAt && s.durationMs >= 0),
      );
      const byTool = new Map(run.steps.map((s) => [s.tool, s]));
      if (scenario === 'service_down') {
        assert.equal(application.lab.running, false);
        assert.equal(byTool.get('inspect_service')?.status, 'fail');
        assert.equal(byTool.get('probe_database')?.status, 'pass');
        assert.match(run.diagnosis.cause ?? '', /서비스 중지/);
      } else if (scenario === 'wrong_port') {
        assert.equal(application.lab.running, true);
        assert.notEqual(application.lab.endpoint, application.lab.actualEndpoint);
        assert.equal(byTool.get('inspect_service')?.status, 'pass');
        assert.equal(byTool.get('probe_http')?.status, 'fail');
        assert.match(run.diagnosis.cause ?? '', /포트 불일치/);
      } else {
        assert.equal(byTool.get('probe_http')?.status, 'pass');
        assert.equal(byTool.get('probe_database')?.status, 'fail');
        assert.match(byTool.get('read_production')?.raw ?? '', /403/);
        assert.match(run.diagnosis.cause ?? '', /모의 DB/);
      }
      await assert.rejects(
        application.incidents.guide(incident.id, {}),
        expectProblem('VERIFICATION_REQUIRED'),
      );
      await application.incidents.changeScenario({ scenario: 'healthy' });
      const recheck = await application.incidents.run(incident.id, { kind: 'recheck' });
      assert.equal(recheck.status, 'passed');
      assert.equal(recheck.steps.filter((s) => s.status === 'pass').length, 4);
      assert.match(recheck.steps.find((s) => s.tool === 'read_production')!.raw, /산업용 포장재/);
      const guide = await application.incidents.guide(incident.id, {
        resolution: '로컬 실습실의 연결과 서비스를 정상 환경으로 복구했습니다.',
      });
      assert.equal(guide.sourceRunId, run.id);
      assert.equal(guide.verificationRunId, recheck.id);
      assert.equal((await application.incidents.detail(incident.id)).status, 'verified');
      await application.incidents.changeScenario({ scenario: 'healthy' });
      assert.equal((await application.incidents.detail(incident.id)).status, 'needs_review');
      await assert.rejects(
        application.incidents.guide(incident.id, {}),
        expectProblem('VERIFICATION_REQUIRED'),
      );
    }
  } finally {
    await application.close();
  }
});

test('parameterized SQL preserves hostile text as text; MCP denies arbitrary tools and targets', async () => {
  const application = await createApplication();
  try {
    const malicious = "'); DROP TABLE production_records; -- <script>alert(1)</script>";
    const incident = await application.incidents.create({
      ...newIncident,
      title: malicious,
      symptom: malicious,
    });
    assert.equal((await application.incidents.detail(incident.id)).title, malicious);
    assert.equal((await application.storage.production()).length, 2);
    assert.deepEqual(await application.storage.searchGuides(malicious), []);
    await assert.rejects(
      application.diagnostics.call('run_shell', { command: 'echo unsafe' }),
      /허용되지 않은/,
    );
    await assert.rejects(
      application.diagnostics.call('probe_http', {
        serviceId: 'production-api',
        url: 'https://example.com',
      }),
    );
    const unknown = await application.diagnostics.client.callTool({
      name: 'unregistered_tool',
      arguments: {},
    });
    assert.equal(unknown.isError, true);
    const wrongTarget = await application.diagnostics.client.callTool({
      name: 'probe_http',
      arguments: { serviceId: 'outside-target' },
    });
    assert.equal(wrongTarget.isError, true);
  } finally {
    await application.close();
  }
});

test('latest failed recheck supplies the recovered cause and guide source even when the cause changes', async () => {
  const application = await createApplication();
  try {
    const id = (await application.incidents.workspace()).incidents[0].id;
    await application.incidents.changeScenario({ scenario: 'service_down' });
    const firstFailure = await application.incidents.run(id, { kind: 'diagnose' });
    await application.incidents.changeScenario({ scenario: 'wrong_port' });
    const latestFailure = await application.incidents.run(id, { kind: 'recheck' });
    assert.equal(latestFailure.status, 'failed');
    assert.notEqual(latestFailure.diagnosis.cause, firstFailure.diagnosis.cause);
    const failedConnector = application.lab.endpoint;
    await application.incidents.changeScenario({ scenario: 'healthy' });
    const recovered = await application.incidents.run(id, { kind: 'recheck' });
    assert.equal(recovered.status, 'passed');
    assert.equal(recovered.diagnosis.cause, latestFailure.diagnosis.cause);
    const guide = await application.incidents.guide(id, {});
    assert.equal(guide.sourceRunId, latestFailure.id);
    assert.equal(guide.cause, latestFailure.diagnosis.cause);
    assert.equal(guide.verificationRunId, recovered.id);
    assert.ok(guide.conditions.includes(failedConnector));
    assert.ok(guide.checks.some((check) => check.includes('로컬 HTTP 서비스가 실행 중입니다')));

    // A supported failure is evidence regardless of the request's run-kind label.
    const other = await application.incidents.create(newIncident);
    await application.incidents.changeScenario({ scenario: 'db_auth' });
    const recheckFailure = await application.incidents.run(other.id, { kind: 'recheck' });
    assert.equal(recheckFailure.status, 'failed');
    await application.incidents.changeScenario({ scenario: 'healthy' });
    const recheckRecovery = await application.incidents.run(other.id, { kind: 'recheck' });
    assert.equal(recheckRecovery.status, 'passed');
    const otherGuide = await application.incidents.guide(other.id, {});
    assert.equal(otherGuide.sourceRunId, recheckFailure.id);
    assert.equal(otherGuide.cause, recheckFailure.diagnosis.cause);
  } finally {
    await application.close();
  }
});

test('a passed label cannot authorize a guide when a required SQL check is missing', async () => {
  const application = await createApplication();
  try {
    const id = (await application.incidents.workspace()).incidents[0].id;
    await application.incidents.changeScenario({ scenario: 'service_down' });
    await application.incidents.run(id, { kind: 'diagnose' });
    await application.incidents.changeScenario({ scenario: 'healthy' });
    const complete = await application.incidents.run(id, { kind: 'recheck' });
    assert.equal(complete.status, 'passed');
    // Simulate a malformed persisted result: status alone must never permit publishing.
    const later = new Date(Date.parse(complete.startedAt) + 1000).toISOString();
    await application.storage.saveRun(
      {
        ...complete,
        id: 'partial-recheck',
        startedAt: later,
        completedAt: later,
        steps: complete.steps.filter((s) => s.tool !== 'probe_database'),
      },
      application.lab.revision,
      false,
    );
    await assert.rejects(
      application.incidents.guide(id, {}),
      expectProblem('VERIFICATION_REQUIRED'),
    );
  } finally {
    await application.close();
  }
});

test('persistent incidents, evidence and guides survive restart while current verification resets', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jeomgeomsil-test-'));
  let application = await createApplication({ dataDir: directory });
  try {
    const id = (await application.incidents.workspace()).incidents[0].id;
    await application.incidents.changeScenario({ scenario: 'wrong_port' });
    const diagnosis = await application.incidents.run(id, { kind: 'diagnose' });
    await application.incidents.changeScenario({ scenario: 'healthy' });
    const recheck = await application.incidents.run(id, { kind: 'recheck' });
    const guide = await application.incidents.guide(id, {});
    await application.close();
    application = await createApplication({ dataDir: directory });
    const persisted = await application.incidents.detail(id);
    assert.equal(persisted.runs.length, 2);
    assert.equal(persisted.runs[0].id, diagnosis.id);
    assert.equal(persisted.runs[1].id, recheck.id);
    assert.equal(persisted.guide?.id, guide.id);
    assert.equal(persisted.status, 'needs_review');
    assert.equal((await application.incidents.workspace()).services[0].status, 'unknown');
    await assert.rejects(
      application.incidents.guide(id, {}),
      expectProblem('VERIFICATION_REQUIRED'),
    );
  } finally {
    await application.close();
    const relativePath = relative(tmpdir(), directory);
    assert.ok(relativePath.startsWith('jeomgeomsil-test-') && !relativePath.includes('..'));
    await rm(directory, { recursive: true, force: true });
  }
});

test('live provider failures and invented evidence remain inconclusive with real probes preserved', async () => {
  const outputs: LlmGateway[] = [
    {
      complete: async () => {
        throw new Error('Injected provider unavailable');
      },
    },
    { complete: async () => ({ message: { content: 'not JSON' } }) },
    {
      complete: async () => ({
        message: {
          content: JSON.stringify({
            title: '완료',
            summary: '원인 확인',
            cause: '가짜 원인',
            confidence: 'supported',
            evidenceIds: ['invented-step'],
            nextAction: '완료',
          }),
        },
      }),
    },
    {
      complete: async () => ({
        message: {
          content: null,
          tool_calls: [
            {
              id: 'illegal',
              type: 'function',
              function: { name: 'run_shell', arguments: '{"command":"unsafe"}' },
            },
          ],
        },
      }),
    },
  ];
  for (const llm of outputs) {
    const application = await createApplication({ llm });
    try {
      const id = (await application.incidents.workspace()).incidents[0].id;
      await application.incidents.runtime({ mode: 'live' });
      await application.incidents.changeScenario({ scenario: 'service_down' });
      const run = await application.incidents.run(id, { kind: 'diagnose' });
      assert.equal(run.mode, 'live');
      assert.equal(run.status, 'inconclusive');
      assert.ok(run.llmError);
      assert.equal(run.steps.filter((s) => s.tool === 'probe_database')[0].status, 'pass');
      assert.equal(run.steps.length, 5);
      assert.equal(run.diagnosis.cause, null);
      await application.incidents.changeScenario({ scenario: 'healthy' });
      await application.incidents.run(id, { kind: 'recheck' });
      await assert.rejects(
        application.incidents.guide(id, {}),
        expectProblem('VERIFICATION_REQUIRED'),
      );
    } finally {
      await application.close();
    }
  }
});

test('live tool loop executes actual allowed MCP requests and validates referenced evidence', async () => {
  let requests = 0;
  const llm: LlmGateway = {
    complete: async (messages) => {
      requests++;
      if (requests === 1)
        return {
          message: {
            content: null,
            tool_calls: [
              {
                id: 'inspect-again',
                type: 'function',
                function: { name: 'inspect_service', arguments: '{"serviceId":"production-api"}' },
              },
            ],
          },
          usage: { prompt_tokens: 10, completion_tokens: 4 },
        };
      const evidence = JSON.parse(messages.at(-1)!.content!);
      return {
        message: {
          content: JSON.stringify({
            title: '실제 서비스 중지 확인',
            summary: '리스너가 중지된 근거를 확인했습니다.',
            cause: '생산실적 HTTP 서비스 중지',
            confidence: 'supported',
            evidenceIds: [evidence.id],
            nextAction: '서비스를 복구하고 다시 점검하세요.',
          }),
        },
        usage: { prompt_tokens: 12, completion_tokens: 8 },
      };
    },
  };
  const application = await createApplication({ llm });
  try {
    const id = (await application.incidents.workspace()).incidents[0].id;
    await application.incidents.runtime({ mode: 'live' });
    await application.incidents.changeScenario({ scenario: 'service_down' });
    const run = await application.incidents.run(id, { kind: 'diagnose' });
    assert.equal(run.status, 'failed');
    assert.equal(requests, 2);
    assert.equal(run.steps.length, 6);
    assert.equal(run.usage.inputTokens, 22);
    assert.equal(run.usage.outputTokens, 12);
    assert.equal(run.llmError, null);
  } finally {
    await application.close();
  }
});

test('fixture mutations serialize after runs and duplicate incident runs are rejected', async () => {
  let release!: () => void;
  let entered!: () => void;
  const enteredPromise = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const releasePromise = new Promise<void>((resolve) => {
    release = resolve;
  });
  const llm: LlmGateway = {
    complete: async () => {
      entered();
      await releasePromise;
      throw new Error('Injected test stop');
    },
  };
  const application = await createApplication({ llm });
  try {
    const id = (await application.incidents.workspace()).incidents[0].id;
    await application.incidents.runtime({ mode: 'live' });
    const runPromise = application.incidents.run(id, { kind: 'diagnose' });
    await enteredPromise;
    await assert.rejects(
      application.incidents.run(id, { kind: 'recheck' }),
      expectProblem('RUN_IN_PROGRESS'),
    );
    const fixturePromise = application.incidents.changeScenario({ scenario: 'service_down' });
    assert.equal(application.lab.scenario, 'healthy');
    release();
    await runPromise;
    await fixturePromise;
    assert.equal(application.lab.scenario, 'service_down');
    assert.equal((await application.incidents.workspace()).services[0].status, 'unknown');
  } finally {
    release();
    await application.close();
  }
});

test('HTTP API validates input, protects loopback origins and exposes contract payloads', async () => {
  const application = await createApplication();
  const listener = application.app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => listener.once('listening', resolve));
  const base = `http://127.0.0.1:${(listener.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  try {
    const workspace = (await (await fetch(base + '/api/workspace')).json()) as Workspace;
    assert.equal(workspace.runtime.storage, 'pglite');
    if (!workspace.runtime.liveConfigured) {
      const live = await post('/api/runtime', { mode: 'live' });
      assert.equal(live.status, 409);
      assert.equal((await live.json()).code, 'LIVE_NOT_CONFIGURED');
    }
    const blocked = await post('/api/incidents', newIncident, { Origin: 'https://evil.example' });
    assert.equal(blocked.status, 403);
    assert.equal((await blocked.json()).code, 'ORIGIN_NOT_ALLOWED');
    const badHostStatus = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(
        base + '/api/workspace',
        { headers: { Host: 'evil.example' } },
        (response) => {
          response.resume();
          resolve(response.statusCode!);
        },
      );
      request.on('error', reject);
      request.end();
    });
    assert.equal(badHostStatus, 403);
    assert.equal(
      (await post('/api/incidents', { ...newIncident, serviceId: 'unregistered' })).status,
      400,
    );
    assert.equal((await post('/api/lab/scenario', { scenario: 'unsupported' })).status, 400);
    const created = await post('/api/incidents', newIncident, { Origin: base });
    assert.equal(created.status, 201);
    const detail = (await created.json()) as IncidentDetail;
    assert.equal(detail.runs.length, 0);
    assert.equal((await post(`/api/incidents/${detail.id}/guides`, {})).status, 409);
    assert.equal((await fetch(base + '/api/incidents/missing')).status, 404);
    assert.equal((await fetch(base + '/api/health')).status, 200);
    assert.equal(
      (await post('/api/incidents', { ...newIncident, symptom: 'x'.repeat(25000) })).status,
      413,
    );
    const malformed = await fetch(base + '/api/incidents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).code, 'INVALID_JSON');
  } finally {
    listener.closeAllConnections();
    await new Promise<void>((resolve) => listener.close(() => resolve()));
    await application.close();
  }
});
