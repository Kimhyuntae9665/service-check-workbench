import express from 'express';
import { z } from 'zod';
import { resolve } from 'node:path';
import { Storage } from './storage';
import { DiagnosticLab } from './lab';
import { Diagnostics } from './diagnostics';
import { ApiProblem, IncidentService } from './incidents';
import type { LlmGateway } from './llm';

export async function createApplication(
  options: { dataDir?: string; llm?: LlmGateway; distDir?: string } = {},
) {
  const storage = new Storage(options.dataDir);
  await storage.initialize();
  const lab = new DiagnosticLab(storage);
  await lab.initialize();
  const diagnostics = new Diagnostics(lab, storage);
  await diagnostics.initialize();
  const incidents = new IncidentService(
    storage,
    diagnostics,
    lab,
    options.llm,
    Boolean(options.llm),
  );
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const host = req.headers.host;
    const expected = host && /^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host);
    if (!expected) {
      res
        .status(403)
        .json({ error: '로컬 호스트에서만 사용할 수 있습니다', code: 'HOST_NOT_ALLOWED' });
      return;
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      const origin = req.headers.origin;
      if (origin && origin !== `http://${host}`) {
        res
          .status(403)
          .json({ error: '동일한 로컬 앱에서 요청해 주세요', code: 'ORIGIN_NOT_ALLOWED' });
        return;
      }
      if (req.headers['sec-fetch-site'] === 'cross-site') {
        res
          .status(403)
          .json({ error: '다른 사이트의 요청은 허용되지 않습니다', code: 'ORIGIN_NOT_ALLOWED' });
        return;
      }
      if (!req.is('application/json')) {
        res.status(415).json({ error: 'JSON 요청이 필요합니다', code: 'JSON_REQUIRED' });
        return;
      }
    }
    next();
  });
  app.use(express.json({ limit: '24kb', strict: true }));
  app.get('/api/health', (_req, res) =>
    res.json({
      status: 'ok',
      mcp: diagnostics.connected ? 'connected' : 'disconnected',
      storage: 'pglite',
      environment: 'local lab',
    }),
  );
  app.get('/api/workspace', async (_req, res) => res.json(await incidents.workspace()));
  app.get('/api/incidents/:id', async (req, res) =>
    res.json(await incidents.detail(req.params.id)),
  );
  app.post('/api/incidents', async (req, res) =>
    res.status(201).json(await incidents.create(req.body)),
  );
  app.post('/api/incidents/:id/runs', async (req, res) =>
    res.json(await incidents.run(req.params.id, req.body)),
  );
  app.post('/api/incidents/:id/guides', async (req, res) =>
    res.status(201).json(await incidents.guide(req.params.id, req.body)),
  );
  app.get('/api/guides/:id', async (req, res) => {
    const guide = await storage.getGuide(req.params.id);
    if (!guide) throw new ApiProblem(404, 'GUIDE_NOT_FOUND', '가이드를 찾을 수 없습니다');
    res.json(guide);
  });
  app.post('/api/lab/scenario', async (req, res) =>
    res.json(await incidents.changeScenario(req.body)),
  );
  app.post('/api/runtime', async (req, res) => res.json(await incidents.runtime(req.body)));
  app.use('/api', (_req, res) =>
    res.status(404).json({ error: 'API 경로를 찾을 수 없습니다', code: 'NOT_FOUND' }),
  );
  const distDir = options.distDir ?? resolve('dist');
  app.use(express.static(distDir));
  app.get('/{*path}', (_req, res, next) =>
    res.sendFile(resolve(distDir, 'index.html'), (error) => (error ? next(error) : undefined)),
  );
  app.use(
    (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      if (error instanceof ApiProblem) {
        res.status(error.status).json({ error: error.message, code: error.code });
        return;
      }
      if (error instanceof z.ZodError) {
        res
          .status(400)
          .json({ error: '입력 형식이나 길이를 확인해 주세요', code: 'INVALID_INPUT' });
        return;
      }
      if (error instanceof SyntaxError) {
        res.status(400).json({ error: '올바른 JSON 요청이 필요합니다', code: 'INVALID_JSON' });
        return;
      }
      const problem = error as { status?: number; type?: string };
      if (problem?.type === 'entity.too.large') {
        res.status(413).json({ error: '요청 본문이 너무 큽니다', code: 'BODY_TOO_LARGE' });
        return;
      }
      console.error('Application error:', error instanceof Error ? error.name : 'unknown');
      res
        .status(500)
        .json({
          error: '요청을 처리하지 못했습니다. 서버 상태를 확인해 주세요',
          code: 'INTERNAL_ERROR',
        });
    },
  );
  return {
    app,
    incidents,
    diagnostics,
    lab,
    storage,
    close: async () => {
      await diagnostics.close();
      await lab.close();
      await storage.close();
    },
  };
}
