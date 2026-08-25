import { env } from 'cloudflare:workers';
import { eventTableSql, indexStatements, outcomeTableSql, planTableSql, snapshotTableSql } from '../db/schema';

type D1Like = D1Database;
let initialized = false;

export function getDatabase(): D1Like | null {
  return (env as unknown as { DB?: D1Like }).DB || null;
}

export async function ensureDatabase(db: D1Like) {
  if (initialized) return;
  await db.batch([
    db.prepare(snapshotTableSql),
    db.prepare(planTableSql),
    db.prepare(eventTableSql),
    db.prepare(outcomeTableSql),
    ...indexStatements.map((statement) => db.prepare(statement)),
    db.prepare('PRAGMA optimize'),
  ]);
  initialized = true;
}
