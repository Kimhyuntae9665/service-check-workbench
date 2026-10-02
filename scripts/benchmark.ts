import { mkdir, writeFile } from 'node:fs/promises';
import { createApplication } from '../server/app';
import type { ScenarioId } from '../shared/contracts';

const application = await createApplication();
try {
  const rows = [];
  for (const scenario of ['service_down', 'wrong_port', 'db_auth'] as ScenarioId[]) {
    const incident = await application.incidents.create({
      title: `${scenario} 재현`,
      symptom: '생산실적 조회 실패를 재현하고 복구합니다.',
      serviceId: 'production-api',
    });
    await application.incidents.changeScenario({ scenario });
    const failed = await application.incidents.run(incident.id, { kind: 'diagnose' });
    await application.incidents.changeScenario({ scenario: 'healthy' });
    const verified = await application.incidents.run(incident.id, { kind: 'recheck' });
    const guide = await application.incidents.guide(incident.id, {});
    rows.push({
      scenario,
      diagnosis: failed.status,
      recheck: verified.status,
      diagnosisMs: failed.usage.durationMs,
      recheckMs: verified.usage.durationMs,
      mcpCalls: failed.steps.length + verified.steps.length,
      guide: guide.id,
    });
  }
  const report = {
    measuredAt: new Date().toISOString(),
    mode: 'demo',
    environment: 'local HTTP + MCP SDK + in-memory PGlite; illustrative sample records',
    note: '실측 소요시간입니다. 토큰 절감률이나 실제 운영 성능을 나타내지 않습니다.',
    results: rows,
  };
  await mkdir('docs', { recursive: true });
  await writeFile('docs/smoke-report.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await application.close();
}
