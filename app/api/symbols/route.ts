import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const response = await fetch('https://api.binance.com/api/v3/exchangeInfo', { cache: 'no-store', signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error(`Binance respondió ${response.status}`);
    const data = await response.json() as { symbols?: Array<{ symbol: string; status: string; isSpotTradingAllowed?: boolean; quoteAsset: string }> };
    const symbols = (data.symbols || [])
      .filter((item) => item.status === 'TRADING' && item.isSpotTradingAllowed !== false && item.quoteAsset === 'USDT')
      .sort((a, b) => a.symbol.localeCompare(b.symbol))
      .map((item) => ({ symbol: item.symbol, quoteAsset: item.quoteAsset }));
    return NextResponse.json({ symbols }, { headers: { 'Cache-Control': 'public, max-age=3600' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    return NextResponse.json({ error: `No se pudo cargar la lista de pares: ${message}` }, { status: 502 });
  }
}
