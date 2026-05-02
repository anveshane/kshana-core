import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { PostHog } from 'posthog-node';

const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';
const MAX_ERROR_MESSAGE_LENGTH = 500;
const DEVICE_ID_DIR = '.kshana';
const DEVICE_ID_FILE = 'device-id';

let posthogClient: PostHog | null | undefined;
let shutdownHandlersRegistered = false;
let cachedDeviceId: string | undefined;
const posthogSessionIds = new Map<string, string>();

interface CommonProperties {
  app_version: string;
  platform: 'desktop' | 'server';
  os: 'macos' | 'linux' | 'win32' | 'unknown';
}

let commonProperties: CommonProperties = {
  app_version: '0.0.0',
  platform: 'server',
  os: normalizeOs(os.platform()),
};

export interface ToolCallStartedPayload {
  sessionId: string;
  toolCallId: string;
  toolName: string;
  agentName: string;
  args: Record<string, unknown>;
  startedAt?: string;
  projectDir?: string;
  workflowName?: string;
}

export interface ToolCallCompletedPayload {
  sessionId: string;
  toolCallId: string;
  toolName: string;
  agentName: string;
  isError: boolean;
  durationMs?: number | null;
  errorMessage?: string;
  startedAt?: string;
  completedAt?: string;
  projectDir?: string;
  sqliteRowId?: number;
  source?: 'live' | 'backfill';
  workflowName?: string;
}

export interface WorkflowEventPayload {
  sessionId: string;
  workflowName: string;
  durationMs?: number;
  templateId?: string;
}

export interface WorkflowFailedPayload extends WorkflowEventPayload {
  errorType: string;
}

export interface ErrorOccurredPayload {
  sessionId: string;
  errorType: string;
  toolName?: string;
  workflowName?: string;
  messageHash?: string;
}

interface ArgSummary {
  argCount: number;
  argKeys: string[];
  argsJsonLength: number;
}

function normalizeOs(value: string): CommonProperties['os'] {
  if (value === 'darwin') return 'macos';
  if (value === 'linux') return 'linux';
  if (value === 'win32') return 'win32';
  return 'unknown';
}

function getPostHogApiKey(): string | undefined {
  const key = process.env['POSTHOG_API_KEY']?.trim();
  return key && key.length > 0 ? key : undefined;
}

function getPostHogHost(): string {
  const host = process.env['POSTHOG_HOST']?.trim();
  return host && host.length > 0 ? host : DEFAULT_POSTHOG_HOST;
}

function getPostHogClient(): PostHog | null {
  if (posthogClient !== undefined) {
    return posthogClient;
  }

  const apiKey = getPostHogApiKey();
  if (!apiKey) {
    posthogClient = null;
    return posthogClient;
  }

  posthogClient = new PostHog(apiKey, {
    host: getPostHogHost(),
  });
  return posthogClient;
}

function getOrCreateDeviceId(): string {
  if (cachedDeviceId) {
    return cachedDeviceId;
  }

  try {
    const deviceDir = path.join(os.homedir(), DEVICE_ID_DIR);
    const deviceFilePath = path.join(deviceDir, DEVICE_ID_FILE);

    if (fs.existsSync(deviceFilePath)) {
      const existing = fs.readFileSync(deviceFilePath, 'utf8').trim();
      if (existing) {
        cachedDeviceId = existing;
        return cachedDeviceId;
      }
    }

    if (!fs.existsSync(deviceDir)) {
      fs.mkdirSync(deviceDir, { recursive: true });
    }

    const newId = randomUUID();
    fs.writeFileSync(deviceFilePath, `${newId}\n`, { encoding: 'utf8' });
    cachedDeviceId = newId;
    return cachedDeviceId;
  } catch {
    cachedDeviceId = `ephemeral_${randomUUID()}`;
    return cachedDeviceId;
  }
}

function summarizeArgs(args: Record<string, unknown>): ArgSummary {
  const argKeys = Object.keys(args).slice(0, 20);
  let argsJsonLength = 0;
  try {
    argsJsonLength = JSON.stringify(args).length;
  } catch {
    argsJsonLength = 0;
  }

  return {
    argCount: Object.keys(args).length,
    argKeys,
    argsJsonLength,
  };
}

function hashProjectDir(projectDir?: string): string | undefined {
  if (!projectDir) {
    return undefined;
  }

  const salt = process.env['ANALYTICS_SALT']?.trim() ?? '';
  return createHash('sha256').update(`${salt}:${projectDir}`).digest('hex').slice(0, 16);
}

function sanitizeErrorMessage(message?: string): string | undefined {
  if (!message) {
    return undefined;
  }
  const normalized = message.trim().replace(/\s+/g, ' ');
  if (!normalized) {
    return undefined;
  }
  return normalized.slice(0, MAX_ERROR_MESSAGE_LENGTH);
}

function toDate(input?: string): Date | undefined {
  if (!input) {
    return undefined;
  }
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function bytesToUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function createUuidV7(nowMs: number): string {
  const bytes = new Uint8Array(16);
  const timestamp = BigInt(nowMs);
  const random = randomBytes(10);
  const r0 = random[0] ?? 0;
  const r1 = random[1] ?? 0;
  const r2 = random[2] ?? 0;
  const r3 = random[3] ?? 0;
  const r4 = random[4] ?? 0;
  const r5 = random[5] ?? 0;
  const r6 = random[6] ?? 0;
  const r7 = random[7] ?? 0;
  const r8 = random[8] ?? 0;
  const r9 = random[9] ?? 0;

  // 48-bit Unix timestamp in milliseconds (big-endian)
  bytes[0] = Number((timestamp >> 40n) & 0xffn);
  bytes[1] = Number((timestamp >> 32n) & 0xffn);
  bytes[2] = Number((timestamp >> 24n) & 0xffn);
  bytes[3] = Number((timestamp >> 16n) & 0xffn);
  bytes[4] = Number((timestamp >> 8n) & 0xffn);
  bytes[5] = Number(timestamp & 0xffn);

  // Version 7 + random bits
  bytes[6] = 0x70 | (r0 & 0x0f);
  bytes[7] = r1;

  // RFC 4122 variant (10xx) + random bits
  bytes[8] = 0x80 | (r2 & 0x3f);
  bytes[9] = r3;
  bytes[10] = r4;
  bytes[11] = r5;
  bytes[12] = r6;
  bytes[13] = r7;
  bytes[14] = r8;
  bytes[15] = r9;

  return bytesToUuid(bytes);
}

function getOrCreatePostHogSessionId(sessionId: string): string {
  const existing = posthogSessionIds.get(sessionId);
  if (existing) {
    return existing;
  }

  const created = createUuidV7(Date.now());
  posthogSessionIds.set(sessionId, created);
  return created;
}

function captureEvent(
  event: string,
  properties: Record<string, unknown>,
  timestamp?: string
): void {
  const client = getPostHogClient();
  if (!client) {
    return;
  }

  const rawSessionId = properties['session_id'];
  const posthogSessionId = typeof rawSessionId === 'string' && rawSessionId.length > 0
    ? getOrCreatePostHogSessionId(rawSessionId)
    : undefined;

  try {
    client.capture({
      distinctId: getOrCreateDeviceId(),
      event,
      timestamp: toDate(timestamp),
      properties: {
        ...commonProperties,
        app_component: 'kshana-core',
        ...(posthogSessionId ? { '$session_id': posthogSessionId } : {}),
        ...properties,
      },
    });
  } catch {
    // Analytics must never affect runtime behavior.
  }
}

export function setCommonProperties(
  platform: CommonProperties['platform'],
  appVersion: string
): void {
  commonProperties = {
    app_version: appVersion,
    platform,
    os: normalizeOs(os.platform()),
  };
}

export function isPostHogEnabled(): boolean {
  return !!getPostHogApiKey();
}

export function hashAnalyticsMessage(message?: string): string | undefined {
  const sanitized = sanitizeErrorMessage(message);
  if (!sanitized) {
    return undefined;
  }
  return createHash('sha256').update(sanitized).digest('hex').slice(0, 8);
}

export function captureAppStarted(platform: CommonProperties['platform']): void {
  captureEvent('app_started', {
    platform,
  });
}

export function captureSessionStarted(sessionId: string, startedAt?: string): void {
  const startIso = startedAt ?? new Date().toISOString();
  captureEvent('session_started', {
    session_id: sessionId,
    // Extra hints for session-oriented analysis on server-side events.
    '$start_timestamp': startIso,
    session_started_at: startIso,
  }, startIso);
}

export function captureSessionEnded(
  sessionId: string,
  durationMs?: number,
  startedAt?: string,
  interactionCount?: number
): void {
  const endIso = new Date().toISOString();
  const sessionDurationSeconds = typeof durationMs === 'number'
    ? Math.max(0, Math.round(durationMs / 1000))
    : undefined;
  const bounce = typeof interactionCount === 'number' ? interactionCount <= 1 : undefined;

  captureEvent('session_ended', {
    session_id: sessionId,
    duration_ms: durationMs,
    '$end_timestamp': endIso,
    '$session_duration': sessionDurationSeconds,
    '$is_bounce': bounce,
    session_started_at: startedAt,
    session_ended_at: endIso,
    session_interaction_count: interactionCount,
  }, endIso);
}

export function captureWorkflowStarted(payload: WorkflowEventPayload): void {
  captureEvent('workflow_started', {
    session_id: payload.sessionId,
    workflow_name: payload.workflowName,
    template_id: payload.templateId,
  });
}

export function captureWorkflowCompleted(payload: WorkflowEventPayload): void {
  captureEvent('workflow_completed', {
    session_id: payload.sessionId,
    workflow_name: payload.workflowName,
    duration_ms: payload.durationMs,
    success: true,
  });
}

export function captureWorkflowFailed(payload: WorkflowFailedPayload): void {
  captureEvent('workflow_failed', {
    session_id: payload.sessionId,
    workflow_name: payload.workflowName,
    error_type: payload.errorType,
    duration_ms: payload.durationMs,
    success: false,
  });
}

export function captureErrorOccurred(payload: ErrorOccurredPayload): void {
  captureEvent('error_occurred', {
    session_id: payload.sessionId,
    error_type: payload.errorType,
    tool_name: payload.toolName,
    workflow_name: payload.workflowName,
    message_hash: payload.messageHash,
  });
}

export function captureToolCallStarted(payload: ToolCallStartedPayload): void {
  const argSummary = summarizeArgs(payload.args);

  captureEvent(
    'tool_call_started',
    {
      session_id: payload.sessionId,
      tool_call_id: payload.toolCallId,
      tool_name: payload.toolName,
      agent_name: payload.agentName,
      workflow_name: payload.workflowName,
      project_dir_hash: hashProjectDir(payload.projectDir),
      source: 'live',
      ...argSummary,
    },
    payload.startedAt
  );
}

export function captureToolCallCompleted(payload: ToolCallCompletedPayload): void {
  captureEvent(
    'tool_call_completed',
    {
      session_id: payload.sessionId,
      tool_call_id: payload.toolCallId,
      tool_name: payload.toolName,
      agent_name: payload.agentName,
      workflow_name: payload.workflowName,
      is_error: payload.isError,
      success: !payload.isError,
      duration_ms: payload.durationMs ?? null,
      latency_ms: payload.durationMs ?? null,
      error_message: sanitizeErrorMessage(payload.errorMessage),
      started_at: payload.startedAt,
      completed_at: payload.completedAt,
      sqlite_row_id: payload.sqliteRowId,
      project_dir_hash: hashProjectDir(payload.projectDir),
      source: payload.source ?? 'live',
    },
    payload.completedAt ?? payload.startedAt
  );
}

export async function shutdownPostHog(): Promise<void> {
  if (!posthogClient) {
    return;
  }

  try {
    await posthogClient.shutdown();
  } catch {
    // Analytics must never break shutdown flow.
  }
}

export function registerPostHogShutdownHandlers(): void {
  if (shutdownHandlersRegistered) {
    return;
  }
  shutdownHandlersRegistered = true;

  process.once('beforeExit', () => {
    void shutdownPostHog();
  });

  const handleSignal = (signal: NodeJS.Signals) => {
    process.once(signal, () => {
      void shutdownPostHog().finally(() => process.exit(0));
    });
  };

  handleSignal('SIGINT');
  handleSignal('SIGTERM');
}
