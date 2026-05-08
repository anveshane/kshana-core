/**
 * High-level session-persistence helpers for embedding hosts.
 *
 * These wrap the lower-level sessionStore + historyReplay pieces so a
 * host (e.g. kshana-desktop's Electron main process) doesn't have to
 * stitch them together. The HTTP/WebSocket path inside this package
 * uses the same primitives directly via WebSocketHandler — these
 * helpers exist purely as a stable surface for in-process consumers.
 */

import { findSession, purgeSessionHistory } from '../agent/pi/sessionStore.js';
import { buildHistoryFromFile } from './historyReplay.js';
import type { HistoryData } from './types.js';

/**
 * Look up a sessionId in the on-disk session index and return a
 * HistoryData snapshot built from its persisted JSONL transcript.
 *
 * Returns `null` when:
 *   - the sessionId is unknown to the index, OR
 *   - the JSONL file referenced by the index has been removed.
 *
 * Returns an empty-but-valid HistoryData (`{ messages: [], toolCalls: [],
 * compactionCount: 0 }`) when the file exists but holds no entries the
 * UI cares about — callers should treat that as "no history to show".
 */
export function getSessionHistorySnapshot(sessionId: string): HistoryData | null {
  const record = findSession(sessionId);
  if (!record) return null;
  return buildHistoryFromFile(record.sessionFile);
}

/**
 * Hard-delete the persisted chat for a session: removes the JSONL
 * transcript and forgets the index entry. Caller is responsible for
 * also tearing down any in-memory ConversationManager state for the
 * same id (`ConversationManager.deleteSession`).
 *
 * Idempotent — a no-op if the session is unknown.
 */
export function clearSessionHistory(sessionId: string): void {
  purgeSessionHistory(sessionId);
}
