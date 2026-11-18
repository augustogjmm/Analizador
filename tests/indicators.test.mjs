import test from 'node:test';
import assert from 'node:assert/strict';
import { last, ema, rsi, macd, bollinger, atr } from '../lib/indicators.ts';

test('last returns the final value or zero', () => {
  assert.equal(last([1, 2, 3]), 3);
  assert.equal(last([]), 0);
});

test('EMA stays stable for constant prices', () => {
  assert.deepEqual(ema([100, 100, 100, 100], 10), [100, 100, 100, 100]);
  assert.deepEqual(ema([], 10), []);
});

test('RSI treats insufficient data as neutral', () => {
  assert.equal(rsi(Array(14).fill(100), 14), 50);
});

test('RSI reaches 100 on uninterrupted gains and 0 on losses', () => {
  assert.equal(rsi(Array.from({ length: 16 }, (_, i) => i + 100)), 100);
  assert.equal(rsi(Array.from({ length: 16 }, (_, i) => 100 - i)), 0);
});

test('RSI is neutral for a flat market', () => {
  assert.equal(rsi(Array(16).fill(100)), 50);
});

test('MACD is zero for constant prices', () => {
  assert.deepEqual(macd(Array(35).fill(100)), { value: 0, signal: 0 });
});

test('Bollinger bands coincide with a constant price', () => {
  assert.deepEqual(bollinger(Array(20).fill(200)), { upper: 200, middle: 200, lower: 200 });
});

test('ATR includes true range when price gaps from prior close', () => {
  const candles = [[0, 100, 101, 99, 100], [1, 110, 112, 108, 111]];
  assert.equal(atr(candles), 12);
});
