export type Direction = 'LONG' | 'SHORT' | 'NEUTRAL';

export interface TimeframeAnalysis {
  timeframe: string;
  close: number;
  ema10: number;
  ema55: number;
  ema200: number;
  rsi: number;
  macd: number;
  macdSignal: number;
  bollingerUpper: number;
  bollingerMiddle: number;
  bollingerLower: number;
  atr: number;
  trend: Direction;
  score: number;
}

export interface LiquidityCluster {
  side: 'bid' | 'ask';
  low: number;
  high: number;
  executionPrice: number;
  notional: number;
  strength: number;
  distancePct: number;
}

export interface MacroLiquidityZone {
  side: 'below' | 'above';
  low: number;
  high: number;
  executionPrice: number;
  score: number;
  distancePct: number;
  timeframe: '4h' | '1d';
  touchCount: number;
  approximateNotional: number;
}

export interface EntryLevel {
  name: 'E1' | 'E2' | 'E3';
  price: number;
  zoneLow: number;
  zoneHigh: number;
  confidence: number;
  confirmations: number;
  evidence: string[];
  allocationPct: number;
  allocationValue: number;
  averageAfter: number;
  reason: string;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketStructure {
  timeframe: string;
  state: 'BOS_ALCISTA' | 'BOS_BAJISTA' | 'SECUENCIA_ALCISTA' | 'SECUENCIA_BAJISTA' | 'RANGO';
  swingHigh: number;
  swingLow: number;
  explanation: string;
}

export interface VolumeAnalytics {
  poc: number;
  valueAreaHigh: number;
  valueAreaLow: number;
  vwap: number;
  anchoredVwap: number;
  position: 'SOBRE_VALOR' | 'EN_VALOR' | 'BAJO_VALOR';
}

export interface ForecastScenario {
  name: string;
  probability: number;
  trigger: string;
  path: string;
}

export interface HistoricalValidation {
  sampleSize: number;
  wins: number;
  losses: number;
  expired: number;
  winRatePct: number;
  expectancyR: number;
  profitFactor: number;
  maxDrawdownR: number;
  baselineWinRatePct: number;
  baselineExpectancyR: number;
  improvementR: number;
  label: string;
  methodology: string;
}

export interface AnalysisResult {
  symbol: string;
  executionTimeframe: string;
  timestamp: string;
  spotPrice: number;
  priceChangePct: number;
  direction: Direction;
  probability: number;
  directionSummary: string;
  orderFlow: { deltaPct: number; buyNotional: number; sellNotional: number; label: string };
  derivatives: { openInterest: number | null; openInterestChangePct: number | null; fundingRate: number | null; basisPct: number | null; futuresBookImbalancePct: number | null; priceChangeComparablePct: number; priceOiMatrix: string; label: string; explanation: string };
  regime: { label: string; volatility: 'BAJA' | 'NORMAL' | 'ALTA'; atrPct: number; bollingerWidthPct: number; explanation: string };
  structure: MarketStructure[];
  volumeAnalytics: VolumeAnalytics;
  marketContext: { btcTrend: Direction; correlation: number; relativeStrengthPct: number; label: string; explanation: string };
  crossExchange: { available: boolean; bybitPrice: number | null; priceSpreadPct: number | null; binanceImbalancePct: number; bybitImbalancePct: number | null; label: string; explanation: string };
  sourceHealth: { generatedAt: string; totalLatencyMs: number; spot: 'OK' | 'ERROR'; derivatives: 'OK' | 'PARCIAL' | 'NO_DISPONIBLE'; bybit: 'OK' | 'NO_DISPONIBLE'; warnings: string[] };
  forecast: {
    horizon: string;
    expectedLow: number;
    expectedHigh: number;
    actionable: boolean;
    actionMessage: string;
    scenarios: ForecastScenario[];
    calibration: string;
  };
  validUntil: string;
  confirmation: {
    status: 'FUERA_DE_ZONA' | 'CONFIRMADA' | 'DEBIL';
    score: number;
    checks: Array<{ label: string; passed: boolean; explanation: string }>;
    explanation: string;
  };
  historicalValidation: HistoricalValidation;
  timeframes: TimeframeAnalysis[];
  candles: Record<string, Candle[]>;
  clusters: LiquidityCluster[];
  orderBookCoverage: {
    bidLevels: number;
    askLevels: number;
    lowestBid: number;
    highestAsk: number;
    bidDistancePct: number;
    askDistancePct: number;
  };
  macroLiquidityZones: MacroLiquidityZone[];
  liquidationZones: Array<{ side: 'long' | 'short'; leverage: number; price: number; weight: number }>;
  entries: EntryLevel[];
  target: number;
  invalidation: number;
  breakevenReboundPct: number;
  targetReboundPct: number;
  riskReward: number;
  capital: number;
  limitations: string[];
}
