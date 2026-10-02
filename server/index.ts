import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const envFile = resolve('.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
// Load configuration before importing the gateway/model configuration.
const { createApplication } = await import('./app');
const dataDir = resolve('.data');
mkdirSync(dataDir, { recursive: true });
const application = await createApplication({ dataDir });
const port = Number(process.env.PORT ?? 4310);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('PORT must be an integer between 1024 and 65535');
const server = application.app.listen(port, '127.0.0.1', () =>
  console.log(`점검실: http://127.0.0.1:${port} · 로컬 HTTP 실습실 + MCP + PGlite`),
);
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await application.close();
}
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
