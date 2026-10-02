export type ScenarioId = 'healthy' | 'service_down' | 'wrong_port' | 'db_auth';
export type IncidentStatus = 'open' | 'investigating' | 'verified' | 'needs_review';
export interface Service {
  id: string;
  name: string;
  description: string;
  environment: string;
  endpoint: string;
  status: 'unknown' | 'healthy' | 'degraded' | 'down';
  lastCheckedAt: string | null;
}
export interface IncidentSummary {
  id: string;
  title: string;
  serviceId: string;
  serviceName: string;
  symptom: string;
  priority: 'medium' | 'high';
  status: IncidentStatus;
  createdAt: string;
  updatedAt: string;
  lastRunId: string | null;
}
export interface Step {
  id: string;
  name: string;
  tool: string;
  transport: 'mcp';
  status: 'pass' | 'fail' | 'info' | 'error';
  summary: string;
  observedAt: string;
  durationMs: number;
  evidence: string[];
  raw: string;
}
export interface Diagnosis {
  title: string;
  summary: string;
  cause: string | null;
  confidence: 'supported' | 'needs_check';
  evidenceIds: string[];
  nextAction: string;
}
export interface Run {
  id: string;
  incidentId: string;
  kind: 'diagnose' | 'recheck';
  startedAt: string;
  completedAt: string;
  status: 'passed' | 'failed' | 'inconclusive';
  mode: 'demo' | 'live';
  steps: Step[];
  diagnosis: Diagnosis;
  usage: { inputTokens: number; outputTokens: number; durationMs: number };
  llmError: string | null;
}
export interface GuideSummary {
  id: string;
  title: string;
  serviceId: string;
  cause: string;
  createdAt: string;
  sourceIncidentId: string;
  sourceRunId: string;
  verificationRunId: string;
}
export interface Guide extends GuideSummary {
  symptom: string;
  conditions: string;
  checks: string[];
  resolution: string;
  verification: string;
}
export interface IncidentDetail extends IncidentSummary {
  runs: Run[];
  guide: Guide | null;
}
export interface Workspace {
  services: Service[];
  incidents: IncidentSummary[];
  guides: GuideSummary[];
  metrics: { open: number; verified: number; checks: number };
  runtime: {
    mode: 'demo' | 'live';
    provider: 'none' | 'openai';
    model: string | null;
    mcp: 'connected' | 'disconnected';
    storage: 'pglite';
    liveConfigured: boolean;
  };
  currentScenario: ScenarioId;
  scenarioDefinitions: { id: ScenarioId; label: string; description: string }[];
}
export interface ApiError {
  error: string;
  code: string;
}
