import { NextRequest, NextResponse } from 'next/server';
import { analyzeTimeframe, buildClusters, buildMacroLiquidity, buildPlan } from '../../../lib/engine';

export const dynamic = 'force-dynamic';

const SPOT = 'https://api.binance.com';
const FUTURES = 'https://fapi.binance.com';
const BYBIT = 'https://api.bybit.com';
const allowedTimeframes = new Set(['15m', '1h', '4h', '1d']);

async function binanceJson(url: string) {
  const response = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`Binance respondió ${response.status}`);
  return response.json();
}

function bookImbalance(bids: unknown[][], asks: unknown[][], limit = 200) {
  const bidNotional = bids.slice(0, limit).reduce((sum, row) => sum + Number(row[0]) * Number(row[1]), 0);
  const askNotional = asks.slice(0, limit).reduce((sum, row) => sum + Number(row[0]) * Number(row[1]), 0);
  return bidNotional + askNotional ? (bidNotional - askNotional) / (bidNotional + askNotional) * 100 : 0;
}

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  const params = request.nextUrl.searchParams;
  const symbol = (params.get('symbol') || 'BTCUSDT').toUpperCase();
  const executionTimeframe = params.get('timeframe') || '1h';
  if (!/^[A-Z0-9]{5,20}$/.test(symbol)) return NextResponse.json({ error: 'El símbolo no tiene un formato válido de Binance.' }, { status: 400 });
  if (!allowedTimeframes.has(executionTimeframe)) return NextResponse.json({ error: 'Temporalidad operativa no válida.' }, { status: 400 });
  const capital = Math.max(100, Math.min(10_000_000, Number(params.get('capital')) || 10000));
  const allocations = (params.get('allocations') || '40,35,25').split(',').map(Number);
  if (allocations.length !== 3 || allocations.some((value) => !Number.isFinite(value) || value < 0)) return NextResponse.json({ error: 'La distribución debe contener tres porcentajes válidos.' }, { status: 400 });

  try {
    const [ticker, depth, trades, ...klines] = await Promise.all([
      binanceJson(`${SPOT}/api/v3/ticker/24hr?symbol=${symbol}`),
      binanceJson(`${SPOT}/api/v3/depth?symbol=${symbol}&limit=5000`),
      binanceJson(`${SPOT}/api/v3/aggTrades?symbol=${symbol}&limit=1000`),
      ...['15m', '1h', '4h', '1d'].map((interval) => binanceJson(`${SPOT}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=260`)),
      binanceJson(`${SPOT}/api/v3/klines?symbol=BTCUSDT&interval=4h&limit=120`),
    ]);

    const derivatives = await Promise.allSettled([
      binanceJson(`${FUTURES}/fapi/v1/openInterest?symbol=${symbol}`),
      binanceJson(`${FUTURES}/futures/data/openInterestHist?symbol=${symbol}&period=5m&limit=30`),
      binanceJson(`${FUTURES}/fapi/v1/premiumIndex?symbol=${symbol}`),
      binanceJson(`${FUTURES}/fapi/v1/depth?symbol=${symbol}&limit=1000`),
      binanceJson(`${BYBIT}/v5/market/orderbook?category=spot&symbol=${symbol}&limit=1000`),
      binanceJson(`${BYBIT}/v5/market/tickers?category=spot&symbol=${symbol}`),
    ]);
    const spot = Number(ticker.lastPrice);
    const intervals = ['15m', '1h', '4h', '1d'];
    const timeframes = intervals.map((timeframe, index) => analyzeTimeframe(timeframe, klines[index] as unknown[][]));
    const candleSeries = Object.fromEntries(intervals.map((interval, index) => [
      interval,
      (klines[index] as unknown[][]).slice(-240).map((row) => ({
        time: Number(row[0]),
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[5]),
      })),
    ]));
    const clusters = [
      ...buildClusters(depth.bids as unknown[][], 'bid', spot),
      ...buildClusters(depth.asks as unknown[][], 'ask', spot),
    ];
    const bidRows = depth.bids as unknown[][];
    const askRows = depth.asks as unknown[][];
    const lowestBid = Number(bidRows.at(-1)?.[0] || spot);
    const highestAsk = Number(askRows.at(-1)?.[0] || spot);
    const orderBookCoverage = {
      bidLevels: bidRows.length,
      askLevels: askRows.length,
      lowestBid,
      highestAsk,
      bidDistancePct: (lowestBid - spot) / spot * 100,
      askDistancePct: (highestAsk - spot) / spot * 100,
    };
    const macroLiquidityZones = buildMacroLiquidity(candleSeries, spot);
    const btcCandles = (klines[4] as unknown[][]).map((row) => ({
      time: Number(row[0]), open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]), volume: Number(row[5]),
    }));
    let buyNotional = 0;
    let sellNotional = 0;
    for (const trade of trades as Array<{ p: string; q: string; m: boolean }>) {
      const notional = Number(trade.p) * Number(trade.q);
      if (trade.m) sellNotional += notional; else buyNotional += notional;
    }
    const totalFlow = buyNotional + sellNotional;
    const deltaPct = totalFlow ? (buyNotional - sellNotional) / totalFlow * 100 : 0;
    const oiCurrent = derivatives[0].status === 'fulfilled' ? Number(derivatives[0].value.openInterest) : null;
    let oiChange: number | null = null;
    if (derivatives[1].status === 'fulfilled' && Array.isArray(derivatives[1].value) && derivatives[1].value.length > 1) {
      const first = Number(derivatives[1].value[0].sumOpenInterest);
      const latest = Number(derivatives[1].value.at(-1).sumOpenInterest);
      oiChange = first ? (latest - first) / first * 100 : null;
    }
    const funding = derivatives[2].status === 'fulfilled' ? Number(derivatives[2].value.lastFundingRate) : null;
    const markPrice = derivatives[2].status === 'fulfilled' ? Number(derivatives[2].value.markPrice) : null;
    const indexPrice = derivatives[2].status === 'fulfilled' ? Number(derivatives[2].value.indexPrice) : null;
    const basisPct = markPrice && indexPrice ? (markPrice - indexPrice) / indexPrice * 100 : null;
    const futuresDepth = derivatives[3].status === 'fulfilled' ? derivatives[3].value : null;
    const futuresBookImbalancePct = futuresDepth ? bookImbalance(futuresDepth.bids as unknown[][], futuresDepth.asks as unknown[][]) : null;
    const bybitDepth = derivatives[4].status === 'fulfilled' ? derivatives[4].value?.result : null;
    const bybitBookImbalancePct = bybitDepth?.b && bybitDepth?.a ? bookImbalance(bybitDepth.b as unknown[][], bybitDepth.a as unknown[][]) : null;
    const bybitTicker = derivatives[5].status === 'fulfilled' ? derivatives[5].value?.result?.list?.[0] : null;
    const bybitPrice = bybitTicker?.lastPrice ? Number(bybitTicker.lastPrice) : null;
    const binanceBookImbalancePct = bookImbalance(bidRows, askRows);
    const result = buildPlan({
      symbol,
      spot,
      priceChangePct: Number(ticker.priceChangePercent),
      capital,
      allocations,
      executionTimeframe,
      timeframes,
      candles: candleSeries,
      clusters,
      orderBookCoverage,
      macroLiquidityZones,
      orderFlow: { deltaPct, buyNotional, sellNotional },
      openInterest: oiCurrent,
      openInterestChangePct: oiChange,
      fundingRate: funding,
      basisPct,
      futuresBookImbalancePct,
      bybitPrice,
      binanceBookImbalancePct,
      bybitBookImbalancePct,
      sourceHealth: {
        generatedAt: new Date().toISOString(),
        totalLatencyMs: Date.now() - startedAt,
        spot: 'OK',
        derivatives: derivatives.slice(0, 4).every((item) => item.status === 'fulfilled') ? 'OK' : derivatives.slice(0, 4).some((item) => item.status === 'fulfilled') ? 'PARCIAL' : 'NO_DISPONIBLE',
        bybit: derivatives[4].status === 'fulfilled' && derivatives[5].status === 'fulfilled' ? 'OK' : 'NO_DISPONIBLE',
        warnings: [
          ...(derivatives.slice(0, 4).some((item) => item.status === 'rejected') ? ['Uno o más datos de futuros no respondieron.'] : []),
          ...(derivatives[4].status === 'rejected' || derivatives[5].status === 'rejected' ? ['Bybit no respondió; se usa Binance como fuente principal.'] : []),
        ],
      },
      btcCandles,
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    return NextResponse.json({ error: `No fue posible completar el análisis: ${message}. Verificá tu conexión o la disponibilidad regional de Binance.` }, { status: 502 });
  }
}
