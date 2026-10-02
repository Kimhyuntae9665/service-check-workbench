import { useCallback, useEffect, useRef, useState } from 'react';
import DemoJourney from './DemoJourney';
import {
  Activity,
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleHelp,
  Clock3,
  Database,
  FileCheck2,
  FlaskConical,
  Layers3,
  LoaderCircle,
  Monitor,
  Play,
  Plus,
  RotateCcw,
  Search,
  Server,
  ShieldCheck,
  SquareCheck,
  X,
  AlertTriangle,
  Terminal,
  Cable,
  SlidersHorizontal,
  ClipboardList,
} from 'lucide-react';
import type {
  Guide,
  IncidentDetail,
  IncidentStatus,
  Run,
  ScenarioId,
  Step,
  Workspace,
} from '../shared/contracts';

const statusLabels: Record<IncidentStatus, string> = {
  open: '접수',
  investigating: '점검 중',
  verified: '정상 확인',
  needs_review: '확인 필요',
};
const toolIcons = {
  inspect_service: Server,
  probe_http: Cable,
  probe_database: Database,
  read_production: FileCheck2,
  search_guides: BookOpen,
};
const shortDate = (s?: string | null) =>
  s
    ? new Intl.DateTimeFormat('ko-KR', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(s))
    : '아직 점검하지 않음';
const incidentLabel = (id: string) => `INC-${id.slice(0, 8).toUpperCase()}`;
const elapsed = (ms: number) => (ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}초`);

async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(
    `/api${path}`,
    body === undefined
      ? { cache: 'no-store' }
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
  );
  const data = await response.json().catch(() => ({ error: '서버 응답을 읽을 수 없습니다.' }));
  if (!response.ok) throw new Error(data.error || '요청을 처리하지 못했습니다.');
  return data as T;
}

function Status({ status }: { status: IncidentStatus }) {
  return (
    <span className={`status status-${status}`}>
      <span />
      {statusLabels[status]}
    </span>
  );
}
function EvidenceStep({ step, index }: { step: Step; index: number }) {
  const Icon = toolIcons[step.tool as keyof typeof toolIcons] || Activity;
  return (
    <div className={`evidence-step evidence-${step.status}`} id={`evidence-${step.id}`}>
      <div className="step-rail">
        <span className="step-circle">
          <Icon size={17} />
        </span>
        <i />
      </div>
      <div className="step-body">
        <div className="step-heading">
          <h4>{step.name}</h4>
          <span className="step-duration">{elapsed(step.durationMs)}</span>
          <span className={`step-result ${step.status}`}>
            {step.status === 'pass'
              ? '통과'
              : step.status === 'fail'
                ? '실패'
                : step.status === 'error'
                  ? '점검 오류'
                  : '참고'}
          </span>
        </div>
        <p>{step.summary}</p>
        {step.evidence.length > 0 && (
          <ul className="evidence-lines">
            {step.evidence.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        )}
        <details className="raw-detail">
          <summary>
            <Terminal size={12} />
            실행 근거 보기
            <ChevronDown size={12} />
          </summary>
          <div className="raw-meta">
            <span>MCP · {step.tool}</span>
            <time>{shortDate(step.observedAt)}</time>
          </div>
          <pre>{step.raw || '추가 출력 없음'}</pre>
        </details>
      </div>
    </div>
  );
}

export default function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<IncidentDetail | null>(null);
  const [page, setPage] = useState<'desk' | 'guides' | 'help'>('desk');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | 'verified'>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [scenario, setScenario] = useState<ScenarioId>('healthy');
  const [showLab, setShowLab] = useState(false);
  const [guide, setGuide] = useState<Guide | null>(null);
  const [activeRun, setActiveRun] = useState<string | null>(null);
  const [resolution, setResolution] = useState('');
  const [demoId, setDemoId] = useState<string | null>(null);
  const selectionRef = useRef(selected);
  selectionRef.current = selected;

  const acceptWorkspace = useCallback((data: Workspace) => {
    setWorkspace(data);
    setScenario(data.currentScenario);
    setDetail((current) => {
      const summary = data.incidents.find((item) => item.id === current?.id);
      return current && summary ? { ...current, ...summary } : current;
    });
  }, []);

  const refresh = useCallback(
    async (selectId?: string) => {
      const data = await api<Workspace>('/workspace');
      acceptWorkspace(data);
      const id = selectId || selectionRef.current || data.incidents[0]?.id || null;
      setSelected(id);
      if (id) {
        const next = await api<IncidentDetail>(`/incidents/${encodeURIComponent(id)}`);
        if (selectionRef.current === id || selectId || !selectionRef.current) setDetail(next);
      }
    },
    [acceptWorkspace],
  );

  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
  }, [refresh]);
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setDetail(null);
    setActiveRun(null);
    setResolution('');
    api<IncidentDetail>(`/incidents/${encodeURIComponent(selected)}`)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  useEffect(() => {
    if (!showCreate && !guide) return;
    const previous = document.activeElement as HTMLElement | null;
    const modal = document.querySelector<HTMLElement>('[role="dialog"]');
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    modal?.querySelector<HTMLElement>('input, button')?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) {
        setShowCreate(false);
        setGuide(null);
      }
      if (event.key !== 'Tab' || !modal) return;
      const items = [
        ...modal.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input, select, textarea, a[href]',
        ),
      ];
      const first = items[0],
        last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKey);
      previous?.focus();
    };
  }, [showCreate, guide?.id]);

  async function action(name: string, task: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = name;
    setBusy(name);
    setError(null);
    try {
      await task();
    } catch (e) {
      setError(e instanceof Error ? e.message : '요청을 처리하지 못했습니다.');
    } finally {
      busyRef.current = null;
      setBusy(null);
    }
  }
  async function startDemo() {
    await action('demo-start', async () => {
      setPage('desk');
      setShowLab(false);
      setGuide(null);
      setShowCreate(false);
      const created = await api<IncidentDetail>('/incidents', {
        title: '생산실적 화면에 연결할 수 없습니다',
        symptom:
          'A라인 생산실적 화면을 열면 연결 오류가 발생합니다. 서버는 실행 중이지만 업무 데이터를 볼 수 없습니다.',
        serviceId: 'production-api',
        priority: 'high',
      });
      setDemoId(created.id);
      setSelected(created.id);
      setDetail(created);
      setActiveRun(null);
      try {
        acceptWorkspace(await api<Workspace>('/lab/scenario', { scenario: 'wrong_port' }));
        const run = await api<Run>(`/incidents/${created.id}/runs`, { kind: 'diagnose' });
        setActiveRun(run.id);
      } finally {
        await refresh(created.id);
      }
    });
  }
  async function restoreDemo() {
    if (!demoId) return;
    await action('demo-restore', async () => {
      // Hide current success conservatively even if the mutation response is lost.
      setDetail((current) => current && { ...current, status: 'needs_review' });
      try {
        acceptWorkspace(await api<Workspace>('/lab/scenario', { scenario: 'healthy' }));
        const run = await api<Run>(`/incidents/${demoId}/runs`, { kind: 'recheck' });
        setActiveRun(run.id);
      } finally {
        await refresh(demoId);
      }
    });
  }
  async function saveDemo() {
    if (!demoId) return;
    await action('demo-save', async () => {
      const saved = await api<Guide>(`/incidents/${demoId}/guides`, {
        resolution:
          '샘플 서비스의 연결 포트를 실행 중인 리스너와 일치하도록 수정했습니다. HTTP 접속·SQL 조회·생산실적 조회를 다시 실행해 복구를 확인했습니다.',
      });
      await refresh(demoId);
      setGuide(saved);
    });
  }
  async function runCheck() {
    if (!detail) return;
    const id = detail.id;
    const kind = detail.runs.some(
      (r) =>
        r.kind === 'diagnose' && r.status === 'failed' && r.diagnosis.confidence === 'supported',
    )
      ? 'recheck'
      : 'diagnose';
    await action('run', async () => {
      const run = await api<Run>(`/incidents/${id}/runs`, { kind });
      await refresh(id);
      setActiveRun(run.id);
      setToast(
        run.status === 'passed'
          ? '기동·접속·업무 기능을 확인했습니다.'
          : run.status === 'failed'
            ? '문제가 확인됐습니다. 아래 점검 근거를 확인하세요.'
            : '추가 확인이 필요합니다. 결과에 남은 항목을 확인하세요.',
      );
    });
  }
  async function saveGuide() {
    if (!detail) return;
    await action('guide', async () => {
      if (resolution.trim() && resolution.trim().length < 5)
        throw new Error('해결 내용은 5자 이상 적어주세요.');
      const saved = await api<Guide>(
        `/incidents/${detail.id}/guides`,
        resolution.trim() ? { resolution: resolution.trim() } : {},
      );
      await refresh(detail.id);
      setGuide(saved);
      setToast('재현 조건과 정상 확인 결과를 가이드에 저장했습니다.');
    });
  }
  async function applyScenario() {
    await action('scenario', async () => {
      await api<Workspace>('/lab/scenario', { scenario });
      await refresh();
      setToast('샘플 환경을 변경했습니다. 점검을 실행해 현재 상태를 확인하세요.');
    });
  }
  async function switchMode() {
    if (!workspace) return;
    await action('mode', async () => {
      await api<Workspace>('/runtime', {
        mode: workspace.runtime.mode === 'demo' ? 'live' : 'demo',
      });
      await refresh();
      setToast('점검 방식을 변경했습니다.');
    });
  }
  async function createIncident(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await action('create', async () => {
      const created = await api<IncidentDetail>('/incidents', {
        title: form.get('title'),
        symptom: form.get('symptom'),
        serviceId: form.get('serviceId'),
        priority: form.get('priority'),
      });
      setShowCreate(false);
      setPage('desk');
      await refresh(created.id);
      setToast('장애를 접수했습니다. 점검을 시작할 수 있습니다.');
    });
  }
  const latest = detail?.runs.at(-1);
  const visibleRun = detail?.runs.find((r) => r.id === activeRun) || latest;
  const latestFailure = detail?.runs
    .filter(
      (r) => r.status === 'failed' && r.diagnosis.confidence === 'supported' && r.diagnosis.cause,
    )
    .at(-1);
  const incidents =
    workspace?.incidents.filter(
      (i) =>
        `${i.title} ${i.symptom} ${i.serviceName}`.toLowerCase().includes(search.toLowerCase()) &&
        (filter === 'all' ||
          (filter === 'verified' ? i.status === 'verified' : i.status !== 'verified')),
    ) || [];
  const service = workspace?.services[0];
  const canSave =
    detail?.status === 'verified' &&
    latest?.kind === 'recheck' &&
    latest.status === 'passed' &&
    !detail.guide;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            if (busyRef.current) return;
            setPage('desk');
          }}
        >
          <span className="brand-mark">
            <SquareCheck size={23} />
          </span>
          <span>
            서비스 점검<small>서버·접속·DB 상태 확인</small>
          </span>
        </a>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="주 메뉴">
          <button
            className={page === 'desk' ? 'active' : ''}
            onClick={() => setPage('desk')}
            disabled={!!busy}
          >
            <Layers3 size={18} />
            작업대<span className="nav-count">{workspace?.metrics.open ?? '–'}</span>
          </button>
          <button
            className={page === 'guides' ? 'active' : ''}
            onClick={() => setPage('guides')}
            disabled={!!busy}
          >
            <BookOpen size={18} />
            점검 가이드
          </button>
          <button
            className={page === 'help' ? 'active' : ''}
            onClick={() => setPage('help')}
            disabled={!!busy}
          >
            <CircleHelp size={18} />
            사용 안내
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="lab-card">
            <button
              className="lab-toggle"
              aria-expanded={showLab}
              onClick={() => setShowLab((v) => !v)}
            >
              <span>
                <FlaskConical size={16} />
                샘플 환경
              </span>
              <ChevronDown size={15} className={showLab ? 'rotated' : ''} />
            </button>
            <p>서비스 오류를 직접 재현해볼 수 있습니다.</p>
            {showLab && (
              <div className="lab-settings">
                <label htmlFor="scenario">재현할 상태</label>
                <select
                  id="scenario"
                  value={scenario}
                  onChange={(e) => setScenario(e.target.value as ScenarioId)}
                  disabled={!!busy}
                >
                  {(workspace?.scenarioDefinitions || []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <p>{workspace?.scenarioDefinitions.find((s) => s.id === scenario)?.description}</p>
                <button
                  className="button secondary full"
                  onClick={() => void applyScenario()}
                  disabled={!!busy}
                >
                  {busy === 'scenario' ? (
                    <LoaderCircle size={14} className="spin" />
                  ) : (
                    <SlidersHorizontal size={14} />
                  )}
                  환경 적용
                </button>
              </div>
            )}
            <div className="lab-state">
              <span className="dot" />
              {workspace?.scenarioDefinitions.find((s) => s.id === workspace.currentScenario)
                ?.label || '연결 확인 중'}
            </div>
          </div>
          <div className="runtime-label">
            <span className={workspace?.runtime.mcp === 'connected' ? 'dot green' : 'dot'} />
            {workspace?.runtime.mcp === 'connected' ? '점검 도구 연결됨' : '점검 도구 연결 확인 중'}
          </div>
          <span className="sidebar-version">개인 프로젝트 · 샘플 서비스</span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            서비스 점검
            <ChevronRight size={13} />
            <strong>
              {page === 'desk' ? '작업대' : page === 'guides' ? '점검 가이드' : '사용 안내'}
            </strong>
          </div>
          <div className="topbar-right">
            <button
              className="mobile-lab-button"
              aria-expanded={showLab}
              onClick={() => setShowLab((v) => !v)}
            >
              <FlaskConical size={15} />
              샘플 환경
            </button>
            <span className="mode-pill">
              <span className="dot purple" />
              {workspace?.runtime.mode === 'live' ? 'LLM API 점검' : '규칙 점검'}
            </span>
            <span className="local-label">샘플 서비스</span>
            <span className="avatar">HT</span>
          </div>
        </header>
        <main>
          {showLab && (
            <section className="mobile-lab-panel" aria-label="샘플 환경 설정">
              <div>
                <FlaskConical size={18} />
                <strong>서비스 오류를 직접 재현해보세요.</strong>
                <button
                  className="icon-button"
                  aria-label="샘플 환경 닫기"
                  onClick={() => setShowLab(false)}
                >
                  <X size={17} />
                </button>
              </div>
              <label htmlFor="mobile-scenario">재현할 상태</label>
              <select
                id="mobile-scenario"
                value={scenario}
                onChange={(e) => setScenario(e.target.value as ScenarioId)}
                disabled={!!busy}
              >
                {(workspace?.scenarioDefinitions || []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
              <p>{workspace?.scenarioDefinitions.find((s) => s.id === scenario)?.description}</p>
              <button
                className="button secondary"
                onClick={() => void applyScenario()}
                disabled={!!busy}
              >
                {busy === 'scenario' ? (
                  <LoaderCircle size={14} className="spin" />
                ) : (
                  <SlidersHorizontal size={14} />
                )}
                환경 적용
              </button>
            </section>
          )}
          <div className={`page-heading ${page === 'desk' ? 'desk-heading' : ''}`}>
            <div>
              <span className="eyebrow">
                {page === 'desk'
                  ? '생산 시스템 장애 확인'
                  : page === 'guides'
                    ? 'VERIFIED KNOWLEDGE'
                    : 'GETTING STARTED'}
              </span>
              <h1>
                {page === 'desk'
                  ? '생산실적 조회 오류, 원인부터 복구까지 확인합니다.'
                  : page === 'guides'
                    ? '해결 과정을 다음 점검의 기준으로.'
                    : '처음부터 정상 확인까지.'}
              </h1>
              <p>
                {page === 'desk'
                  ? 'IT 담당자가 서버 실행·접속·DB 조회를 점검하고, 해결 근거를 남기는 도구입니다.'
                  : page === 'guides'
                    ? '재현 조건과 재검증 결과가 남아 있는 가이드를 찾아보세요.'
                    : '샘플 환경을 바꾸고, 실제 점검 결과를 확인해보세요.'}
              </p>
            </div>
            {page === 'desk' && !demoId && (
              <button
                className="button secondary"
                onClick={() => setShowCreate(true)}
                disabled={!!busy}
              >
                <Plus size={17} />
                장애 접수
              </button>
            )}
          </div>
          {error && (
            <div className="error-banner" role="alert">
              <AlertTriangle size={17} />
              <span>{error}</span>
              <button aria-label="오류 메시지 닫기" onClick={() => setError(null)}>
                <X size={15} />
              </button>
            </div>
          )}
          {!workspace ? (
            <div className="initial-state">
              <LoaderCircle className="spin" size={24} />
              <h2>{error ? '서비스에 연결하지 못했습니다.' : '작업대를 불러오고 있습니다.'}</h2>
              <p>
                {error
                  ? '서버가 실행 중인지 확인한 뒤 다시 시도하세요.'
                  : '서비스와 접수된 장애를 확인합니다.'}
              </p>
              {error && (
                <button className="button secondary" onClick={() => void action('load', refresh)}>
                  다시 연결
                </button>
              )}
            </div>
          ) : (
            <>
              {page === 'desk' && (
                <>
                  <DemoJourney
                    incident={demoId && detail?.id === demoId ? detail : null}
                    busy={busy}
                    currentScenario={workspace.currentScenario}
                    mode={workspace.runtime.mode}
                    onStart={() => void startDemo()}
                    onRestore={() => void restoreDemo()}
                    onSave={() => void saveDemo()}
                    onOpenGuide={() => detail?.guide && setGuide(detail.guide)}
                    onExit={() => setDemoId(null)}
                  />
                  {!demoId && (
                    <>
                      <section className="overview" aria-label="서비스 및 점검 현황">
                        <div className="service-summary">
                          <span className="service-icon">
                            <Server size={22} />
                          </span>
                          <div className="service-summary-main">
                            <div className="service-title">
                              <h2>{service?.name || '서비스'}</h2>
                              <span className="environment-tag">테스트 환경</span>
                            </div>
                            <p>{service?.description}</p>
                            <span className="service-time">
                              <Clock3 size={12} />
                              {shortDate(service?.lastCheckedAt)}
                            </span>
                          </div>
                          <div className={`service-state state-${service?.status}`}>
                            <span className="dot" />
                            {service?.status === 'healthy'
                              ? '정상'
                              : service?.status === 'down'
                                ? '응답 없음'
                                : service?.status === 'degraded'
                                  ? '확인 필요'
                                  : '미점검'}
                          </div>
                        </div>
                        <div className="overview-stat">
                          <span>확인할 장애</span>
                          <strong>
                            {workspace.metrics.open}
                            <small>건</small>
                          </strong>
                        </div>
                        <div className="overview-stat">
                          <span>정상 확인</span>
                          <strong>
                            {workspace.metrics.verified}
                            <small>건</small>
                          </strong>
                        </div>
                        <div className="overview-stat">
                          <span>점검 실행</span>
                          <strong>
                            {workspace.metrics.checks}
                            <small>회</small>
                          </strong>
                        </div>
                      </section>
                      <div className="workbench">
                        <section className="incident-list">
                          <div className="section-heading">
                            <h2>
                              접수된 장애 <span>{workspace.incidents.length}</span>
                            </h2>
                            <ClipboardList size={17} />
                          </div>
                          <div className="search-field">
                            <Search size={15} />
                            <input
                              aria-label="장애 검색"
                              placeholder="제목 또는 증상 검색"
                              value={search}
                              onChange={(e) => setSearch(e.target.value)}
                            />
                          </div>
                          <div className="filter-tabs" aria-label="장애 필터">
                            {(
                              [
                                ['all', '전체'],
                                ['active', '확인 필요'],
                                ['verified', '정상 확인'],
                              ] as const
                            ).map(([id, label]) => (
                              <button
                                key={id}
                                className={filter === id ? 'selected' : ''}
                                onClick={() => setFilter(id)}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                          <div className="ticket-list">
                            {incidents.length === 0 ? (
                              <div className="list-empty">
                                <Search size={21} />
                                <p>조건에 맞는 장애가 없습니다.</p>
                              </div>
                            ) : (
                              incidents.map((i) => (
                                <button
                                  key={i.id}
                                  className={`ticket ${selected === i.id ? 'selected' : ''}`}
                                  onClick={() => setSelected(i.id)}
                                  disabled={busy === 'run'}
                                >
                                  <div className="ticket-top">
                                    <span className="ticket-id">{incidentLabel(i.id)}</span>
                                    <Status status={i.status} />
                                  </div>
                                  <h3>{i.title}</h3>
                                  <p>{i.symptom}</p>
                                  <div className="ticket-meta">
                                    <span>{i.serviceName}</span>
                                    <time>{shortDate(i.createdAt)}</time>
                                  </div>
                                </button>
                              ))
                            )}
                          </div>
                          <div className="list-foot">
                            <ShieldCheck size={14} />
                            <span>정상 확인은 재검증 결과를 기준으로 합니다.</span>
                          </div>
                        </section>
                        <section className="incident-detail" aria-label="장애 상세">
                          {!detail ? (
                            <div className="detail-empty">
                              <LoaderCircle size={24} className={selected ? 'spin' : ''} />
                              <h2>
                                {selected ? '장애 내용을 불러오는 중' : '접수된 장애를 선택하세요.'}
                              </h2>
                            </div>
                          ) : (
                            <>
                              <div className="detail-head">
                                <div className="detail-meta">
                                  <span className="ticket-id">{incidentLabel(detail.id)}</span>
                                  <span className="meta-dot">·</span>
                                  <span>{detail.serviceName}</span>
                                  <Status status={detail.status} />
                                </div>
                                <h2>{detail.title}</h2>
                                <p>{detail.symptom}</p>
                                <div className="detail-actions">
                                  <button
                                    className="button primary"
                                    onClick={() => void runCheck()}
                                    disabled={!!busy}
                                  >
                                    {busy === 'run' ? (
                                      <LoaderCircle size={16} className="spin" />
                                    ) : detail.runs.length ? (
                                      <RotateCcw size={16} />
                                    ) : (
                                      <Play size={16} />
                                    )}{' '}
                                    {busy === 'run'
                                      ? '서비스를 점검하고 있습니다'
                                      : detail.runs.length
                                        ? '다시 확인'
                                        : '점검 시작'}
                                  </button>
                                  <span>
                                    {detail.runs.length
                                      ? '설정 변경 후 같은 항목을 재검증합니다.'
                                      : '기동·접속·업무 기능을 차례로 확인합니다.'}
                                  </span>
                                </div>
                              </div>
                              {busy === 'run' && (
                                <div className="progress-note" role="status">
                                  <span className="pulse-line" />
                                  <div>
                                    <strong>점검 도구에서 근거를 수집하고 있습니다.</strong>
                                    <p>결과가 도착하면 원인 후보와 확인 순서를 보여드립니다.</p>
                                  </div>
                                </div>
                              )}
                              {!visibleRun ? (
                                <div className="check-intro">
                                  <div className="intro-graphic">
                                    <Monitor size={24} />
                                    <span />
                                    <Server size={24} />
                                    <span />
                                    <Database size={24} />
                                  </div>
                                  <h3>어느 단계에서 멈췄는지 확인합니다.</h3>
                                  <p>
                                    서버가 켜져 있는지, 접속이 되는지,
                                    <br />
                                    실제 업무 데이터까지 읽을 수 있는지 나누어 점검합니다.
                                  </p>
                                  <div className="check-preview">
                                    <span>
                                      <Check size={13} />
                                      서비스 기동
                                    </span>
                                    <span>
                                      <Check size={13} />
                                      HTTP 접속
                                    </span>
                                    <span>
                                      <Check size={13} />
                                      DB·업무 기능
                                    </span>
                                  </div>
                                  <button
                                    className="button secondary intro-lab"
                                    onClick={() => setShowLab(true)}
                                  >
                                    <FlaskConical size={15} />
                                    샘플 오류 재현하기
                                  </button>
                                </div>
                              ) : (
                                <>
                                  {latest?.status === 'passed' &&
                                    detail.status === 'needs_review' && (
                                      <div className="inline-notice">
                                        <AlertTriangle size={14} />
                                        <p>
                                          환경이 바뀌어 이전 정상 확인이 만료됐습니다. 아래 결과는
                                          과거 기록이며, 현재 상태는 다시 점검해야 합니다.
                                        </p>
                                      </div>
                                    )}
                                  <div className="run-tabs" aria-label="점검 이력">
                                    {detail.runs.map((r, i) => (
                                      <button
                                        key={r.id}
                                        className={visibleRun.id === r.id ? 'selected' : ''}
                                        onClick={() => setActiveRun(r.id)}
                                      >
                                        <span
                                          className={`dot ${r.status === 'passed' ? 'green' : r.status === 'failed' ? 'orange' : ''}`}
                                        />
                                        {r.kind === 'diagnose'
                                          ? `원인 점검 ${i + 1}`
                                          : `재검증 ${i + 1}`}
                                        <small>{shortDate(r.completedAt)}</small>
                                      </button>
                                    ))}
                                  </div>
                                  <div className={`diagnosis diagnosis-${visibleRun.status}`}>
                                    <div className="diagnosis-symbol">
                                      {visibleRun.status === 'passed' ? (
                                        <CircleCheck size={24} />
                                      ) : visibleRun.status === 'failed' ? (
                                        <AlertTriangle size={24} />
                                      ) : (
                                        <CircleHelp size={24} />
                                      )}
                                    </div>
                                    <div>
                                      <span className="diagnosis-label">
                                        {visibleRun.status === 'passed'
                                          ? '점검 항목 통과'
                                          : visibleRun.status === 'failed'
                                            ? '확인된 문제'
                                            : '추가 확인 필요'}
                                      </span>
                                      <h3>{visibleRun.diagnosis.title}</h3>
                                      <p>{visibleRun.diagnosis.summary}</p>
                                      <div className="evidence-links">
                                        {visibleRun.diagnosis.evidenceIds.map((id, i) => (
                                          <a key={id} href={`#evidence-${id}`}>
                                            근거 {i + 1}
                                            <ArrowUpRight size={11} />
                                          </a>
                                        ))}
                                      </div>
                                    </div>
                                  </div>
                                  {visibleRun.llmError && (
                                    <div className="inline-notice">
                                      <AlertTriangle size={14} />
                                      <p>{visibleRun.llmError}</p>
                                    </div>
                                  )}
                                  <div className="next-action">
                                    <span className="next-icon">
                                      <ArrowRight size={17} />
                                    </span>
                                    <div>
                                      <strong>다음으로 할 일</strong>
                                      <p>{visibleRun.diagnosis.nextAction}</p>
                                    </div>
                                  </div>
                                  <div className="evidence-header">
                                    <h3>
                                      점검 근거 <span>{visibleRun.steps.length}</span>
                                    </h3>
                                    <span>
                                      {visibleRun.mode === 'live'
                                        ? 'LLM API + 도구 점검'
                                        : '규칙 + 도구 점검'}{' '}
                                      · {elapsed(visibleRun.usage.durationMs)}
                                      {visibleRun.mode === 'live' && (
                                        <small className="token-usage">
                                          {visibleRun.llmError
                                            ? '사용량 미확인'
                                            : `입력 ${visibleRun.usage.inputTokens.toLocaleString()} · 출력 ${visibleRun.usage.outputTokens.toLocaleString()} 토큰`}
                                        </small>
                                      )}
                                    </span>
                                  </div>
                                  <div className="evidence-timeline">
                                    {visibleRun.steps.map((s, i) => (
                                      <EvidenceStep key={s.id} step={s} index={i} />
                                    ))}
                                  </div>
                                  {latestFailure &&
                                    latest?.status === 'passed' &&
                                    latestFailure.id !== latest.id && (
                                      <div className="comparison">
                                        <div>
                                          <span>수정 전</span>
                                          <strong>
                                            <AlertTriangle size={15} />
                                            {
                                              latestFailure.steps.filter(
                                                (s) => s.status === 'fail' || s.status === 'error',
                                              ).length
                                            }
                                            개 항목 실패
                                          </strong>
                                        </div>
                                        <ArrowRight size={18} />
                                        <div>
                                          <span>다시 확인한 결과</span>
                                          <strong className="positive">
                                            <CheckCheck size={17} />
                                            필수 점검 통과
                                          </strong>
                                        </div>
                                      </div>
                                    )}
                                  <div className="guide-save">
                                    <span className="guide-save-icon">
                                      <BookOpen size={22} />
                                    </span>
                                    <div>
                                      <h3>
                                        {detail.guide
                                          ? '가이드가 저장되어 있습니다.'
                                          : '이 해결 과정을 다음 점검에 활용하세요.'}
                                      </h3>
                                      <p>
                                        {detail.guide
                                          ? '재현 조건과 확인 근거를 다시 찾아볼 수 있습니다.'
                                          : canSave
                                            ? '실패 원인과 정상화 근거를 함께 저장할 수 있습니다.'
                                            : '실패 원인을 확인하고 재검증을 통과하면 저장할 수 있습니다.'}
                                      </p>
                                      {canSave && (
                                        <label className="resolution-field">
                                          해결 내용 <span>선택</span>
                                          <textarea
                                            value={resolution}
                                            onChange={(e) => setResolution(e.target.value)}
                                            maxLength={2000}
                                            rows={3}
                                            placeholder="예: 잘못된 연결 포트를 실제 리스너 포트로 수정했습니다."
                                            disabled={!!busy}
                                          />
                                        </label>
                                      )}
                                    </div>
                                    <button
                                      className="button secondary"
                                      disabled={!!busy || (!detail.guide && !canSave)}
                                      onClick={() =>
                                        detail.guide ? setGuide(detail.guide) : void saveGuide()
                                      }
                                    >
                                      {busy === 'guide' ? (
                                        <LoaderCircle size={15} className="spin" />
                                      ) : (
                                        <FileCheck2 size={15} />
                                      )}{' '}
                                      {detail.guide ? '가이드 보기' : '가이드 저장'}
                                    </button>
                                  </div>
                                </>
                              )}
                            </>
                          )}
                        </section>
                      </div>
                    </>
                  )}
                </>
              )}
              {page === 'guides' && (
                <section className="guides-page">
                  {workspace.guides.length === 0 ? (
                    <div className="empty-guide">
                      <span className="empty-icon">
                        <BookOpen size={32} />
                      </span>
                      <h2>아직 저장된 가이드가 없습니다.</h2>
                      <p>
                        장애의 원인을 확인하고 재검증을 통과하면,
                        <br />그 과정을 다음 점검에 쓸 가이드로 저장할 수 있습니다.
                      </p>
                      <button className="button primary" onClick={() => setPage('desk')}>
                        작업대로 이동
                        <ArrowRight size={16} />
                      </button>
                    </div>
                  ) : (
                    <div className="guide-grid">
                      {workspace.guides.map((g) => (
                        <button
                          className="guide-card"
                          key={g.id}
                          onClick={() =>
                            void action('read-guide', async () =>
                              setGuide(await api<Guide>(`/guides/${g.id}`)),
                            )
                          }
                        >
                          <div>
                            <BookOpen size={20} />
                            <span>
                              <CircleCheck size={13} />
                              재검증 완료
                            </span>
                          </div>
                          <h2>{g.title}</h2>
                          <p>{g.cause}</p>
                          <footer>
                            <time>{shortDate(g.createdAt)}</time>
                            <ArrowUpRight size={18} />
                          </footer>
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              )}
              {page === 'help' && (
                <div className="help-page">
                  <section className="help-card">
                    <span className="eyebrow">THREE STEPS</span>
                    <h2>한 번의 장애를, 다시 쓸 수 있는 지식으로.</h2>
                    <div className="help-steps">
                      {[
                        {
                          n: '01',
                          title: '오류를 재현합니다.',
                          text: '샘플 환경에서 서비스 중지, 포트 오류, DB 연결 권한 오류 중 하나를 적용하세요.',
                          icon: FlaskConical,
                        },
                        {
                          n: '02',
                          title: '실제 근거로 확인합니다.',
                          text: '장애를 선택하고 점검을 시작하세요. 기동·HTTP·DB·업무 기능의 결과를 나누어 보여드립니다.',
                          icon: Search,
                        },
                        {
                          n: '03',
                          title: '정상화까지 남깁니다.',
                          text: '샘플 환경을 정상으로 바꾼 뒤 다시 확인하세요. 재검증을 통과하면 가이드를 저장할 수 있습니다.',
                          icon: FileCheck2,
                        },
                      ].map((s) => (
                        <div key={s.n}>
                          <span className="help-number">{s.n}</span>
                          <s.icon size={24} />
                          <h3>{s.title}</h3>
                          <p>{s.text}</p>
                        </div>
                      ))}
                    </div>
                    <button
                      className="button primary"
                      onClick={() => {
                        setPage('desk');
                        setShowLab(true);
                      }}
                    >
                      직접 점검해보기
                      <ArrowRight size={16} />
                    </button>
                  </section>
                  <div className="help-bottom">
                    <section className="help-card">
                      <h3>지금 사용하는 점검 방식</h3>
                      <div className="mode-info">
                        <span className="mode-pill">
                          {workspace.runtime.mode === 'live' ? 'LLM API 점검' : '규칙 점검'}
                        </span>
                        <p>
                          {workspace.runtime.mode === 'live'
                            ? 'LLM이 점검 도구를 선택하고, 실행 결과를 바탕으로 원인 후보를 정리합니다.'
                            : '정해진 순서로 실제 점검 도구를 실행합니다. 현재는 LLM 답변을 생성하지 않습니다.'}
                        </p>
                      </div>
                      <button
                        className="button secondary"
                        onClick={() => void switchMode()}
                        disabled={
                          !!busy ||
                          (!workspace.runtime.liveConfigured && workspace.runtime.mode !== 'live')
                        }
                      >
                        {workspace.runtime.mode === 'live'
                          ? '규칙 점검으로 전환'
                          : 'LLM API 점검으로 전환'}
                      </button>
                      {!workspace.runtime.liveConfigured && (
                        <p className="config-hint">
                          LLM API는 아직 연결하지 않았습니다. 연결 방법은 프로젝트 README에서 확인할
                          수 있습니다.
                        </p>
                      )}
                    </section>
                    <section className="help-card">
                      <h3>무엇을 확인하나요?</h3>
                      <ul className="help-checks">
                        <li>
                          <Check size={15} />
                          테스트용 서비스의 실제 응답과 SQL 조회 결과
                        </li>
                        <li>
                          <Check size={15} />
                          점검을 실행한 시간과 도구의 출력
                        </li>
                        <li>
                          <Check size={15} />
                          수정 후 같은 조건에서 다시 확인한 결과
                        </li>
                      </ul>
                      <p className="config-hint">
                        개인 프로젝트용 샘플 서비스입니다. 실제 고객사 시스템과 연결되어 있지
                        않습니다.
                      </p>
                    </section>
                  </div>
                </div>
              )}
              <footer className="main-footer">
                <span>서비스 점검</span>기억에 의존하지 않고, 확인한 근거를 남깁니다.
                <span className="footer-right">실행 결과 기준 · 샘플 환경</span>
              </footer>
            </>
          )}
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <CircleCheck size={17} />
          {toast}
          <button aria-label="알림 닫기" onClick={() => setToast(null)}>
            <X size={14} />
          </button>
        </div>
      )}
      {showCreate && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !busy) setShowCreate(false);
          }}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-heading"
          >
            <div className="modal-heading">
              <div>
                <span className="eyebrow">NEW INCIDENT</span>
                <h2 id="create-heading">어떤 문제가 생겼나요?</h2>
              </div>
              <button
                className="icon-button"
                aria-label="접수 창 닫기"
                onClick={() => setShowCreate(false)}
                disabled={!!busy}
              >
                <X size={20} />
              </button>
            </div>
            <form onSubmit={(e) => void createIncident(e)}>
              <label>
                대상 서비스
                <select name="serviceId" required>
                  {workspace?.services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                장애 제목
                <input
                  name="title"
                  placeholder="예: 생산실적 조회 화면이 열리지 않습니다"
                  maxLength={120}
                  minLength={2}
                  required
                  autoFocus
                />
              </label>
              <label>
                증상과 확인한 내용
                <textarea
                  name="symptom"
                  placeholder="언제, 어떤 화면에서 문제가 발생했는지 적어주세요."
                  maxLength={2000}
                  minLength={5}
                  rows={4}
                  required
                />
              </label>
              <label>
                우선순위
                <select name="priority" defaultValue="medium">
                  <option value="medium">보통 — 확인이 필요한 오류</option>
                  <option value="high">높음 — 업무 이용이 어려운 오류</option>
                </select>
              </label>
              <div className="modal-actions">
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setShowCreate(false)}
                  disabled={!!busy}
                >
                  취소
                </button>
                <button className="button primary" type="submit" disabled={!!busy}>
                  {busy === 'create' ? (
                    <LoaderCircle size={16} className="spin" />
                  ) : (
                    <Plus size={16} />
                  )}
                  장애 접수
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {guide && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setGuide(null);
          }}
        >
          <section
            className="modal guide-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="guide-heading"
          >
            <div className="modal-heading">
              <div>
                <span className="eyebrow">VERIFIED GUIDE</span>
                <h2 id="guide-heading">{guide.title}</h2>
              </div>
              <button
                className="icon-button"
                aria-label="가이드 닫기"
                onClick={() => setGuide(null)}
              >
                <X size={20} />
              </button>
            </div>
            <span className="status status-verified">
              <span />
              재검증 완료
            </span>
            <dl>
              <dt>발생 증상</dt>
              <dd>{guide.symptom}</dd>
              <dt>재현 조건</dt>
              <dd>{guide.conditions}</dd>
              <dt>확인한 원인</dt>
              <dd>{guide.cause}</dd>
              <dt>점검 순서</dt>
              <dd>
                <ol>
                  {guide.checks.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ol>
              </dd>
              <dt>해결 내용</dt>
              <dd>{guide.resolution}</dd>
              <dt>정상화 근거</dt>
              <dd>{guide.verification}</dd>
            </dl>
            <div className="guide-source">
              원본 장애 {incidentLabel(guide.sourceIncidentId)} · {shortDate(guide.createdAt)}
            </div>
            <button className="button secondary full" onClick={() => setGuide(null)}>
              닫기
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
