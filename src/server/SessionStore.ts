/**
 * SessionStore - Persists session metadata to SQLite so sessions survive server restarts.
 *
 * Only stores lightweight metadata (session ID, project config, status).
 * Agent instances are ephemeral and reconstructed on resume from project.json state.
 *
 * Uses the same better-sqlite3 pattern as ToolAnalytics.
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

const DB_DIR = 'logs';
const DB_FILE = 'sessions.db';
const SCHEMA_VERSION = 1;

/** Serializable session record persisted to SQLite. */
export interface PersistedSession {
  id: string;
  projectDir: string;
  templateId: string;
  style: string;
  duration: number;
  resolution?: string;
  autonomousMode: boolean;
  createdAt: number;
  lastActivity: number;
  status: string;
  taskHistory: string; // JSON array
  providerConfig?: string; // JSON object
}

export class SessionStore {
  private db: Database.Database;
  private upsertStmt: Database.Statement;
  private getStmt: Database.Statement;
  private getAllActiveStmt: Database.Statement;
  private deleteStmt: Database.Statement;
  private touchStmt: Database.Statement;

  private static _instance: SessionStore | null | undefined = undefined;

  private constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');

    this.initSchema();

    this.upsertStmt = this.db.prepare(`
      INSERT INTO sessions (id, project_dir, template_id, style, duration, resolution,
                            autonomous_mode, created_at, last_activity, status, task_history, provider_config)
      VALUES (@id, @projectDir, @templateId, @style, @duration, @resolution,
              @autonomousMode, @createdAt, @lastActivity, @status, @taskHistory, @providerConfig)
      ON CONFLICT(id) DO UPDATE SET
        last_activity = @lastActivity,
        status = @status,
        task_history = @taskHistory,
        autonomous_mode = @autonomousMode
    `);

    this.getStmt = this.db.prepare('SELECT * FROM sessions WHERE id = ?');

    // Sessions active within the last 4 hours are recoverable
    this.getAllActiveStmt = this.db.prepare(`
      SELECT * FROM sessions
      WHERE last_activity > ?
        AND status NOT IN ('completed', 'deleted')
    `);

    this.deleteStmt = this.db.prepare('DELETE FROM sessions WHERE id = ?');

    this.touchStmt = this.db.prepare(`
      UPDATE sessions SET last_activity = ?, status = ? WHERE id = ?
    `);
  }

  private initSchema(): void {
    const currentVersion = this.db.pragma('user_version', { simple: true }) as number;

    if (currentVersion < SCHEMA_VERSION) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          id              TEXT PRIMARY KEY,
          project_dir     TEXT NOT NULL,
          template_id     TEXT NOT NULL,
          style           TEXT NOT NULL DEFAULT 'anime',
          duration        INTEGER NOT NULL DEFAULT 60,
          resolution      TEXT,
          autonomous_mode INTEGER NOT NULL DEFAULT 0,
          created_at      INTEGER NOT NULL,
          last_activity   INTEGER NOT NULL,
          status          TEXT NOT NULL DEFAULT 'idle',
          task_history    TEXT NOT NULL DEFAULT '[]',
          provider_config TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_sessions_last_activity ON sessions(last_activity);
      `);

      this.db.pragma(`user_version = ${SCHEMA_VERSION}`);
    }
  }

  /** Save or update a session record. */
  save(session: PersistedSession): void {
    try {
      this.upsertStmt.run({
        id: session.id,
        projectDir: session.projectDir,
        templateId: session.templateId,
        style: session.style,
        duration: session.duration,
        resolution: session.resolution ?? null,
        autonomousMode: session.autonomousMode ? 1 : 0,
        createdAt: session.createdAt,
        lastActivity: session.lastActivity,
        status: session.status,
        taskHistory: session.taskHistory,
        providerConfig: session.providerConfig ?? null,
      });
    } catch {
      // Graceful degradation — don't crash the server
    }
  }

  /** Get a single session by ID. */
  get(sessionId: string): PersistedSession | undefined {
    try {
      const row = this.getStmt.get(sessionId) as Record<string, unknown> | undefined;
      return row ? this.rowToSession(row) : undefined;
    } catch {
      return undefined;
    }
  }

  /** Get all sessions active within the recovery window (default 4 hours). */
  getRecoverable(windowMs: number = 4 * 60 * 60 * 1000): PersistedSession[] {
    try {
      const cutoff = Date.now() - windowMs;
      const rows = this.getAllActiveStmt.all(cutoff) as Record<string, unknown>[];
      return rows.map(r => this.rowToSession(r));
    } catch {
      return [];
    }
  }

  /** Update last_activity and status for a session. */
  touch(sessionId: string, status: string): void {
    try {
      this.touchStmt.run(Date.now(), status, sessionId);
    } catch {
      // Graceful degradation
    }
  }

  /** Delete a session record. */
  delete(sessionId: string): void {
    try {
      this.deleteStmt.run(sessionId);
    } catch {
      // Graceful degradation
    }
  }

  private rowToSession(row: Record<string, unknown>): PersistedSession {
    return {
      id: row['id'] as string,
      projectDir: row['project_dir'] as string,
      templateId: row['template_id'] as string,
      style: row['style'] as string,
      duration: row['duration'] as number,
      resolution: row['resolution'] as string | undefined,
      autonomousMode: !!(row['autonomous_mode'] as number),
      createdAt: row['created_at'] as number,
      lastActivity: row['last_activity'] as number,
      status: row['status'] as string,
      taskHistory: row['task_history'] as string,
      providerConfig: row['provider_config'] as string | undefined,
    };
  }

  /** Singleton accessor. Returns null if DB cannot be initialized. */
  static getInstance(): SessionStore | null {
    if (this._instance === undefined) {
      try {
        const dbDir = path.join(process.cwd(), DB_DIR);
        if (!fs.existsSync(dbDir)) {
          fs.mkdirSync(dbDir, { recursive: true });
        }
        this._instance = new SessionStore(path.join(dbDir, DB_FILE));
      } catch {
        this._instance = null;
      }
    }
    return this._instance;
  }
}
