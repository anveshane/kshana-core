#!/usr/bin/env tsx
import 'dotenv/config';
import * as path from 'path';
import Database from 'better-sqlite3';
import {
  captureToolCallCompleted,
  isPostHogEnabled,
  shutdownPostHog,
} from '../src/server/posthog.js';

interface BackfillOptions {
  dbPath: string;
  dryRun: boolean;
  batchSize: number;
  fromId?: number;
  toId?: number;
}

interface ToolCallRow {
  id: number;
  session_id: string;
  tool_name: string;
  agent_name: string;
  is_error: number;
  duration_ms: number | null;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
  project_dir: string | null;
}

function parseArgs(): BackfillOptions {
  const args = process.argv.slice(2);
  const options: BackfillOptions = {
    dbPath: path.resolve('logs', 'tool-analytics.db'),
    dryRun: false,
    batchSize: 500,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    if (!arg) continue;

    switch (arg) {
      case '--db':
        if (next) {
          options.dbPath = path.resolve(next);
          i++;
        }
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--batch-size':
        if (next) {
          const parsed = Number.parseInt(next, 10);
          if (Number.isFinite(parsed) && parsed > 0) {
            options.batchSize = parsed;
          }
          i++;
        }
        break;
      case '--from-id':
        if (next) {
          const parsed = Number.parseInt(next, 10);
          if (Number.isFinite(parsed)) {
            options.fromId = parsed;
          }
          i++;
        }
        break;
      case '--to-id':
        if (next) {
          const parsed = Number.parseInt(next, 10);
          if (Number.isFinite(parsed)) {
            options.toId = parsed;
          }
          i++;
        }
        break;
      case '-h':
      case '--help':
        console.log(`SQLite -> PostHog Backfill

Usage:
  tsx scripts/backfill-posthog-from-sqlite.ts [options]

Options:
  --db <path>           SQLite database path (default: logs/tool-analytics.db)
  --dry-run             Print what would be sent without sending
  --batch-size <n>      Batch size (default: 500)
  --from-id <id>        Start from row id (inclusive)
  --to-id <id>          End at row id (inclusive)
  -h, --help            Show this help
`);
        process.exit(0);
        break;
    }
  }

  return options;
}

function buildWhereClause(opts: BackfillOptions): {
  whereSql: string;
  params: Record<string, number>;
} {
  const parts: string[] = [];
  const params: Record<string, number> = {};

  if (opts.fromId !== undefined) {
    parts.push('id >= @fromId');
    params['fromId'] = opts.fromId;
  }
  if (opts.toId !== undefined) {
    parts.push('id <= @toId');
    params['toId'] = opts.toId;
  }

  return {
    whereSql: parts.length > 0 ? `WHERE ${parts.join(' AND ')}` : '',
    params,
  };
}

async function main(): Promise<void> {
  const options = parseArgs();

  if (!options.dryRun && !isPostHogEnabled()) {
    console.error(
      'POSTHOG_API_KEY is not set. Set it in env or run with --dry-run.',
    );
    process.exit(1);
  }

  const db = new Database(options.dbPath, { readonly: true });
  try {
    const { whereSql, params } = buildWhereClause(options);
    const totalRow = db
      .prepare(`SELECT COUNT(*) as count FROM tool_calls ${whereSql}`)
      .get(params) as { count: number };
    const total = totalRow?.count ?? 0;

    console.log(`DB: ${options.dbPath}`);
    console.log(`Mode: ${options.dryRun ? 'dry-run' : 'live'}`);
    console.log(`Rows selected: ${total}`);
    console.log(`Batch size: ${options.batchSize}`);

    let processed = 0;
    let lastSeenId = 0;
    let previewPrinted = 0;

    while (processed < total) {
      const rows = db
        .prepare(
          `SELECT id, session_id, tool_name, agent_name, is_error, duration_ms, error_message, started_at, completed_at, project_dir
           FROM tool_calls
           ${whereSql ? `${whereSql} AND id > @cursor` : 'WHERE id > @cursor'}
           ORDER BY id ASC
           LIMIT @limit`,
        )
        .all({
          ...params,
          cursor: lastSeenId,
          limit: options.batchSize,
        }) as ToolCallRow[];

      if (rows.length === 0) {
        break;
      }

      for (const row of rows) {
        const payload = {
          sessionId: row.session_id,
          toolCallId: `sqlite-${row.id}`,
          toolName: row.tool_name,
          agentName: row.agent_name,
          isError: row.is_error === 1,
          durationMs: row.duration_ms,
          errorMessage: row.error_message ?? undefined,
          startedAt: row.started_at,
          completedAt: row.completed_at ?? row.started_at,
          projectDir: row.project_dir ?? undefined,
          sqliteRowId: row.id,
          source: 'backfill' as const,
        };

        if (options.dryRun) {
          if (previewPrinted < 3) {
            console.log(`[dry-run sample] ${JSON.stringify(payload)}`);
            previewPrinted += 1;
          }
        } else {
          captureToolCallCompleted(payload);
        }

        processed += 1;
        lastSeenId = row.id;
      }

      console.log(`Processed ${processed}/${total} rows`);
    }
  } finally {
    db.close();
    await shutdownPostHog();
  }
}

main().catch((error) => {
  console.error('Backfill failed:', error);
  process.exit(1);
});
