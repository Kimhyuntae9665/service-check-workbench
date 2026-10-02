import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { ScenarioId } from '../shared/contracts';
import type { Storage } from './storage';

export const scenarioDefinitions = [
  {
    id: 'healthy' as const,
    label: '정상 환경',
    description: 'HTTP 응답, PostgreSQL 조회, 생산실적 기능을 실제로 확인합니다.',
  },
  {
    id: 'service_down' as const,
    label: '서비스 중지',
    description: '로컬 HTTP 리스너를 중지해 연결 실패를 재현합니다.',
  },
  {
    id: 'wrong_port' as const,
    label: '연결 포트 오류',
    description: '서비스는 실행되지만 연결 설정이 닫힌 포트를 가리킵니다.',
  },
  {
    id: 'db_auth' as const,
    label: 'DB 연결 권한 거부',
    description:
      '모의 DB 연결 권한 API가 PostgreSQL 쿼리 전에 요청을 거부합니다. PostgreSQL 네이티브 인증 재현은 아닙니다.',
  },
];

export class DiagnosticLab {
  scenario: ScenarioId = 'healthy';
  revision = randomUUID();
  private listener: Server | null = null;
  private targetPort = 0;
  private wrongPort = 0;
  constructor(private storage: Storage) {}
  get running() {
    return this.listener?.listening ?? false;
  }
  get actualEndpoint() {
    return `http://127.0.0.1:${this.targetPort}`;
  }
  get endpoint() {
    return `http://127.0.0.1:${this.scenario === 'wrong_port' ? this.wrongPort : this.targetPort}`;
  }
  get databaseAllowed() {
    return this.scenario !== 'db_auth';
  }
  async initialize() {
    const reserved = createServer();
    await new Promise<void>((resolve, reject) => {
      reserved.once('error', reject);
      reserved.listen(0, '127.0.0.1', resolve);
    });
    this.wrongPort = (reserved.address() as AddressInfo).port;
    await new Promise<void>((resolve, reject) =>
      reserved.close((error) => (error ? reject(error) : resolve())),
    );
    await this.start();
  }
  private async start() {
    if (this.running) return;
    const server = createServer(async (req, res) => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      if (req.url === '/health') {
        res.end(JSON.stringify({ status: 'ok', service: 'production-api' }));
        return;
      }
      if (req.url === '/production') {
        if (!this.databaseAllowed) {
          res.statusCode = 403;
          res.end(
            JSON.stringify({
              error: '모의 DB 연결 권한 API: 권한 거부',
              code: 'DB_PERMISSION_DENIED',
            }),
          );
          return;
        }
        try {
          res.end(
            JSON.stringify({
              records: await this.storage.production(),
              source: 'PGlite PostgreSQL · 데모 생산실적 데이터',
            }),
          );
        } catch {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: 'PostgreSQL 조회 실패' }));
        }
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'Unknown lab route' }));
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.targetPort, '127.0.0.1', resolve);
    });
    this.listener = server;
    this.targetPort = (server.address() as AddressInfo).port;
  }
  private async stop() {
    const server = this.listener;
    this.listener = null;
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }
  async change(scenario: ScenarioId) {
    if (scenario === 'service_down') await this.stop();
    else await this.start();
    this.scenario = scenario;
    this.revision = randomUUID();
  }
  async close() {
    await this.stop();
  }
}
