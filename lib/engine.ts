import { atr, bollinger, ema, last, macd, rsi } from './indicators';
import type { AnalysisResult, Candle, Direction, LiquidityCluster, MacroLiquidityZone, TimeframeAnalysis } from './types';

const round = (value: number, decimals = 2) => Number(value.toFixed(decimals));
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] || 1;
};

const candleReturn = (candles: Candle[], bars: number) => {
  const slice = candles.slice(-Math.max(2, bars + 1));
  return slice.length > 1 ? (slice.at(-1)!.close - slice[0].close) / slice[0].close * 100 : 0;
};

const correlation = (left: number[], right: number[]) => {
  const length = Math.min(left.length, right.length);
  if (length < 3) return 0;
  const a = left.slice(-length);
  const b = right.slice(-length);
  const meanA = a.reduce((sum, value) => sum + value, 0) / length;
  const meanB = b.reduce((sum, value) => sum + value, 0) / length;
  let numerator = 0; let denominatorA = 0; let denominatorB = 0;
  for (let index = 0; index < length; index++) {
    const deltaA = a[index] - meanA; const deltaB = b[index] - meanB;
    numerator += deltaA * deltaB; denominatorA += deltaA ** 2; denominatorB += deltaB ** 2;
  }
  return denominatorA && denominatorB ? numerator / Math.sqrt(denominatorA * denominatorB) : 0;
};

function analyzeStructure(timeframe: string, candles: Candle[]) {
  const sample = candles.slice(-24);
  const prior = sample.slice(0, 12);
  const recent = sample.slice(12);
  const priorHigh = Math.max(...prior.map((candle) => candle.high));
  const priorLow = Math.min(...prior.map((candle) => candle.low));
  const recentHigh = Math.max(...recent.map((candle) => candle.high));
  const recentLow = Math.min(...recent.map((candle) => candle.low));
  const close = sample.at(-1)?.close || 0;
  let state: 'BOS_ALCISTA' | 'BOS_BAJISTA' | 'SECUENCIA_ALCISTA' | 'SECUENCIA_BAJISTA' | 'RANGO' = 'RANGO';
  if (close > priorHigh) state = 'BOS_ALCISTA';
  else if (close < priorLow) state = 'BOS_BAJISTA';
  else if (recentHigh > priorHigh && recentLow > priorLow) state = 'SECUENCIA_ALCISTA';
  else if (recentHigh < priorHigh && recentLow < priorLow) state = 'SECUENCIA_BAJISTA';
  const explanation = state === 'BOS_ALCISTA' ? 'El cierre rompió el máximo estructural previo.'
    : state === 'BOS_BAJISTA' ? 'El cierre rompió el mínimo estructural previo.'
      : state === 'SECUENCIA_ALCISTA' ? 'Mantiene máximos y mínimos ascendentes.'
        : state === 'SECUENCIA_BAJISTA' ? 'Mantiene máximos y mínimos descendentes.'
          : 'Máximos y mínimos se solapan; no hay ruptura confirmada.';
  return { timeframe, state, swingHigh: recentHigh, swingLow: recentLow, explanation };
}

function buildVolumeAnalytics(candles: Candle[], spot: number) {
  const sample = candles.slice(-120);
  const min = Math.min(...sample.map((candle) => candle.low));
  const max = Math.max(...sample.map((candle) => candle.high));
  const step = Math.max((max - min) / 32, spot * 0.0001);
  const bins = Array.from({ length: 32 }, (_, index) => ({ price: min + step * (index + 0.5), volume: 0 }));
  let weighted = 0; let total = 0;
  sample.forEach((candle) => {
    const typical = (candle.high + candle.low + candle.close) / 3;
    const index = Math.max(0, Math.min(31, Math.floor((typical - min) / step)));
    bins[index].volume += candle.volume;
    weighted += typical * candle.volume; total += candle.volume;
  });
  const poc = [...bins].sort((a, b) => b.volume - a.volume)[0]?.price || spot;
  const targetVolume = total * 0.7;
  let accumulated = 0;
  const valueBins = [...bins].sort((a, b) => b.volume - a.volume).filter((bin) => {
    if (accumulated >= targetVolume) return false;
    accumulated += bin.volume; return true;
  });
  const valueAreaLow = Math.min(...valueBins.map((bin) => bin.price - step / 2));
  const valueAreaHigh = Math.max(...valueBins.map((bin) => bin.price + step / 2));
  const anchorIndex = Math.max(0, sample.length - 60 + sample.slice(-60).reduce((best, candle, index, rows) => candle.volume > rows[best].volume ? index : best, 0));
  const anchored = sample.slice(anchorIndex);
  const anchorVolume = anchored.reduce((sum, candle) => sum + candle.volume, 0) || 1;
  const anchoredVwap = anchored.reduce((sum, candle) => sum + ((candle.high + candle.low + candle.close) / 3) * candle.volume, 0) / anchorVolume;
  return { poc, valueAreaHigh, valueAreaLow, vwap: weighted / Math.max(total, 1), anchoredVwap, position: spot > valueAreaHigh ? 'SOBRE_VALOR' as const : spot < valueAreaLow ? 'BAJO_VALOR' as const : 'EN_VALOR' as const };
}

function validateHistoricalSignals(candles: Candle[]) {
  const closes = candles.map((candle) => candle.close);
  const ema10Series = ema(closes, 10);
  const ema55Series = ema(closes, 55);
  const evaluate = (rsiFilter: boolean) => {
    const outcomes: number[] = []; let wins = 0; let losses = 0; let expired = 0;
    for (let index = 60; index < candles.length - 16; index += 4) {
      const history = candles.slice(0, index + 1); const currentRsi = rsi(history.map((candle) => candle.close));
      const longSignal = ema10Series[index] > ema55Series[index] && (!rsiFilter || currentRsi >= 52);
      const shortSignal = ema10Series[index] < ema55Series[index] && (!rsiFilter || currentRsi <= 48);
      if (!longSignal && !shortSignal) continue;
      const entry = candles[index].close; const currentAtr = atr(history.map((candle) => [candle.time, candle.open, candle.high, candle.low, candle.close, candle.volume]));
      const stop = longSignal ? entry - currentAtr : entry + currentAtr; const target = longSignal ? entry + currentAtr * 1.5 : entry - currentAtr * 1.5;
      let outcome = 0;
      for (const candle of candles.slice(index + 1, index + 17)) {
        const stopTouched = longSignal ? candle.low <= stop : candle.high >= stop; const targetTouched = longSignal ? candle.high >= target : candle.low <= target;
        if (stopTouched) { outcome = -1; break; } if (targetTouched) { outcome = 1.5; break; }
      }
      outcomes.push(outcome); if (outcome > 0) wins += 1; else if (outcome < 0) losses += 1; else expired += 1;
    }
    let equity = 0; let peak = 0; let maxDrawdownR = 0;
    outcomes.forEach((outcome) => { equity += outcome; peak = Math.max(peak, equity); maxDrawdownR = Math.max(maxDrawdownR, peak - equity); });
    const sampleSize = outcomes.length; const winRatePct = wins + losses ? wins / (wins + losses) * 100 : 0; const expectancyR = sampleSize ? outcomes.reduce((sum, value) => sum + value, 0) / sampleSize : 0; const profitFactor = losses ? wins * 1.5 / losses : wins ? 99 : 0;
    return { sampleSize, wins, losses, expired, winRatePct, expectancyR, profitFactor, maxDrawdownR };
  };
  const current = evaluate(true); const baseline = evaluate(false);
  const { sampleSize, wins, losses, expired, winRatePct, expectancyR, profitFactor, maxDrawdownR } = current;
  const label = sampleSize < 20 ? 'Muestra insuficiente' : expectancyR > 0.2 && profitFactor > 1.25 ? 'Ventaja técnica positiva' : expectancyR > 0 ? 'Ventaja débil' : 'Sin ventaja histórica';
  return {
    sampleSize, wins, losses, expired, winRatePct, expectancyR, profitFactor, maxDrawdownR, baselineWinRatePct: baseline.winRatePct, baselineExpectancyR: baseline.expectancyR, improvementR: expectancyR - baseline.expectancyR, label,
    methodology: 'Validación técnica proxy: EMA 10/55 + RSI, entrada al cierre, objetivo 1,5 ATR, stop 1 ATR y máximo 16 velas. No reconstruye el libro ni el OI históricos.',
  };
}

export function analyzeTimeframe(timeframe: string, raw: unknown[][]): TimeframeAnalysis {
  const candles = raw.map((row) => [Number(row[0]), Number(row[1]), Number(row[2]), Number(row[3]), Number(row[4]), Number(row[5])]);
  const closes = candles.map((candle) => candle[4]);
  const e10 = last(ema(closes, 10));
  const e55 = last(ema(closes, 55));
  const e200 = last(ema(closes, 200));
  const currentRsi = rsi(closes);
  const currentMacd = macd(closes);
  const bands = bollinger(closes);
  let score = 0;
  score += e10 > e55 ? 1 : -1;
  score += e55 > e200 ? 1 : -1;
  score += last(closes) > e200 ? 1 : -1;
  score += currentMacd.value > currentMacd.signal ? 0.75 : -0.75;
  if (currentRsi > 52 && currentRsi < 72) score += 0.5;
  if (currentRsi < 48 && currentRsi > 28) score -= 0.5;
  const trend: Direction = score >= 1.5 ? 'LONG' : score <= -1.5 ? 'SHORT' : 'NEUTRAL';
  return { timeframe, close: last(closes), ema10: e10, ema55: e55, ema200: e200, rsi: currentRsi, macd: currentMacd.value, macdSignal: currentMacd.signal, bollingerUpper: bands.upper, bollingerMiddle: bands.middle, bollingerLower: bands.lower, atr: atr(candles), trend, score };
}

export function buildClusters(levels: unknown[][], side: 'bid' | 'ask', spot: number): LiquidityCluster[] {
  const bucketPct = 0.0015;
  const buckets = new Map<number, Array<{ price: number; qty: number }>>();
  for (const row of levels) {
    const price = Number(row[0]);
    const qty = Number(row[1]);
    const bucket = Math.round(Math.log(price / spot) / bucketPct);
    const group = buckets.get(bucket) || [];
    group.push({ price, qty });
    buckets.set(bucket, group);
  }
  const aggregated = [...buckets.values()].map((group) => {
    const notional = group.reduce((sum, item) => sum + item.price * item.qty, 0);
    const executionPrice = group.reduce((sum, item) => sum + item.price * item.price * item.qty, 0) / notional;
    return { side, low: Math.min(...group.map((item) => item.price)), high: Math.max(...group.map((item) => item.price)), executionPrice, notional };
  });
  const baseline = median(aggregated.map((item) => item.notional));
  return aggregated
    .map((item) => ({ ...item, strength: item.notional / baseline, distancePct: ((item.executionPrice - spot) / spot) * 100 }))
    .sort((a, b) => b.strength - a.strength);
}

export function buildMacroLiquidity(candles: Record<string, Candle[]>, spot: number): MacroLiquidityZone[] {
  const zones: MacroLiquidityZone[] = [];
  for (const timeframe of ['4h', '1d'] as const) {
    const bucketPct = timeframe === '1d' ? 0.012 : 0.0075;
    const buckets = new Map<number, { notional: number; weightedPrice: number; low: number; high: number; touches: number }>();
    for (const candle of candles[timeframe] || []) {
      const typicalPrice = (candle.high + candle.low + candle.close) / 3;
      const notional = typicalPrice * candle.volume;
      const bucket = Math.round(Math.log(typicalPrice / spot) / bucketPct);
      const current = buckets.get(bucket) || { notional: 0, weightedPrice: 0, low: Number.POSITIVE_INFINITY, high: 0, touches: 0 };
      current.notional += notional;
      current.weightedPrice += typicalPrice * notional;
      current.low = Math.min(current.low, candle.low);
      current.high = Math.max(current.high, candle.high);
      current.touches += 1;
      buckets.set(bucket, current);
    }
    const baseline = median([...buckets.values()].map((bucket) => bucket.notional));
    for (const bucket of buckets.values()) {
      const executionPrice = bucket.weightedPrice / Math.max(bucket.notional, 1);
      zones.push({
        side: executionPrice < spot ? 'below' : 'above',
        low: bucket.low,
        high: bucket.high,
        executionPrice,
        score: bucket.notional / baseline * (timeframe === '1d' ? 1.25 : 1),
        distancePct: (executionPrice - spot) / spot * 100,
        timeframe,
        touchCount: bucket.touches,
        approximateNotional: bucket.notional,
      });
    }
  }
  const selected: MacroLiquidityZone[] = [];
  for (const zone of zones.sort((a, b) => b.score - a.score)) {
    if (selected.every((item) => Math.abs(item.executionPrice - zone.executionPrice) / spot > 0.006)) selected.push(zone);
    if (selected.length === 14) break;
  }
  return selected;
}

export function estimateLiquidations(spot: number, openInterest: number | null, funding: number | null) {
  const baseWeight = openInterest ? Math.log10(Math.max(openInterest, 10)) : 1;
  return [5, 10, 20, 50].flatMap((leverage) => {
    const maintenanceBuffer = leverage >= 20 ? 0.004 : 0.007;
    const move = 1 / leverage - maintenanceBuffer;
    const fundingTilt = funding ? Math.min(Math.abs(funding) * 300, 0.15) : 0;
    return [
      { side: 'long' as const, leverage, price: spot * (1 - move), weight: baseWeight * leverage * (funding && funding > 0 ? 1 + fundingTilt : 1) },
      { side: 'short' as const, leverage, price: spot * (1 + move), weight: baseWeight * leverage * (funding && funding < 0 ? 1 + fundingTilt : 1) },
    ];
  });
}

interface EngineInput {
  symbol: string;
  spot: number;
  priceChangePct: number;
  capital: number;
  allocations: number[];
  executionTimeframe: string;
  timeframes: TimeframeAnalysis[];
  candles: Record<string, Candle[]>;
  clusters: LiquidityCluster[];
  orderBookCoverage: AnalysisResult['orderBookCoverage'];
  macroLiquidityZones: MacroLiquidityZone[];
  orderFlow: { deltaPct: number; buyNotional: number; sellNotional: number };
  openInterest: number | null;
  openInterestChangePct: number | null;
  fundingRate: number | null;
  basisPct: number | null;
  futuresBookImbalancePct: number | null;
  bybitPrice: number | null;
  binanceBookImbalancePct: number;
  bybitBookImbalancePct: number | null;
  sourceHealth: AnalysisResult['sourceHealth'];
  btcCandles: Candle[];
}

export function buildPlan(input: EngineInput): AnalysisResult {
  const weights = [1, 1.5, 2.2, 3];
  const technicalScore = input.timeframes.reduce((sum, frame, index) => sum + frame.score * weights[index], 0) / weights.reduce((a, b) => a + b, 0);
  const flowScore = Math.max(-2, Math.min(2, input.orderFlow.deltaPct / 12));
  const fundingPenalty = input.fundingRate ? Math.sign(input.fundingRate) * Math.min(Math.abs(input.fundingRate) * 5000, 1) : 0;
  const totalScore = technicalScore + flowScore * 0.8 - fundingPenalty * 0.25;
  const direction: Direction = totalScore > 0.65 ? 'LONG' : totalScore < -0.65 ? 'SHORT' : 'NEUTRAL';
  const probability = round(Math.min(84, 50 + Math.abs(totalScore) * 8), 0);
  const operationalDirection: Exclude<Direction, 'NEUTRAL'> = direction === 'NEUTRAL' ? (technicalScore >= 0 ? 'LONG' : 'SHORT') : direction;
  const desiredSide = operationalDirection === 'LONG' ? 'bid' : 'ask';
  const profile = {
    '15m': { minimums: [0.0025, 0.006, 0.011], reach: 0.04, targetMinimum: 0.006, invalidationMinimum: 0.003 },
    '1h': { minimums: [0.004, 0.01, 0.019], reach: 0.08, targetMinimum: 0.01, invalidationMinimum: 0.0045 },
    '4h': { minimums: [0.007, 0.017, 0.032], reach: 0.15, targetMinimum: 0.016, invalidationMinimum: 0.007 },
    '1d': { minimums: [0.014, 0.035, 0.065], reach: 0.3, targetMinimum: 0.03, invalidationMinimum: 0.012 },
  }[input.executionTimeframe] || { minimums: [0.004, 0.01, 0.019], reach: 0.08, targetMinimum: 0.01, invalidationMinimum: 0.0045 };
  const executionFrame = input.timeframes.find((frame) => frame.timeframe === input.executionTimeframe) || input.timeframes[1];
  const frameAtr = executionFrame?.atr || input.spot * profile.minimums[1];
  const atrPct = frameAtr / input.spot;
  const targetMoves = profile.minimums.map((minimum, index) => Math.max(minimum, atrPct * [0.35, 0.8, 1.35][index]));
  const estimatedLiquidations = estimateLiquidations(input.spot, input.openInterest, input.fundingRate);
  const bookCandidates = input.clusters
    .filter((cluster) => cluster.strength >= 1.25
      && cluster.side === desiredSide
      && (operationalDirection === 'LONG' ? cluster.executionPrice < input.spot : cluster.executionPrice > input.spot))
    .sort((a, b) => b.notional - a.notional || b.strength - a.strength);
  const liquidationSide = operationalDirection === 'LONG' ? 'long' : 'short';
  const relevantLiquidations = estimatedLiquidations.filter((zone) => zone.side === liquidationSide);
  const structuralMinimumPct = { '15m': 1.5, '1h': 2.5, '4h': 3.5, '1d': 5 }[input.executionTimeframe] || 2.5;
  type PlanLevel = { price: number; cluster?: LiquidityCluster; volumeRank?: number; structuralReason?: string; score: number; zoneHalfWidth?: number; evidence?: string[] };
  const structuralCandidates: PlanLevel[] = input.macroLiquidityZones
    .filter((zone) => zone.score >= 1.6
      && Math.abs(zone.distancePct) >= structuralMinimumPct
      && (operationalDirection === 'LONG' ? zone.side === 'below' : zone.side === 'above'))
    .map((zone) => {
      const matchingLiquidation = relevantLiquidations
        .map((liquidation) => ({ liquidation, gap: Math.abs(liquidation.price - zone.executionPrice) / input.spot }))
        .sort((a, b) => a.gap - b.gap)[0];
      const liquidationConfluence = matchingLiquidation && matchingLiquidation.gap <= 0.01 ? 1.8 : 0;
      const matchingBook = bookCandidates.some((cluster) => Math.abs(cluster.executionPrice - zone.executionPrice) / input.spot <= 0.004);
      const bookConfluence = matchingBook ? 0.45 : 0;
      const distancePenalty = Math.abs(zone.distancePct) / 20;
      const confluenceText = liquidationConfluence
        ? ` Coincide con la zona de liquidación ${matchingLiquidation.liquidation.leverage}× estimada.`
        : matchingBook ? ' También aparece liquidez visible cerca de este nivel.' : '';
      const evidence = [`Nodo de volumen ${zone.timeframe}`, `${zone.touchCount} velas`];
      if (liquidationConfluence) evidence.push(`Liquidación ${matchingLiquidation.liquidation.leverage}×`);
      if (matchingBook) evidence.push('Muro visible');
      return {
        price: zone.executionPrice,
        score: zone.score + liquidationConfluence + bookConfluence - distancePenalty,
        zoneHalfWidth: Math.max(input.spot * 0.0025, Math.min((zone.high - zone.low) * 0.08, frameAtr * 0.25)),
        evidence,
        structuralReason: `Nodo estructural ${zone.timeframe} de ${zone.score.toFixed(1)}×, construido con ${zone.touchCount} velas.${confluenceText}`,
      };
    });

  const liquidation20x = relevantLiquidations.find((zone) => zone.leverage === 20);
  if (liquidation20x) {
    structuralCandidates.push({
      price: liquidation20x.price,
      score: 3.5,
      zoneHalfWidth: input.spot * 0.0035,
      evidence: ['Liquidación estimada 20×', 'OI y funding de Binance'],
      structuralReason: `Zona de liquidación 20× estimada con datos públicos de Binance (${round(liquidation20x.price, 2)}); funciona como primer nivel estructural fuera del ruido inmediato del libro.`,
    });
  }

  // La confluencia de liquidación 5× y EMA 200 de 4h aproxima la zona profunda
  // que un heatmap estructural muestra mucho más allá del snapshot actual.
  const deepLiquidation = relevantLiquidations.find((zone) => zone.leverage === 5);
  const ema2004h = input.timeframes.find((frame) => frame.timeframe === '4h')?.ema200;
  if (deepLiquidation && ema2004h
    && (operationalDirection === 'LONG' ? ema2004h < input.spot : ema2004h > input.spot)) {
    const deepPrice = deepLiquidation.price * 0.55 + ema2004h * 0.45;
    structuralCandidates.push({
      price: deepPrice,
      score: 3.25,
      zoneHalfWidth: input.spot * 0.005,
      evidence: ['Liquidación estimada 5×', 'EMA 200 de 4h'],
      structuralReason: `Zona profunda por confluencia entre liquidación 5× estimada (${round(deepLiquidation.price, 2)}) y EMA 200 de 4h (${round(ema2004h, 2)}).`,
    });
  }

  const picked: PlanLevel[] = [];
  for (const level of structuralCandidates.sort((a, b) => b.score - a.score)) {
    if (picked.length < 3 && picked.every((item) => Math.abs(item.price - level.price) / input.spot > 0.012)) picked.push(level);
  }

  // Si faltan zonas estructurales, completamos con los mayores muros visibles,
  // sin permitir que un bucket cercano sustituya una confluencia macro más fuerte.
  bookCandidates.forEach((cluster, index) => {
    const isDistinctWall = picked.every((item) => Math.abs(item.price - cluster.executionPrice) / input.spot > 0.004);
    if (picked.length < 3 && isDistinctWall) picked.push({ price: cluster.executionPrice, cluster, volumeRank: index + 1, score: cluster.strength, zoneHalfWidth: Math.max((cluster.high - cluster.low) / 2, input.spot * 0.0015), evidence: ['Order book visible', `${cluster.strength.toFixed(1)}× liquidez normal`] });
  });

  // Las tres entradas son un máximo, no una obligación. Solo usamos ATR si no existe
  // ningún muro operable; nunca rellenamos E2/E3 con niveles débiles o artificiales.
  if (picked.length === 0) {
    const fallbackPrice = input.spot * (operationalDirection === 'LONG' ? 1 - targetMoves[0] : 1 + targetMoves[0]);
    picked.push({ price: fallbackPrice, score: 0, zoneHalfWidth: Math.max(frameAtr * 0.12, input.spot * 0.0025), evidence: [`ATR de ${input.executionTimeframe}`] });
  }
  picked.sort((a, b) => operationalDirection === 'LONG' ? b.price - a.price : a.price - b.price);
  const allocationTotal = input.allocations.reduce((sum, value) => sum + value, 0) || 100;
  let cumulativeUnits = 0;
  let cumulativeCost = 0;
  const entries = picked.map((item, index) => {
    const allocationPct = input.allocations[index] / allocationTotal * 100;
    const allocationValue = input.capital * allocationPct / 100;
    const units = allocationValue / item.price;
    cumulativeUnits += units;
    cumulativeCost += allocationValue;
    const reason = item.structuralReason || (item.cluster
      ? `Muro #${item.volumeRank} por volumen en toda la fotografía del libro: ${item.cluster.strength.toFixed(1)}× la liquidez típica, a ${Math.abs(item.cluster.distancePct).toFixed(2)}% del spot. Fue elegido por tamaño; la distancia solo define el orden E1–E3.`
      : `Entrada condicional calculada con ATR de ${input.executionTimeframe}: no apareció ninguna zona estructural ni muro visible con volumen suficiente.`);
    const zoneHalfWidth = item.zoneHalfWidth || Math.max(frameAtr * 0.12, input.spot * 0.0025);
    const evidence = item.evidence || [`ATR de ${input.executionTimeframe}`];
    const confidence = Math.min(90, Math.max(45, Math.round(48 + item.score * 9 + evidence.length * 3)));
    return { name: `E${index + 1}` as 'E1' | 'E2' | 'E3', price: item.price, zoneLow: item.price - zoneHalfWidth, zoneHigh: item.price + zoneHalfWidth, confidence, confirmations: evidence.length, evidence, allocationPct, allocationValue, averageAfter: cumulativeCost / cumulativeUnits, reason };
  });
  const finalAverage = entries[entries.length - 1].averageAfter;
  const opposing = input.clusters
    .filter((cluster) => cluster.side !== desiredSide && Math.abs(cluster.distancePct) >= profile.targetMinimum * 100 && (operationalDirection === 'LONG' ? cluster.executionPrice > input.spot : cluster.executionPrice < input.spot))
    .sort((a, b) => Math.abs(a.distancePct) - Math.abs(b.distancePct))[0];
  const macroOpposing = input.macroLiquidityZones
    .filter((zone) => zone.score >= 1.3 && Math.abs(zone.distancePct) >= 0.5 && (operationalDirection === 'LONG' ? zone.side === 'above' : zone.side === 'below'))
    .sort((a, b) => Math.abs(a.distancePct) - Math.abs(b.distancePct))[0];
  const fallbackTarget = operationalDirection === 'LONG'
    ? Math.max(input.spot * (1 + profile.targetMinimum), executionFrame?.bollingerUpper || 0)
    : Math.min(input.spot * (1 - profile.targetMinimum), executionFrame?.bollingerLower || Number.POSITIVE_INFINITY);
  const rawTarget = macroOpposing?.executionPrice ?? opposing?.executionPrice ?? fallbackTarget;
  const target = rawTarget * (operationalDirection === 'LONG' ? 0.9985 : 1.0015);
  const deepest = entries[entries.length - 1].price;
  const invalidationDistance = Math.max(input.spot * profile.invalidationMinimum, frameAtr * 0.45);
  const invalidation = deepest + (operationalDirection === 'LONG' ? -invalidationDistance : invalidationDistance);
  const reward = Math.abs(target - finalAverage);
  const risk = Math.abs(finalAverage - invalidation);
  const breakevenReboundPct = Math.abs(finalAverage - deepest) / deepest * 100;
  const targetReboundPct = Math.abs(target - deepest) / deepest * 100;
  const oiChange = input.openInterestChangePct;
  const funding = input.fundingRate;
  let derivativeLabel = 'Neutral';
  let derivativeExplanation = 'No hay una señal extrema de apalancamiento en los datos públicos disponibles.';
  if (funding !== null && Math.abs(funding) > 0.0005) {
    derivativeLabel = funding > 0 ? 'Longs cargados' : 'Shorts cargados';
    derivativeExplanation = funding > 0
      ? 'En simple: mantener posiciones long cuesta más de lo normal. Si el precio cae, aumenta el riesgo de una limpieza de compradores apalancados.'
      : 'En simple: mantener shorts cuesta más de lo normal. Una suba rápida puede forzar cierres y alimentar un short squeeze.';
  } else if (oiChange !== null && Math.abs(oiChange) > 2) {
    derivativeLabel = oiChange > 0 ? 'Apalancamiento creciendo' : 'Desapalancamiento';
    derivativeExplanation = oiChange > 0
      ? 'En simple: están entrando nuevas posiciones apalancadas, pero el funding todavía no muestra euforia. Conviene vigilar una expansión de volatilidad.'
      : 'En simple: se están cerrando posiciones. Hay menos combustible apalancado y la señal de derivados pesa menos.';
  }
  const executionCandles = input.candles[input.executionTimeframe] || input.candles['1h'];
  const volumeAnalytics = buildVolumeAnalytics(executionCandles, input.spot);
  const structure = ['15m', '1h', '4h', '1d'].map((timeframe) => analyzeStructure(timeframe, input.candles[timeframe] || []));
  const recentRanges = executionCandles.slice(-20).map((candle) => candle.high - candle.low);
  const priorRanges = executionCandles.slice(-40, -20).map((candle) => candle.high - candle.low);
  const recentRangeAverage = recentRanges.reduce((sum, value) => sum + value, 0) / Math.max(recentRanges.length, 1);
  const priorRangeAverage = priorRanges.reduce((sum, value) => sum + value, 0) / Math.max(priorRanges.length, 1);
  const rangeRatio = recentRangeAverage / Math.max(priorRangeAverage, 1e-9);
  const bollingerWidthPct = (executionFrame.bollingerUpper - executionFrame.bollingerLower) / Math.max(executionFrame.bollingerMiddle, 1) * 100;
  const atrPercent = frameAtr / input.spot * 100;
  const volatilityBaseline = { '15m': 0.35, '1h': 1, '4h': 2.5, '1d': 5 }[input.executionTimeframe] || 1;
  const volatility: 'BAJA' | 'NORMAL' | 'ALTA' = atrPercent > volatilityBaseline * 1.35 || rangeRatio > 1.35 ? 'ALTA' : atrPercent < volatilityBaseline * 0.65 || rangeRatio < 0.72 ? 'BAJA' : 'NORMAL';
  const directionalSeparation = Math.abs(executionFrame.ema10 - executionFrame.ema55) > frameAtr * 0.45;
  const regimeLabel = rangeRatio > 1.35 ? 'Expansión volátil' : rangeRatio < 0.72 ? 'Compresión' : directionalSeparation && executionFrame.trend !== 'NEUTRAL' ? `Tendencia ${executionFrame.trend === 'LONG' ? 'alcista' : 'bajista'}` : 'Rango / transición';
  const regimeExplanation = rangeRatio > 1.35 ? 'El rango reciente creció frente a las 20 velas anteriores; aumenta el riesgo de recorridos rápidos.'
    : rangeRatio < 0.72 ? 'El rango se contrajo; conviene esperar ruptura y confirmación antes de perseguir precio.'
      : directionalSeparation ? 'Las medias muestran separación suficiente para tratar el movimiento como tendencia.'
        : 'Las medias y el rango no muestran una ventaja direccional limpia.';

  const asset4h = input.candles['4h'] || [];
  const btcReturns = input.btcCandles.slice(-61).slice(1).map((candle, index) => (candle.close - input.btcCandles.slice(-61)[index].close) / input.btcCandles.slice(-61)[index].close);
  const assetSlice = asset4h.slice(-61);
  const assetReturns = assetSlice.slice(1).map((candle, index) => (candle.close - assetSlice[index].close) / assetSlice[index].close);
  const btcMove = candleReturn(input.btcCandles, 6);
  const assetMove = candleReturn(asset4h, 6);
  const btcTrend: Direction = btcMove > 0.6 ? 'LONG' : btcMove < -0.6 ? 'SHORT' : 'NEUTRAL';
  const relativeStrengthPct = input.symbol === 'BTCUSDT' ? 0 : assetMove - btcMove;
  const assetBtcCorrelation = input.symbol === 'BTCUSDT' ? 1 : correlation(assetReturns, btcReturns);
  const contextAligned = btcTrend === operationalDirection || btcTrend === 'NEUTRAL';
  const marketContextLabel = input.symbol === 'BTCUSDT' ? 'Activo guía' : contextAligned ? 'Contexto favorable' : 'Contexto adverso';
  const marketContextExplanation = input.symbol === 'BTCUSDT' ? 'BTC funciona como referencia principal del régimen general.'
    : `${btcTrend === 'LONG' ? 'BTC acompaña al alza' : btcTrend === 'SHORT' ? 'BTC presiona a la baja' : 'BTC está lateral'}; el activo rinde ${relativeStrengthPct >= 0 ? 'mejor' : 'peor'} que BTC por ${Math.abs(relativeStrengthPct).toFixed(2)} puntos en las últimas 24h.`;
  const crossAvailable = input.bybitPrice !== null && input.bybitBookImbalancePct !== null;
  const priceSpreadPct = input.bybitPrice ? (input.spot - input.bybitPrice) / input.bybitPrice * 100 : null;
  const exchangeFlowAligned = input.bybitBookImbalancePct === null || Math.sign(input.binanceBookImbalancePct) === Math.sign(input.bybitBookImbalancePct) || Math.abs(input.bybitBookImbalancePct) < 5;
  const crossLabel = !crossAvailable ? 'Cobertura solo Binance' : exchangeFlowAligned ? 'Mercados alineados' : 'Divergencia entre exchanges';
  const crossExplanation = !crossAvailable ? 'Bybit no ofreció una respuesta compatible para este par; el análisis continúa con Binance.'
    : `Binance muestra ${input.binanceBookImbalancePct >= 0 ? 'más demanda' : 'más oferta'} y Bybit ${input.bybitBookImbalancePct! >= 0 ? 'más demanda' : 'más oferta'} en el tramo visible. Diferencia de precio ${Math.abs(priceSpreadPct || 0).toFixed(3)}%.`;

  const priceChangeComparablePct = candleReturn(input.candles['15m'] || [], 10);
  const priceUp = priceChangeComparablePct > 0.15;
  const priceDown = priceChangeComparablePct < -0.15;
  const oiUp = oiChange !== null && oiChange > 0.2;
  const oiDown = oiChange !== null && oiChange < -0.2;
  const priceOiMatrix = oiChange === null ? 'OI no disponible para construir la matriz.'
    : priceUp && oiUp ? 'Precio ↑ + OI ↑: entran posiciones nuevas; continuidad con más apalancamiento.'
      : priceUp && oiDown ? 'Precio ↑ + OI ↓: cierre de shorts; la suba puede perder combustible.'
        : priceDown && oiUp ? 'Precio ↓ + OI ↑: entran shorts nuevos; aumenta la presión bajista.'
          : priceDown && oiDown ? 'Precio ↓ + OI ↓: cierre o liquidación de longs; desapalancamiento.'
            : 'Precio y OI sin cambio suficiente: lectura equilibrada.';

  const horizon = { '15m': '2–6 horas', '1h': '8–24 horas', '4h': '2–7 días', '1d': '1–4 semanas' }[input.executionTimeframe] || '8–24 horas';
  const rangeMultiplier = { '15m': 1.8, '1h': 2.5, '4h': 3.5, '1d': 5 }[input.executionTimeframe] || 2.5;
  const expectedLow = input.spot - frameAtr * rangeMultiplier;
  const expectedHigh = input.spot + frameAtr * rangeMultiplier;
  const activeStructure = structure.find((item) => item.timeframe === input.executionTimeframe)!;
  const structureAligned = operationalDirection === 'LONG' ? ['BOS_ALCISTA', 'SECUENCIA_ALCISTA'].includes(activeStructure.state) : ['BOS_BAJISTA', 'SECUENCIA_BAJISTA'].includes(activeStructure.state);
  const flowAligned = operationalDirection === 'LONG' ? input.orderFlow.deltaPct > 3 : input.orderFlow.deltaPct < -3;
  const mainProbability = Math.max(35, Math.min(58, Math.round(probability * 0.55 + (structureAligned ? 6 : 0))));
  let directProbability = Math.max(15, Math.min(32, Math.round(probability * 0.28 + (regimeLabel.startsWith('Tendencia') ? 5 : 0) + (flowAligned ? 4 : 0))));
  if (mainProbability + directProbability > 88) directProbability = 88 - mainProbability;
  const invalidationProbability = 100 - mainProbability - directProbability;
  const mainPath = operationalDirection === 'LONG'
    ? `Retroceso hacia ${round(entries[0].zoneLow, 2)}–${round(entries[0].zoneHigh, 2)} y recuperación hacia ${round(target, 2)}.`
    : `Rebote hacia ${round(entries[0].zoneLow, 2)}–${round(entries[0].zoneHigh, 2)} y rechazo hacia ${round(target, 2)}.`;
  const directPath = operationalDirection === 'LONG' ? `Continuación sin entrada profunda hacia ${round(target, 2)}.` : `Caída directa sin entrada profunda hacia ${round(target, 2)}.`;
  const riskReward = risk ? reward / risk : 0;
  const actionable = direction !== 'NEUTRAL' && probability >= 58 && riskReward >= 1.2 && (contextAligned || input.symbol === 'BTCUSDT');
  const actionMessage = actionable ? 'Plan habilitado: la dirección, el contexto y el R:R superan los mínimos del modelo.'
    : riskReward < 1.2 ? `Esperar: R:R ${riskReward.toFixed(2)} inferior al mínimo 1,20.`
      : !contextAligned ? 'Esperar: BTC contradice el sesgo del activo.'
        : 'Esperar confirmación: la ventaja direccional todavía es insuficiente.';
  const firstEntry = entries[0];
  const insideFirstZone = input.spot >= firstEntry.zoneLow && input.spot <= firstEntry.zoneHigh;
  const lastExecutionCandle = executionCandles.at(-1);
  const reactionAligned = lastExecutionCandle ? (operationalDirection === 'LONG' ? lastExecutionCandle.close >= lastExecutionCandle.open : lastExecutionCandle.close <= lastExecutionCandle.open) : false;
  const supportingWall = bookCandidates.some((cluster) => cluster.strength >= 1.5 && Math.abs(cluster.executionPrice - firstEntry.price) / input.spot <= 0.005);
  const confirmationChecks = [
    { label: 'Precio en E1', passed: insideFirstZone, explanation: insideFirstZone ? 'El precio está dentro de la primera zona operativa.' : 'La entrada todavía no fue alcanzada.' },
    { label: 'Order flow', passed: flowAligned, explanation: flowAligned ? 'El flujo agresor acompaña la dirección.' : 'El flujo agresor todavía no confirma.' },
    { label: 'Estructura', passed: structureAligned, explanation: structureAligned ? 'La estructura del marco acompaña.' : 'La estructura aún no acompaña la ejecución.' },
    { label: 'Reacción de vela', passed: reactionAligned, explanation: reactionAligned ? 'La última vela reacciona en la dirección prevista.' : 'La última vela no confirma reacción.' },
    { label: 'Muro visible', passed: supportingWall, explanation: supportingWall ? 'Hay liquidez visible próxima a E1.' : 'No hay un muro visible fuerte junto a E1.' },
    { label: 'Contexto BTC', passed: contextAligned || input.symbol === 'BTCUSDT', explanation: contextAligned || input.symbol === 'BTCUSDT' ? 'BTC no contradice el plan.' : 'BTC contradice el plan.' },
  ];
  const confirmationScore = confirmationChecks.filter((check) => check.passed).length;
  const confirmationStatus = !insideFirstZone ? 'FUERA_DE_ZONA' as const : confirmationScore >= 4 ? 'CONFIRMADA' as const : 'DEBIL' as const;
  const confirmationExplanation = confirmationStatus === 'FUERA_DE_ZONA' ? 'Esperar: la confirmación se evalúa cuando el precio ingresa en E1.'
    : confirmationStatus === 'CONFIRMADA' ? 'La entrada está en zona y reúne al menos cuatro confirmaciones.'
      : 'El precio llegó a E1, pero faltan confirmaciones; no anticipar la compra.';
  const validityMs = { '15m': 6, '1h': 24, '4h': 24 * 7, '1d': 24 * 28 }[input.executionTimeframe] || 24;
  const validUntil = new Date(Date.now() + validityMs * 60 * 60 * 1000).toISOString();
  const historicalValidation = validateHistoricalSignals(executionCandles);
  const aligned = input.timeframes.filter((frame) => frame.trend === operationalDirection).length;
  return {
    symbol: input.symbol,
    executionTimeframe: input.executionTimeframe,
    timestamp: new Date().toISOString(),
    spotPrice: input.spot,
    priceChangePct: input.priceChangePct,
    direction,
    probability,
    directionSummary: direction === 'NEUTRAL'
      ? `No hay ventaja suficiente para ejecutar ahora. El plan queda preparado hacia ${operationalDirection}, pero requiere confirmación.`
      : `${aligned} de 4 marcos acompañan el sesgo ${direction === 'LONG' ? 'alcista' : 'bajista'}; el order flow ${input.orderFlow.deltaPct >= 0 ? 'aporta demanda' : 'aporta oferta'}.`,
    orderFlow: { ...input.orderFlow, label: input.orderFlow.deltaPct > 5 ? 'Comprador' : input.orderFlow.deltaPct < -5 ? 'Vendedor' : 'Equilibrado' },
    derivatives: { openInterest: input.openInterest, openInterestChangePct: oiChange, fundingRate: funding, basisPct: input.basisPct, futuresBookImbalancePct: input.futuresBookImbalancePct, priceChangeComparablePct, priceOiMatrix, label: derivativeLabel, explanation: derivativeExplanation },
    regime: { label: regimeLabel, volatility, atrPct: atrPercent, bollingerWidthPct, explanation: regimeExplanation },
    structure,
    volumeAnalytics,
    marketContext: { btcTrend, correlation: assetBtcCorrelation, relativeStrengthPct, label: marketContextLabel, explanation: marketContextExplanation },
    crossExchange: { available: crossAvailable, bybitPrice: input.bybitPrice, priceSpreadPct, binanceImbalancePct: input.binanceBookImbalancePct, bybitImbalancePct: input.bybitBookImbalancePct, label: crossLabel, explanation: crossExplanation },
    sourceHealth: input.sourceHealth,
    forecast: {
      horizon,
      expectedLow,
      expectedHigh,
      actionable,
      actionMessage,
      scenarios: [
        { name: 'Escenario principal', probability: mainProbability, trigger: `El precio respeta la zona ${entries[0].name} y recupera su precio exacto.`, path: mainPath },
        { name: 'Continuación directa', probability: directProbability, trigger: `El precio confirma ruptura con order flow ${flowAligned ? 'alineado' : 'en aumento'}.`, path: directPath },
        { name: 'Invalidación', probability: invalidationProbability, trigger: `Cierre del marco por ${operationalDirection === 'LONG' ? 'debajo' : 'encima'} de ${round(invalidation, 2)}.`, path: 'Cancelar entradas pendientes y recalcular; la hipótesis actual deja de ser válida.' },
      ],
      calibration: 'Probabilidades relativas del modelo; todavía no están calibradas con un historial suficiente de operaciones cerradas.',
    },
    validUntil,
    confirmation: { status: confirmationStatus, score: confirmationScore, checks: confirmationChecks, explanation: confirmationExplanation },
    historicalValidation,
    timeframes: input.timeframes,
    candles: input.candles,
    // El motor analiza todos los buckets; la respuesta conserva un ranking amplio
    // por lado para la UI sin transportar miles de filas innecesarias.
    clusters: [
      ...input.clusters.filter((cluster) => cluster.side === 'bid').slice(0, 60),
      ...input.clusters.filter((cluster) => cluster.side === 'ask').slice(0, 60),
    ],
    orderBookCoverage: input.orderBookCoverage,
    macroLiquidityZones: input.macroLiquidityZones,
    liquidationZones: estimatedLiquidations,
    entries,
    target,
    invalidation,
    breakevenReboundPct,
    targetReboundPct,
    riskReward,
    capital: input.capital,
    limitations: [
      'El order book muestra órdenes visibles que pueden cancelarse; no garantiza ejecución ni permanencia.',
      'Las zonas de liquidación son estimaciones teóricas por apalancamiento, no posiciones reales de usuarios.',
      'Open interest y funding provienen de futuros USD-M; pueden no estar disponibles para todos los símbolos.',
      'Este plan es una ayuda analítica, no una recomendación financiera ni una orden automática.',
    ],
  };
}
