import { NextResponse } from 'next/server';
import { atr, ema, last, rsi } from '../../../lib/indicators';

export const dynamic = 'force-dynamic';
const SPOT = 'https://api.binance.com';

async function getJson(url: string) {
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`Binance respondió ${response.status}`);
  return response.json();
}

export async function GET() {
  try {
    const tickers = await getJson(`${SPOT}/api/v3/ticker/24hr`) as Array<{ symbol: string; lastPrice: string; priceChangePercent: string; quoteVolume: string }>;
    const candidates = tickers
      .filter((ticker) => ticker.symbol.endsWith('USDT') && !/(UP|DOWN|BULL|BEAR|USDC|FDUSD)USDT$/.test(ticker.symbol) && Number(ticker.quoteVolume) > 5_000_000)
      .sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume))
      .slice(0, 14);
    const rows = await Promise.all(candidates.map(async (ticker) => {
      const raw = await getJson(`${SPOT}/api/v3/klines?symbol=${ticker.symbol}&interval=4h&limit=90`) as unknown[][];
      const candles = raw.map((row) => [Number(row[0]), Number(row[1]), Number(row[2]), Number(row[3]), Number(row[4]), Number(row[5])]);
      const closes = candles.map((candle) => candle[4]);
      const e10 = last(ema(closes, 10)); const e55 = last(ema(closes, 55)); const currentRsi = rsi(closes); const currentAtr = atr(candles);
      const direction = e10 > e55 && currentRsi >= 52 ? 'LONG' : e10 < e55 && currentRsi <= 48 ? 'SHORT' : 'NEUTRAL';
      const separation = Math.abs(e10 - e55) / Math.max(last(closes), 1) * 100;
      const atrPct = currentAtr / Math.max(last(closes), 1) * 100;
      const score = Math.min(99, Math.round(45 + separation * 12 + Math.abs(currentRsi - 50) * 0.7 + Math.min(15, atrPct * 2)));
      return { symbol: ticker.symbol, direction, score, price: Number(ticker.lastPrice), priceChangePct: Number(ticker.priceChangePercent), quoteVolume: Number(ticker.quoteVolume), rsi: currentRsi, atrPct };
    }));
    return NextResponse.json({ timestamp: new Date().toISOString(), opportunities: rows.sort((a, b) => (b.direction !== 'NEUTRAL' ? b.score : 0) - (a.direction !== 'NEUTRAL' ? a.score : 0)) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo completar el radar.' }, { status: 502 });
  }
}
