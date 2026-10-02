import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { LlmGateway, LlmResponse } from '../server/llm';

// Credentials stay in the server process; no keys or complete prompts enter this report.
const envFile = resolve('.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

if (!process.env.OPENAI_API_KEY) {
  console.log(
    '실제 LLM 검증 보류: 프로젝트 .env에 OPENAI_API_KEY를 직접 설정하세요. 외부 요청과 결과 파일 생성은 하지 않았습니다.',
  );
  process.exitCode = 2;
} else {
  const { OpenAiGateway, LIVE_MODEL } = await import('../server/llm');
  const { createApplication } = await import('../server/app');
  const requests: {
    startedAt: string;
    completedAt: string;
    providerEvidence: LlmResponse['providerEvidence'];
    usage: LlmResponse['usage'] | null;
    modelRequestedTools: string[];
  }[] = [];
  const gateway = new OpenAiGateway();
  let attempts = 0;
  const observedGateway: LlmGateway = {
    async complete(...parameters: Parameters<LlmGateway['complete']>) {
      if (++attempts > 6) throw new Error('실제 검증의 총 API 요청 한도 6회를 초과했습니다');
      const startedAt = new Date().toISOString();
      const response = await gateway.complete(...parameters);
      requests.push({
        startedAt,
        completedAt: new Date().toISOString(),
        providerEvidence: response.providerEvidence,
        usage: response.usage ?? null,
        modelRequestedTools: response.message.tool_calls?.map((call) => call.function.name) ?? [],
      });
      return response;
    },
  };
  console.log(
    '샘플 증상과 실제 로컬 점검 근거로 OpenAI API 검증을 시작합니다. 최대 6회 요청이며 API 비용이 발생할 수 있습니다.',
  );
  // An isolated memory DB protects the running app's records and current environment.
  const application = await createApplication({ llm: observedGateway });
  try {
    await application.incidents.runtime({ mode: 'live' });
    const incident = await application.incidents.create({
      title: '생산실적 연결 오류 · 실제 LLM 검증',
      symptom:
        '생산실적 화면에 연결 오류가 나타납니다. 서버 실행 상태, 연결 주소, DB와 업무 조회를 확인해주세요.',
      serviceId: 'production-api',
    });
    await application.incidents.changeScenario({ scenario: 'wrong_port' });
    const diagnosis = await application.incidents.run(incident.id, { kind: 'diagnose' });
    let recheck = null;
    let guide = null;
    if (diagnosis.status === 'failed' && !diagnosis.llmError) {
      await application.incidents.changeScenario({ scenario: 'healthy' });
      recheck = await application.incidents.run(incident.id, { kind: 'recheck' });
      if (recheck.status === 'passed' && !recheck.llmError)
        guide = await application.incidents.guide(incident.id, {
          resolution:
            '독립 로컬 실습실의 연결 포트를 정상화하고 HTTP·SQL·생산실적 조회를 다시 실행했습니다.',
        });
    }
    const verified = Boolean(guide && requests.length >= 2);
    const report = {
      status: verified ? 'verified' : 'inconclusive',
      measuredAt: new Date().toISOString(),
      provider: 'OpenAI API',
      endpoint: 'https://api.openai.com/v1/chat/completions',
      configuredModel: LIVE_MODEL,
      environment: 'isolated local HTTP + MCP SDK + in-memory PGlite, illustrative records',
      note: '실제 provider 요청 기록입니다. 고객 시스템 운영·성능 개선·외부 MCP 배포 증거는 아닙니다. 모델이 추가 도구를 선택하지 않으면 Agent 자율 도구 선택까지 증명하지 않습니다.',
      attempts: Math.min(attempts, 6),
      successfulRequests: requests,
      diagnosis,
      recheck,
      guide,
    };
    await mkdir('docs', { recursive: true });
    await writeFile('docs/llm-evidence.json', JSON.stringify(report, null, 2) + '\n');
    console.log(
      JSON.stringify(
        {
          status: report.status,
          report: 'docs/llm-evidence.json',
          successfulRequests: requests.length,
          diagnosis: diagnosis.status,
          recheck: recheck?.status ?? 'not_run',
          guideSaved: Boolean(guide),
        },
        null,
        2,
      ),
    );
    if (!verified) process.exitCode = 1;
  } finally {
    await application.close();
  }
}
