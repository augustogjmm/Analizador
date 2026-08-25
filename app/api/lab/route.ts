import { NextRequest, NextResponse } from 'next/server';
import { ensureDatabase, getDatabase } from '../../../lib/db';

export const dynamic = 'force-dynamic';

type SnapshotRow = { id: string; symbol: string; timeframe: string; captured_at: string; spot_price: number; direction: string; probability: number; target: number; invalidation: number; payload: string };
type OutcomeRow = { id: string; outcome: 'TP' | 'INVALIDACION' | 'VENCIDO' | 'NO_ACTIVADO'; probability: number; regime: string; mfe_pct: number; mae_pct: number; time_to_minutes: number; forecast_at: string; payload: string };

const validityHours: Record<string, number> = { '15m': 6, '1h': 24, '4h': 168, '1d': 672 };
const clampProbability = (value: number) => Math.min(0.999, Math.max(0.001, value / 100));
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

function summarize(rows: OutcomeRow[]) {
  const evaluated = rows.length;
  const notActivated = rows.filter((row) => row.outcome === 'NO_ACTIVADO').length;
  const activeRows = rows.filter((row) => row.outcome !== 'NO_ACTIVADO');
  const resolved = activeRows.length;
  const wins = activeRows.filter((row) => row.outcome === 'TP').length;
  const invalidations = activeRows.filter((row) => row.outcome === 'INVALIDACION').length;
  const expired = activeRows.filter((row) => row.outcome === 'VENCIDO').length;
  const probabilities = activeRows.map((row) => clampProbability(row.probability));
  const labels = activeRows.map((row) => row.outcome === 'TP' ? 1 : 0);
  const brierScore = mean(probabilities.map((probability, index) => (probability - labels[index]) ** 2));
  const logLoss = mean(probabilities.map((probability, index) => -(labels[index] * Math.log(probability) + (1 - labels[index]) * Math.log(1 - probability))));
  const bins = [50, 60, 70, 80].map((minimum) => {
    const selected = activeRows.filter((row) => row.probability >= minimum && row.probability < minimum + 10);
    const observedPct = selected.length ? selected.filter((row) => row.outcome === 'TP').length / selected.length * 100 : 0;
    const predictedPct = selected.length ? mean(selected.map((row) => row.probability)) : minimum + 5;
    return { label: `${minimum}–${minimum + 9}%`, count: selected.length, predictedPct, observedPct, errorPct: selected.length ? Math.abs(predictedPct - observedPct) : 0 };
  });
  const expectedCalibrationErrorPct = resolved ? bins.reduce((sum, bin) => sum + bin.errorPct * bin.count / resolved, 0) : 0;
  const splitIndex = Math.max(1, Math.floor(resolved * 0.7));
  const training = activeRows.slice(0, splitIndex); const outOfSample = activeRows.slice(splitIndex);
  const trainWinRatePct = training.length ? training.filter((row) => row.outcome === 'TP').length / training.length * 100 : 0;
  const outOfSampleWinRatePct = outOfSample.length ? outOfSample.filter((row) => row.outcome === 'TP').length / outOfSample.length * 100 : 0;
  const recent = activeRows.slice(-Math.min(30, Math.floor(activeRows.length / 2))); const prior = activeRows.slice(-Math.min(60, activeRows.length), -recent.length);
  const recentWinRatePct = recent.length ? recent.filter((row) => row.outcome === 'TP').length / recent.length * 100 : 0;
  const priorWinRatePct = prior.length ? prior.filter((row) => row.outcome === 'TP').length / prior.length * 100 : recentWinRatePct;
  const driftPct = recent.length && prior.length ? recentWinRatePct - priorWinRatePct : 0;
  const expectancyR = mean(activeRows.map((row) => row.outcome === 'TP' ? Number(JSON.parse(row.payload).riskReward || 1.2) : row.outcome === 'INVALIDACION' ? -1 : 0));
  const regimeMap = new Map<string, OutcomeRow[]>();
  activeRows.forEach((row) => regimeMap.set(row.regime || 'Sin clasificar', [...(regimeMap.get(row.regime || 'Sin clasificar') || []), row]));
  const byRegime = [...regimeMap.entries()].map(([regime, items]) => ({ regime, count: items.length, winRatePct: items.filter((item) => item.outcome === 'TP').length / items.length * 100, expectancyR: mean(items.map((item) => item.outcome === 'TP' ? Number(JSON.parse(item.payload).riskReward || 1.2) : item.outcome === 'INVALIDACION' ? -1 : 0)) })).sort((a, b) => b.count - a.count);
  const status = resolved < 30 ? 'RECOLECTANDO' : resolved < 100 ? 'VALIDACIÓN INICIAL' : resolved < 300 ? 'CALIBRANDO' : expectedCalibrationErrorPct <= 8 && outOfSampleWinRatePct >= 50 && driftPct > -12 ? 'EVIDENCIA SÓLIDA' : 'REVISIÓN NECESARIA';
  const recommendation = resolved < 30 ? 'Muestra insuficiente: tratar las probabilidades como experimentales.'
    : expectedCalibrationErrorPct > 12 ? 'La confianza está mal calibrada; reducir su peso hasta recalibrar.'
      : driftPct < -12 ? 'El desempeño reciente se deterioró; aumentar la abstención.'
        : outOfSample.length < 20 ? 'Faltan más casos fuera de muestra antes de validar.'
          : 'La muestra permite evaluación inicial; continuar monitoreando por régimen.';
  return { evaluated, notActivated, resolved, wins, invalidations, expired, winRatePct: resolved ? wins / resolved * 100 : 0, brierScore, logLoss, expectedCalibrationErrorPct, expectancyR, averageMfePct: mean(activeRows.map((row) => row.mfe_pct)), averageMaePct: mean(activeRows.map((row) => row.mae_pct)), averageResolutionMinutes: mean(activeRows.map((row) => row.time_to_minutes)), trainWinRatePct, outOfSampleWinRatePct, outOfSampleCount: outOfSample.length, recentWinRatePct, priorWinRatePct, driftPct, bins, byRegime, status, recommendation };
}

export async function GET(request: NextRequest) {
  const db = getDatabase();
  if (!db) return NextResponse.json({ available: false, status: 'SIN BASE', message: 'La base histórica no está disponible.' });
  await ensureDatabase(db);
  const symbol = (request.nextUrl.searchParams.get('symbol') || 'BTCUSDT').toUpperCase();
  const timeframe = request.nextUrl.searchParams.get('timeframe') || '1h';
  const snapshots = await db.prepare('SELECT id, symbol, timeframe, captured_at, spot_price, direction, probability, target, invalidation, payload FROM market_snapshots WHERE symbol = ? AND timeframe = ? ORDER BY captured_at ASC LIMIT 10000').bind(symbol, timeframe).all<SnapshotRow>();
  const rows = snapshots.results;
  const inserts: D1PreparedStatement[] = [];
  let pending = 0; let cursor = 0;
  while (cursor < rows.length - 1) {
    const forecast = rows[cursor];
    if (!['LONG', 'SHORT'].includes(forecast.direction)) { cursor += 1; continue; }
    const startedAt = new Date(forecast.captured_at).getTime(); const expiresAt = startedAt + (validityHours[timeframe] || 24) * 60 * 60 * 1000;
    const payload = JSON.parse(forecast.payload || '{}');
    const entryPrice = Number(payload.entries?.[0]?.price || forecast.spot_price);
    const long = forecast.direction === 'LONG'; let activated = long ? forecast.spot_price <= entryPrice : forecast.spot_price >= entryPrice; let maxFavorable = 0; let maxAdverse = 0; let outcome: OutcomeRow['outcome'] | null = null; let resolutionIndex = cursor;
    for (let index = cursor + 1; index < rows.length; index++) {
      const point = rows[index]; const pointTime = new Date(point.captured_at).getTime(); const move = (point.spot_price - forecast.spot_price) / forecast.spot_price * 100;
      if (!activated && (long ? point.spot_price <= entryPrice : point.spot_price >= entryPrice)) activated = true;
      if (pointTime >= expiresAt && !activated) { outcome = 'NO_ACTIVADO'; resolutionIndex = index; break; }
      if (!activated) continue;
      maxFavorable = Math.max(maxFavorable, long ? move : -move); maxAdverse = Math.max(maxAdverse, long ? -move : move);
      if (long ? point.spot_price >= forecast.target : point.spot_price <= forecast.target) { outcome = 'TP'; resolutionIndex = index; break; }
      if (long ? point.spot_price <= forecast.invalidation : point.spot_price >= forecast.invalidation) { outcome = 'INVALIDACION'; resolutionIndex = index; break; }
      if (pointTime >= expiresAt) { outcome = 'VENCIDO'; resolutionIndex = index; break; }
    }
    if (!outcome) { pending += 1; break; }
    const resolvedAt = rows[resolutionIndex].captured_at;
    inserts.push(db.prepare('INSERT OR IGNORE INTO forecast_outcomes (id, snapshot_id, symbol, timeframe, forecast_at, resolved_at, outcome, direction, probability, regime, entry_price, target, invalidation, mfe_pct, mae_pct, time_to_minutes, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(`outcome-${forecast.id}`, forecast.id, symbol, timeframe, forecast.captured_at, resolvedAt, outcome, forecast.direction, forecast.probability, String(payload.regime || 'Sin clasificar'), entryPrice, forecast.target, forecast.invalidation, maxFavorable, maxAdverse, (new Date(resolvedAt).getTime() - startedAt) / 60000, JSON.stringify(payload)));
    cursor = resolutionIndex + 1;
  }
  if (inserts.length) await db.batch(inserts);
  const outcomes = await db.prepare('SELECT id, outcome, probability, regime, mfe_pct, mae_pct, time_to_minutes, forecast_at, payload FROM forecast_outcomes WHERE symbol = ? AND timeframe = ? ORDER BY forecast_at ASC LIMIT 5000').bind(symbol, timeframe).all<OutcomeRow>();
  const metrics = summarize(outcomes.results);
  return NextResponse.json({ available: true, symbol, timeframe, snapshots: rows.length, pending, generatedAt: new Date().toISOString(), targets: { initial: 30, calibration: 100, professional: 300, definitive: 1000 }, progressPct: Math.min(100, metrics.resolved / 1000 * 100), ...metrics });
}
