export const last = (values: number[]) => values[values.length - 1] ?? 0;

export function ema(values: number[], period: number): number[] {
  if (!values.length) return [];
  const k = 2 / (period + 1);
  const result = [values[0]];
  for (let i = 1; i < values.length; i++) result.push(values[i] * k + result[i - 1] * (1 - k));
  return result;
}

export function rsi(values: number[], period = 14): number {
  if (values.length <= period) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    if (change >= 0) gains += change; else losses -= change;
  }
  if (gains === 0 && losses === 0) return 50;
  if (losses === 0) return 100;
  return 100 - 100 / (1 + gains / losses);
}

export function macd(values: number[]) {
  const fast = ema(values, 12);
  const slow = ema(values, 26);
  const line = values.map((_, i) => (fast[i] ?? 0) - (slow[i] ?? 0));
  const signal = ema(line, 9);
  return { value: last(line), signal: last(signal) };
}

export function bollinger(values: number[], period = 20, multiplier = 2) {
  const slice = values.slice(-period);
  const middle = slice.reduce((sum, value) => sum + value, 0) / Math.max(slice.length, 1);
  const variance = slice.reduce((sum, value) => sum + Math.pow(value - middle, 2), 0) / Math.max(slice.length, 1);
  const deviation = Math.sqrt(variance);
  return { upper: middle + deviation * multiplier, middle, lower: middle - deviation * multiplier };
}

export function atr(candles: number[][], period = 14): number {
  const recent = candles.slice(-(period + 1));
  const ranges = recent.slice(1).map((candle, index) => {
    const previousClose = recent[index][4];
    return Math.max(candle[2] - candle[3], Math.abs(candle[2] - previousClose), Math.abs(candle[3] - previousClose));
  });
  return ranges.reduce((sum, value) => sum + value, 0) / Math.max(ranges.length, 1);
}
