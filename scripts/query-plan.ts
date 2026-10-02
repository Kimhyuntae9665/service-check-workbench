import { mkdir, writeFile } from 'node:fs/promises';
import { Storage } from '../server/storage';

// Separate, disposable in-memory dataset. Never opens .data or changes user records.
const storage = new Storage();
await storage.initialize();
try {
  await storage.db.exec(`
    SET enable_seqscan = on;
    INSERT INTO incidents (id,data)
      SELECT 'plan-incident-'||n, '{}'::jsonb FROM generate_series(1,100) AS n;
    INSERT INTO runs (id,incident_id,data,fixture_revision,actual_failure)
      SELECT 'plan-run-'||n,'plan-incident-'||((n-1)%100+1),
        jsonb_build_object('startedAt',to_char(timestamp '2026-01-01'+n*interval '1 second','YYYY-MM-DD HH24:MI:SS')),
        'synthetic-query-plan',false FROM generate_series(1,10000) AS n;
    DROP INDEX runs_incident_started_idx;
    ANALYZE runs;
  `);
  const query = `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT data,fixture_revision,actual_failure FROM runs WHERE incident_id=$1 ORDER BY data->>'startedAt' ASC`;
  const before = await storage.db.query(query, ['plan-incident-42']);
  await storage.db.exec(
    `CREATE INDEX runs_incident_started_idx ON runs (incident_id, (data->>'startedAt')); ANALYZE runs;`,
  );
  const after = await storage.db.query(query, ['plan-incident-42']);
  const report = {
    measuredAt: new Date().toISOString(),
    environment: 'PGlite in-memory PostgreSQL; enable_seqscan=on for both plans',
    dataset: 'Synthetic: 100 incidents, 10000 runs; selected incident has 100 runs',
    note: 'Single local query execution, not production throughput or a repeated performance estimate.',
    query,
    parameters: ['plan-incident-42'],
    before: before.rows,
    after: after.rows,
  };
  await mkdir('docs', { recursive: true });
  await writeFile('docs/query-plan.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await storage.close();
}
