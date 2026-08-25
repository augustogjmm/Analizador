export const snapshotTableSql = `CREATE TABLE IF NOT EXISTS market_snapshots (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  spot_price REAL NOT NULL,
  direction TEXT NOT NULL,
  probability REAL NOT NULL,
  target REAL NOT NULL,
  invalidation REAL NOT NULL,
  payload TEXT NOT NULL
)`;

export const planTableSql = `CREATE TABLE IF NOT EXISTS simulated_plans (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  closed_at TEXT,
  result_pct REAL,
  result_usdt REAL,
  payload TEXT NOT NULL
)`;

export const eventTableSql = `CREATE TABLE IF NOT EXISTS plan_events (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  payload TEXT NOT NULL
)`;

export const outcomeTableSql = `CREATE TABLE IF NOT EXISTS forecast_outcomes (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL UNIQUE,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  forecast_at TEXT NOT NULL,
  resolved_at TEXT NOT NULL,
  outcome TEXT NOT NULL,
  direction TEXT NOT NULL,
  probability REAL NOT NULL,
  regime TEXT NOT NULL,
  entry_price REAL NOT NULL,
  target REAL NOT NULL,
  invalidation REAL NOT NULL,
  mfe_pct REAL NOT NULL,
  mae_pct REAL NOT NULL,
  time_to_minutes REAL NOT NULL,
  payload TEXT NOT NULL
)`;

export const indexStatements = [
  'CREATE INDEX IF NOT EXISTS idx_snapshots_symbol_time ON market_snapshots(symbol, timeframe, captured_at)',
  'CREATE INDEX IF NOT EXISTS idx_plans_status_created ON simulated_plans(status, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_events_plan_created ON plan_events(plan_id, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_outcomes_symbol_time ON forecast_outcomes(symbol, timeframe, forecast_at)',
  'CREATE INDEX IF NOT EXISTS idx_outcomes_regime_time ON forecast_outcomes(regime, forecast_at)',
];
