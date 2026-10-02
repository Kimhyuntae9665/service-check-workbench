import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Check,
  Database,
  FileCheck2,
  LoaderCircle,
  Monitor,
  RotateCcw,
  Search,
  Server,
  Wrench,
} from 'lucide-react';
import type { IncidentDetail, ScenarioId, Step } from '../shared/contracts';
import './demo-journey.css';

export interface DemoJourneyProps {
  incident: IncidentDetail | null;
  busy: string | null;
  currentScenario: ScenarioId;
  mode: 'demo' | 'live';
  onStart: () => void;
  onRestore: () => void;
  onSave: () => void;
  onOpenGuide: () => void;
  onExit: () => void;
}

const probes = [
  { tool: 'inspect_service', label: '서비스 기동', icon: Server },
  { tool: 'probe_http', label: 'HTTP 연결', icon: Monitor },
  { tool: 'probe_database', label: 'DB 조회', icon: Database },
  { tool: 'read_production', label: '생산실적 조회', icon: FileCheck2 },
];

function result(step?: Step) {
  if (!step) return '미실행';
  return { pass: '통과', fail: '실패', error: '점검 오류', info: '참고' }[step.status];
}

function observedPort(step: Step | undefined, prefix: string) {
  const endpoint = step?.evidence
    .find((line) => line.startsWith(prefix))
    ?.slice(prefix.length)
    .trim();
  if (!endpoint) return null;
  try {
    const port = new URL(endpoint).port;
    return port || null;
  } catch {
    return null;
  }
}

export default function DemoJourney({
  incident,
  busy,
  currentScenario,
  mode,
  onStart,
  onRestore,
  onSave,
  onOpenGuide,
  onExit,
}: DemoJourneyProps) {
  const busyText =
    busy === 'demo-start'
      ? '연결 오류를 재현하고 원인을 확인하고 있습니다…'
      : busy === 'demo-restore'
        ? '연결 설정을 복구하고 네 가지 점검을 다시 실행하고 있습니다…'
        : busy === 'demo-save'
          ? '실패 원인과 재검증 근거를 가이드에 저장하고 있습니다…'
          : busy
            ? '작업을 처리하고 있습니다…'
            : null;

  if (!incident) {
    return (
      <section className="dj-intro" aria-labelledby="dj-intro-title" aria-busy={!!busy}>
        <div className="dj-intro-copy">
          <span className="dj-kicker">
            <Monitor size={14} aria-hidden="true" /> IT 담당자의 첫 점검
          </span>
          <h2 id="dj-intro-title">“생산실적 조회 화면이 열리지 않습니다.”</h2>
          <p>연결 오류의 원인을 찾고, 수정 후 같은 조회를 다시 확인해 해결 기록까지 남겨보세요.</p>
          <span className="dj-footnote">실제 로컬 HTTP·DB 호출 · 샘플 데이터</span>
        </div>
        <div className="dj-intro-action">
          <button type="button" className="button primary" onClick={onStart} disabled={!!busy}>
            {busy ? (
              <LoaderCircle size={16} aria-hidden="true" />
            ) : (
              <ArrowRight size={16} aria-hidden="true" />
            )}
            {busy === 'demo-start' ? '원인 확인 중…' : '연결 오류 점검해보기'}
          </button>
          <p>
            시작하면 공유 샘플 환경의 연결 설정이 바뀝니다.
            <br />
            기존 장애와 가이드 기록은 보존됩니다.
          </p>
        </div>
        {busyText && (
          <p className="dj-busy" role="status">
            {busyText}
          </p>
        )}
      </section>
    );
  }

  const latest = incident.runs.at(-1);
  const failure = incident.runs
    .filter(
      (run) =>
        run.status === 'failed' && run.diagnosis.confidence === 'supported' && run.diagnosis.cause,
    )
    .at(-1);
  const source = failure ?? latest;
  const service = source?.steps.find((step) => step.tool === 'inspect_service');
  const configuredPort = observedPort(service, '연결 설정:');
  const listenerPort = observedPort(service, '실제 리스너:');
  const portMismatch =
    !!failure &&
    !!configuredPort &&
    !!listenerPort &&
    configuredPort !== listenerPort &&
    service?.status === 'pass' &&
    failure.steps.some((step) => step.tool === 'probe_http' && step.status === 'fail');
  const recovered =
    currentScenario === 'healthy' &&
    incident.status === 'verified' &&
    latest?.kind === 'recheck' &&
    latest.status === 'passed' &&
    probes.every(({ tool }) =>
      latest.steps.some((step) => step.tool === tool && step.status === 'pass'),
    ) &&
    !latest.steps.some((step) => step.status === 'fail' || step.status === 'error');
  const stale =
    !recovered &&
    (latest?.status === 'passed' ||
      !!incident.guide ||
      (portMismatch && currentScenario !== 'wrong_port'));
  const canRestore =
    !stale &&
    currentScenario === 'wrong_port' &&
    latest?.status === 'failed' &&
    latest.diagnosis.confidence === 'supported' &&
    portMismatch;
  const canSave = recovered && !!failure;
  const hasGuide = !!incident.guide;
  const primaryAction = hasGuide
    ? onOpenGuide
    : canSave
      ? onSave
      : canRestore
        ? onRestore
        : onStart;
  const primaryText = hasGuide
    ? '저장한 가이드 보기'
    : canSave
      ? '해결 가이드 저장'
      : canRestore
        ? '포트 수정하고 다시 확인'
        : '재시도';
  const PrimaryIcon = hasGuide || canSave ? BookOpen : canRestore ? Wrench : RotateCcw;
  const after = latest?.kind === 'recheck' ? latest : null;
  const diagnosis = portMismatch
    ? '서버는 실행 중입니다. 접속할 포트가 잘못 설정되어 있습니다.'
    : source?.diagnosis.cause || source?.diagnosis.title || '점검 결과를 기다리고 있습니다.';
  const stages = [
    {
      title: '원인 확인',
      detail: failure ? '실패 근거 확인' : latest ? '추가 확인 필요' : '점검 대기',
      complete: !!failure,
      icon: Search,
    },
    {
      title: '복구 검증',
      detail: recovered
        ? '네 가지 점검 통과'
        : stale
          ? '현재 상태 재확인 필요'
          : after
            ? '재검증 결과 확인'
            : '수정 후 다시 점검',
      complete: recovered,
      icon: Wrench,
    },
    {
      title: '해결 기록',
      detail: hasGuide
        ? recovered
          ? '가이드 저장 완료'
          : '이전 가이드 보존'
        : canSave
          ? '저장할 준비 완료'
          : '재검증 후 저장',
      complete: hasGuide && recovered,
      icon: BookOpen,
    },
  ];

  return (
    <section className="dj-journey" aria-labelledby="dj-journey-title" aria-busy={!!busy}>
      <header className="dj-heading">
        <div>
          <span className="dj-kicker">대표 점검 · 생산실적 조회</span>
          <h2 id="dj-journey-title">
            {hasGuide && recovered
              ? '원인부터 해결 기록까지, 확인한 근거가 남았습니다.'
              : '연결 오류를 확인하고, 복구를 검증합니다.'}
          </h2>
          <p>{incident.symptom}</p>
        </div>
        <span className="dj-mode">{mode === 'demo' ? '규칙 점검' : 'LLM API 점검 모드'}</span>
      </header>

      <ol className="dj-stages" aria-label="대표 점검 진행 상황">
        {stages.map((stage, index) => (
          <li key={stage.title} className={stage.complete ? 'dj-stage dj-stage-done' : 'dj-stage'}>
            <span className="dj-stage-number">
              {stage.complete ? <Check size={15} aria-hidden="true" /> : `0${index + 1}`}
            </span>
            <div>
              <strong>{stage.title}</strong>
              <span>{stage.detail}</span>
            </div>
            <stage.icon className="dj-stage-icon" size={20} aria-hidden="true" />
          </li>
        ))}
      </ol>

      {stale && (
        <p className="dj-warning" role="status">
          <AlertTriangle size={17} aria-hidden="true" />
          <span>
            샘플 환경이 바뀌었거나 현재 정상 상태가 확인되지 않았습니다. 아래 결과와 저장한 가이드는
            이전 실행의 기록입니다. 새 시연에서 다시 확인하세요.
          </span>
        </p>
      )}

      <div className="dj-evidence">
        <div className="dj-cause">
          <span className="dj-kicker">
            {failure ? '실패 실행에서 확인한 원인' : '실제 점검 결과'}
          </span>
          <h3>{diagnosis}</h3>
          <p>
            {recovered
              ? '연결 설정을 복구한 뒤 HTTP 연결, DB 조회와 생산실적 기능까지 다시 확인했습니다.'
              : portMismatch
                ? `접속 설정은 포트 ${configuredPort}, 서비스 실행 포트는 ${listenerPort}입니다. 서로 다른 포트를 사용해 생산실적 화면에 연결할 수 없습니다.`
                : latest?.status === 'inconclusive'
                  ? latest.diagnosis.summary
                  : source?.diagnosis.summary ||
                    '실제 도구 호출이 완료되면 관측 결과를 표시합니다.'}
          </p>
          {configuredPort && listenerPort && (
            <dl className="dj-ports">
              <div>
                <dt>수정 전 접속 설정</dt>
                <dd>{configuredPort}</dd>
              </div>
              <ArrowRight size={16} aria-hidden="true" />
              <div>
                <dt>서비스 실행 포트</dt>
                <dd>{listenerPort}</dd>
              </div>
            </dl>
          )}
          {latest?.llmError && (
            <p className="dj-warning-text">LLM API 처리 오류: {latest.llmError}</p>
          )}
        </div>
        <div className="dj-probes" aria-label="실제 점검 결과 비교">
          <div className="dj-probe-head">
            <span>실제 점검</span>
            <span>{failure ? '수정 전' : '점검 결과'}</span>
            <span>재검증</span>
          </div>
          {probes.map(({ tool, label, icon: Icon }) => {
            const beforeStep = source?.steps.find((step) => step.tool === tool);
            const afterStep = after?.steps.find((step) => step.tool === tool);
            return (
              <div className="dj-probe-row" key={tool}>
                <span>
                  <Icon size={16} aria-hidden="true" />
                  {label}
                </span>
                <span className={`dj-result dj-result-${beforeStep?.status || 'pending'}`}>
                  {result(beforeStep)}
                </span>
                <span
                  className={`dj-result dj-result-${stale ? 'history' : afterStep?.status || 'pending'}`}
                >
                  {result(afterStep)}
                  {stale && afterStep ? ' · 이전' : ''}
                </span>
              </div>
            );
          })}
          <p className="dj-probe-note">
            {latest
              ? 'HTTP 응답과 PGlite PostgreSQL의 실제 조회 결과입니다.'
              : '점검 요청이 완료되지 않아 아직 관측 결과가 없습니다.'}
          </p>
        </div>
      </div>

      {!!latest && (
        <details className="dj-details">
          <summary>실행 근거와 관측 시각 보기</summary>
          <div className="dj-evidence-list">
            {probes.map(({ tool, label }) => {
              const step = latest.steps.find((item) => item.tool === tool);
              return (
                <div key={tool}>
                  <strong>
                    {label} · {result(step)}
                  </strong>
                  {step ? (
                    <>
                      <p>{step.summary}</p>
                      <ul>
                        {step.evidence.map((line, index) => (
                          <li key={index}>{line}</li>
                        ))}
                      </ul>
                      <time dateTime={step.observedAt}>{step.observedAt}</time>
                    </>
                  ) : (
                    <p>이 실행에서 호출하지 않았습니다.</p>
                  )}
                </div>
              );
            })}
          </div>
        </details>
      )}

      <footer className="dj-actions">
        <div className="dj-action-copy" role="status">
          <strong>
            {busyText ||
              (hasGuide
                ? recovered
                  ? '실패 원인·수정 내용·재검증 결과를 가이드로 저장했습니다.'
                  : '저장된 가이드를 이전 해결 기록으로 열어볼 수 있습니다.'
                : recovered
                  ? '정상 확인 완료. 해결 과정을 다음 점검에 남기세요.'
                  : canRestore
                    ? '연결 포트를 수정하고 같은 네 가지 점검을 다시 실행합니다.'
                    : '현재 결과로 복구를 확정할 수 없습니다. 새 실행에서 다시 확인하세요.')}
          </strong>
          <span>
            {latest?.mode === 'demo'
              ? '이 실행은 규칙으로 도구를 호출했습니다. LLM 답변을 생성하지 않았습니다.'
              : latest?.mode === 'live'
                ? latest.llmError
                  ? '이 실행은 LLM API 오류를 포함합니다. 실제 도구 근거를 확인하세요.'
                  : '이 실행은 LLM API 모드로 도구를 호출했습니다.'
                : mode === 'demo'
                  ? '규칙으로 실제 점검 도구를 실행합니다.'
                  : 'LLM API 모드로 실제 점검 도구를 실행합니다.'}
          </span>
        </div>
        <div className="dj-action-buttons">
          <button
            type="button"
            className="button primary"
            onClick={primaryAction}
            disabled={!!busy}
          >
            {busy ? (
              <LoaderCircle size={16} aria-hidden="true" />
            ) : (
              <PrimaryIcon size={16} aria-hidden="true" />
            )}
            {busy === 'demo-start'
              ? '원인 확인 중…'
              : busy === 'demo-restore'
                ? '복구 검증 중…'
                : busy === 'demo-save'
                  ? '가이드 저장 중…'
                  : primaryText}
          </button>
          <div className="dj-secondary-actions">
            <button type="button" onClick={onExit} disabled={!!busy}>
              작업대 보기
            </button>
            <button type="button" onClick={onStart} disabled={!!busy}>
              새 시연 시작
            </button>
          </div>
        </div>
      </footer>
    </section>
  );
}
