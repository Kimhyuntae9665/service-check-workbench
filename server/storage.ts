import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import type { Guide, IncidentSummary, Run } from '../shared/contracts';

export class Storage {
  readonly db: PGlite;
  constructor(dataDir?: string) {
    this.db = new PGlite(dataDir);
  }
  async initialize() {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS services (id text PRIMARY KEY, data jsonb NOT NULL);
      CREATE TABLE IF NOT EXISTS incidents (id text PRIMARY KEY, data jsonb NOT NULL);
      CREATE TABLE IF NOT EXISTS runs (id text PRIMARY KEY, incident_id text NOT NULL REFERENCES incidents(id), data jsonb NOT NULL, fixture_revision text NOT NULL, actual_failure boolean NOT NULL);
      CREATE INDEX IF NOT EXISTS runs_incident_started_idx ON runs (incident_id, (data->>'startedAt'));
      CREATE TABLE IF NOT EXISTS guides (id text PRIMARY KEY, incident_id text UNIQUE NOT NULL REFERENCES incidents(id), data jsonb NOT NULL);
      CREATE TABLE IF NOT EXISTS production_records (id text PRIMARY KEY, line text NOT NULL, product text NOT NULL, quantity integer NOT NULL, shift text NOT NULL);
      INSERT INTO production_records VALUES ('sample-01','A라인','산업용 포장재',1240,'day'),('sample-02','B라인','전자 부품',860,'day') ON CONFLICT DO NOTHING;
    `);
    await this.db.query(
      'INSERT INTO services (id,data) VALUES ($1,$2::jsonb) ON CONFLICT DO NOTHING',
      [
        'production-api',
        JSON.stringify({ name: '생산실적 조회', environment: '로컬 장애 실습실' }),
      ],
    );
    const { rows } = await this.db.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM incidents',
    );
    if (rows[0].count === 0) {
      const now = new Date().toISOString();
      await this.saveIncident({
        id: randomUUID(),
        title: '생산실적 화면이 응답하지 않습니다',
        symptom: '생산실적 조회 요청이 실패합니다. 서비스, 연결 주소, DB 권한을 확인해 주세요.',
        serviceId: 'production-api',
        serviceName: '생산실적 조회',
        priority: 'high',
        status: 'open',
        createdAt: now,
        updatedAt: now,
        lastRunId: null,
      });
    }
    // Restart invalidates current verification: persistent evidence remains historical.
    await this.db.query(
      "UPDATE incidents SET data=jsonb_set(data,'{status}','\"needs_review\"'::jsonb) WHERE data->>'status'='verified'",
    );
  }
  async listIncidents() {
    return (
      await this.db.query<{ data: IncidentSummary }>(
        "SELECT data FROM incidents ORDER BY data->>'createdAt' DESC",
      )
    ).rows.map((r) => r.data);
  }
  async getIncident(id: string) {
    return (
      await this.db.query<{ data: IncidentSummary }>('SELECT data FROM incidents WHERE id=$1', [id])
    ).rows[0]?.data;
  }
  async saveIncident(value: IncidentSummary) {
    await this.db.query(
      'INSERT INTO incidents (id,data) VALUES ($1,$2::jsonb) ON CONFLICT (id) DO UPDATE SET data=excluded.data',
      [value.id, JSON.stringify(value)],
    );
  }
  async listRuns(id: string) {
    return (
      await this.db.query<{ data: Run; fixture_revision: string; actual_failure: boolean }>(
        "SELECT data,fixture_revision,actual_failure FROM runs WHERE incident_id=$1 ORDER BY data->>'startedAt' ASC",
        [id],
      )
    ).rows;
  }
  async saveRun(run: Run, revision: string, actualFailure: boolean) {
    await this.db.query(
      'INSERT INTO runs (id,incident_id,data,fixture_revision,actual_failure) VALUES ($1,$2,$3::jsonb,$4,$5)',
      [run.id, run.incidentId, JSON.stringify(run), revision, actualFailure],
    );
  }
  async listGuides() {
    return (
      await this.db.query<{ data: Guide }>(
        "SELECT data FROM guides ORDER BY data->>'createdAt' DESC",
      )
    ).rows.map((r) => r.data);
  }
  async getGuide(id: string) {
    return (await this.db.query<{ data: Guide }>('SELECT data FROM guides WHERE id=$1', [id]))
      .rows[0]?.data;
  }
  async incidentGuide(id: string) {
    return (
      (await this.db.query<{ data: Guide }>('SELECT data FROM guides WHERE incident_id=$1', [id]))
        .rows[0]?.data ?? null
    );
  }
  async saveGuide(guide: Guide) {
    await this.db.query('INSERT INTO guides (id,incident_id,data) VALUES ($1,$2,$3::jsonb)', [
      guide.id,
      guide.sourceIncidentId,
      JSON.stringify(guide),
    ]);
  }
  async searchGuides(query: string) {
    return (
      await this.db.query<{ data: Guide }>(
        "SELECT data FROM guides WHERE strpos(lower(data::text),lower($1))>0 ORDER BY data->>'createdAt' DESC LIMIT 5",
        [query],
      )
    ).rows.map((r) => r.data);
  }
  async production() {
    return (
      await this.db.query<{
        id: string;
        line: string;
        product: string;
        quantity: number;
        shift: string;
      }>(
        'SELECT id,line,product,quantity,shift FROM production_records WHERE shift=$1 ORDER BY id',
        ['day'],
      )
    ).rows;
  }
  async close() {
    await this.db.close();
  }
}
