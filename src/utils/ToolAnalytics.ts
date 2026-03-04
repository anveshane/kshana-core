/**
 * ToolAnalytics - Records tool call analytics to a local SQLite database.
 *
 * Singleton pattern with lazy initialization and graceful degradation.
 * If the DB fails to initialize, all operations silently no-op.
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

const DB_DIR = 'logs';
const DB_FILE = 'tool-analytics.db';
const SCHEMA_VERSION = 1;

interface ActiveCall {
  startTime: number; // performance.now()
}

export class ToolAnalytics {
  private db: Database.Database;
  private insertStmt: Database.Statement;
  private updateStmt: Database.Statement;
  private activeCalls: Map<string, ActiveCall> = new Map();

  private static _instance: ToolAnalytics | null | undefined = undefined;

  private constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');

    this.initSchema();

    this.insertStmt = this.db.prepare(`
      INSERT INTO tool_calls (session_id, tool_name, agent_name, args_summary, preceding_message, started_at, project_dir)
      VALUES (@sessionId, @toolName, @agentName, @argsSummary, @precedingMessage, @startedAt, @projectDir)
    `);

    this.updateStmt = this.db.prepare(`
      UPDATE tool_calls
      SET is_error = @isError,
          duration_ms = @durationMs,
          error_message = @errorMessage,
          completed_at = @completedAt
      WHERE id = @id
    `);
  }

  private initSchema(): void {
    const currentVersion = this.db.pragma('user_version', { simple: true }) as number;

    if (currentVersion < SCHEMA_VERSION) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS tool_calls (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id      TEXT NOT NULL,
          tool_name       TEXT NOT NULL,
          agent_name      TEXT NOT NULL,
          is_error        INTEGER NOT NULL DEFAULT 0,
          duration_ms     INTEGER,
          args_summary    TEXT,
          preceding_message TEXT,
          error_message   TEXT,
          started_at      TEXT NOT NULL,
          completed_at    TEXT,
          project_dir     TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_tool_name ON tool_calls(tool_name);
        CREATE INDEX IF NOT EXISTS idx_session_id ON tool_calls(session_id);
        CREATE INDEX IF NOT EXISTS idx_started_at ON tool_calls(started_at);
      `);

      this.db.pragma(`user_version = ${SCHEMA_VERSION}`);
    }
  }

  /**
   * Get the singleton instance. Returns null if DB initialization fails.
   */
  static instance(): ToolAnalytics | null {
    if (ToolAnalytics._instance === undefined) {
      try {
        const dbDir = path.resolve(DB_DIR);
        if (!fs.existsSync(dbDir)) {
          fs.mkdirSync(dbDir, { recursive: true });
        }
        const dbPath = path.join(dbDir, DB_FILE);
        ToolAnalytics._instance = new ToolAnalytics(dbPath);
      } catch {
        ToolAnalytics._instance = null;
      }
    }
    return ToolAnalytics._instance;
  }

  /**
   * Record the start of a tool call.
   * Returns the row ID for later completion, or null on failure.
   */
  recordStart(
    toolCallId: string,
    toolName: string,
    agentName: string,
    args: Record<string, unknown>,
    sessionId: string,
    precedingMessage?: string,
    projectDir?: string
  ): number | null {
    try {
      const argsSummary = truncateJson(args, 2000);
      const truncatedMessage = precedingMessage
        ? precedingMessage.slice(0, 2000)
        : null;

      const result = this.insertStmt.run({
        sessionId,
        toolName,
        agentName,
        argsSummary,
        precedingMessage: truncatedMessage,
        startedAt: new Date().toISOString(),
        projectDir: projectDir ?? null,
      });

      const rowId = Number(result.lastInsertRowid);
      this.activeCalls.set(toolCallId, {
        startTime: performance.now(),
      });

      return rowId;
    } catch {
      return null;
    }
  }

  /**
   * Record the completion of a tool call.
   */
  recordComplete(
    toolCallId: string,
    rowId: number,
    isError: boolean,
    errorMessage?: string
  ): void {
    try {
      const active = this.activeCalls.get(toolCallId);
      const durationMs = active
        ? Math.round(performance.now() - active.startTime)
        : null;

      this.updateStmt.run({
        id: rowId,
        isError: isError ? 1 : 0,
        durationMs,
        errorMessage: errorMessage ? errorMessage.slice(0, 1000) : null,
        completedAt: new Date().toISOString(),
      });

      this.activeCalls.delete(toolCallId);
    } catch {
      // Silent fail — analytics should never break tool execution
    }
  }

  /**
   * Get the underlying database for direct queries (used by dashboard).
   */
  getDb(): Database.Database {
    return this.db;
  }

  /**
   * Close the database connection.
   */
  close(): void {
    try {
      this.db.close();
    } catch {
      // ignore
    }
  }
}

/**
 * Truncate a single value if it exceeds the char limit.
 */
function truncateValue(val: unknown, maxChars: number): unknown {
  if (typeof val === 'string') {
    return val.length > maxChars ? val.slice(0, maxChars) + '...' : val;
  }
  if (Array.isArray(val)) {
    const serialized = JSON.stringify(val);
    if (serialized.length <= maxChars) return val;
    // Keep first few items and indicate total count
    const kept = val.slice(0, 3).map(item => truncateValue(item, maxChars));
    return val.length > 3 ? [...kept, `...(${val.length} items total)`] : kept;
  }
  if (val !== null && typeof val === 'object') {
    const serialized = JSON.stringify(val);
    if (serialized.length <= maxChars) return val;
    const obj = val as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      result[key] = truncateValue(obj[key], maxChars);
    }
    return result;
  }
  return val;
}

/**
 * Truncate individual values in a JSON object while preserving all keys.
 * Only long string/array/object values get truncated; short values are kept intact.
 */
function truncateJson(obj: Record<string, unknown>, maxLen: number): string {
  try {
    const full = JSON.stringify(obj);
    if (full.length <= maxLen) return full;

    const result: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      result[key] = truncateValue(obj[key], 200);
    }
    const serialized = JSON.stringify(result);
    return serialized.length > maxLen ? serialized.slice(0, maxLen) + '...' : serialized;
  } catch {
    return '{}';
  }
}
