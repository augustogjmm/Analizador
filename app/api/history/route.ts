import { NextRequest, NextResponse } from 'next/server';
import { ensureDatabase, getDatabase } from '../../../lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const db = getDatabase();
  if (!db) return NextResponse.json({ available: false, snapshots: 0, plans: [], message: 'D1 no está enlazada en este entorno.' });
  await ensureDatabase(db);
  const symbol = request.nextUrl.searchParams.get('symbol');
  const countQuery = symbol ? db.prepare('SELECT COUNT(*) AS count, MIN(captured_at) AS first_at, MAX(captured_at) AS last_at FROM market_snapshots WHERE symbol = ?').bind(symbol) : db.prepare('SELECT COUNT(*) AS count, MIN(captured_at) AS first_at, MAX(captured_at) AS last_at FROM market_snapshots');
  const [stats, plans] = await Promise.all([
    countQuery.first<{ count: number; first_at: string | null; last_at: string | null }>(),
    db.prepare('SELECT payload FROM simulated_plans ORDER BY created_at DESC LIMIT 200').all<{ payload: string }>(),
  ]);
  return NextResponse.json({ available: true, snapshots: Number(stats?.count || 0), firstAt: stats?.first_at || null, lastAt: stats?.last_at || null, plans: plans.results.map((row) => JSON.parse(row.payload)) });
}

export async function POST(request: NextRequest) {
  const db = getDatabase();
  if (!db) return NextResponse.json({ available: false, stored: false, message: 'D1 no está enlazada en este entorno.' });
  await ensureDatabase(db);
  const body = await request.json() as { type: 'snapshot' | 'plan' | 'event'; data: Record<string, unknown> };
  if (!body?.data || !['snapshot', 'plan', 'event'].includes(body.type)) return NextResponse.json({ error: 'Registro inválido.' }, { status: 400 });
  if (body.type === 'snapshot') {
    const item = body.data;
    await db.prepare('INSERT OR IGNORE INTO market_snapshots (id, symbol, timeframe, captured_at, spot_price, direction, probability, target, invalidation, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(item.id, item.symbol, item.timeframe, item.timestamp, item.spotPrice, item.direction, item.probability, item.target, item.invalidation, JSON.stringify(item)).run();
  } else if (body.type === 'plan') {
    const item = body.data;
    await db.prepare('INSERT INTO simulated_plans (id, symbol, timeframe, status, created_at, closed_at, result_pct, result_usdt, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status=excluded.status, closed_at=excluded.closed_at, result_pct=excluded.result_pct, result_usdt=excluded.result_usdt, payload=excluded.payload').bind(item.id, item.symbol, item.timeframe, item.status, item.createdAt, item.closedAt || null, item.resultPct ?? null, item.resultUSDT ?? null, JSON.stringify(item)).run();
  } else {
    const item = body.data;
    await db.prepare('INSERT OR IGNORE INTO plan_events (id, plan_id, event_type, created_at, payload) VALUES (?, ?, ?, ?, ?)').bind(item.id, item.planId, item.eventType, item.timestamp, JSON.stringify(item)).run();
  }
  return NextResponse.json({ available: true, stored: true });
}
