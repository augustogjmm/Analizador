'use client';

import { useEffect, useRef, useState } from 'react';
import type { AnalysisResult, Candle } from '../../lib/types';
import { ema } from '../../lib/indicators';

interface TradeChartProps {
  data: AnalysisResult;
  timeframe: string;
  showOverlays?: boolean;
}

const formatPrice = (value: number) => new Intl.NumberFormat('es-AR', { maximumFractionDigits: value < 10 ? 4 : 2 }).format(value);
const formatPercent = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(1).replace('.', ',')}%`;

export default function TradeChart({ data, timeframe, showOverlays = true }: TradeChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const geometryRef = useRef<{ candleArea: number; candles: Candle[] } | null>(null);
  const [hover, setHover] = useState<{ candle: Candle; x: number; y: number; width: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const draw = () => {
      const width = container.clientWidth;
      const allCandles = data.candles[timeframe] || [];
      const candles = width < 650 ? allCandles.slice(-60) : allCandles;
      if (!candles.length) return;
      const height = 460;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(ratio, ratio);
      ctx.clearRect(0, 0, width, height);

      const top = 22;
      const bottom = 38;
      const compact = width < 650;
      const right = compact ? 70 : 92;
      const plotHeight = height - top - bottom;
      const plotWidth = width - right;
      const levelFont = compact ? '600 10px ui-monospace, SFMono-Regular, Consolas, monospace' : '600 12px ui-monospace, SFMono-Regular, Consolas, monospace';
      const finalAverage = data.entries.at(-1)?.averageAfter || data.spotPrice;
      const isLongPlan = data.target >= finalAverage;
      const resultFromAverage = (price: number) => isLongPlan
        ? (price - finalAverage) / finalAverage * 100
        : (finalAverage - price) / finalAverage * 100;
      const movementFromSpot = (price: number) => (price - data.spotPrice) / data.spotPrice * 100;
      const levelSpecs = [
        { price: data.target, label: 'TP', detail: compact ? `S ${formatPercent(movementFromSpot(data.target))} · P ${formatPercent(resultFromAverage(data.target))}` : `spot ${formatPercent(movementFromSpot(data.target))} · profit ${formatPercent(resultFromAverage(data.target))}`, color: '#44d6a1', dashed: false },
        { price: data.spotPrice, label: 'SPOT', detail: 'spot +0,0%', color: '#dce5f2', dashed: true },
        ...data.entries.map((entry, index) => ({ price: entry.price, label: entry.name, detail: `spot ${formatPercent(movementFromSpot(entry.price))}`, color: ['#a88cff', '#70a8ff', '#f6b85c'][index], dashed: false })),
        { price: data.invalidation, label: compact ? 'INV.' : 'INVALIDACIÓN', detail: compact ? `S ${formatPercent(movementFromSpot(data.invalidation))} · R ${formatPercent(resultFromAverage(data.invalidation))}` : `spot ${formatPercent(movementFromSpot(data.invalidation))} · riesgo ${formatPercent(resultFromAverage(data.invalidation))}`, color: '#ff6574', dashed: false },
      ];
      ctx.font = levelFont;
      const labelLaneWidth = Math.max(115, Math.min(compact ? 190 : 285, Math.max(...levelSpecs.map((level) => ctx.measureText(`${level.label} ${formatPrice(level.price)} · ${level.detail}`).width + 16))));
      const labelX = Math.max(88, plotWidth - labelLaneWidth);
      const pathRight = labelX - 12;
      const candleArea = Math.max(72, pathRight * 0.79);
      geometryRef.current = { candleArea, candles };
      const levels = [...data.entries.flatMap((entry) => [entry.zoneLow, entry.price, entry.zoneHigh]), data.target, data.invalidation, data.spotPrice];
      const lows = candles.map((candle) => candle.low).concat(levels);
      const highs = candles.map((candle) => candle.high).concat(levels);
      const minRaw = Math.min(...lows);
      const maxRaw = Math.max(...highs);
      const padding = Math.max((maxRaw - minRaw) * 0.07, data.spotPrice * 0.002);
      const min = minRaw - padding;
      const max = maxRaw + padding;
      const y = (price: number) => top + (max - price) / (max - min) * plotHeight;
      const x = (index: number) => 8 + index / Math.max(candles.length - 1, 1) * (candleArea - 16);

      ctx.font = `${compact ? 10 : 12}px ui-monospace, SFMono-Regular, Consolas, monospace`;
      ctx.lineWidth = 1;
      for (let i = 0; i <= 5; i++) {
        const price = max - (max - min) * i / 5;
        const py = y(price);
        ctx.strokeStyle = 'rgba(148, 163, 184, .12)';
        ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(plotWidth, py); ctx.stroke();
        ctx.fillStyle = '#7f8ba3';
        ctx.fillText(formatPrice(price), plotWidth + 9, py + 4);
      }

      const zoneColors = ['#a88cff', '#70a8ff', '#f6b85c'];
      data.entries.forEach((entry, index) => {
        const zoneTop = y(entry.zoneHigh);
        const zoneBottom = y(entry.zoneLow);
        ctx.save();
        ctx.globalAlpha = 0.12;
        ctx.fillStyle = zoneColors[index] || '#a88cff';
        ctx.fillRect(0, zoneTop, labelX - 8, Math.max(2, zoneBottom - zoneTop));
        ctx.globalAlpha = 0.34;
        ctx.strokeStyle = zoneColors[index] || '#a88cff';
        ctx.setLineDash([3, 4]);
        ctx.strokeRect(0, zoneTop, labelX - 8, Math.max(2, zoneBottom - zoneTop));
        ctx.restore();
      });

      const candleStep = Math.max(2.2, candleArea / candles.length);
      const bodyWidth = Math.max(1.5, Math.min(7, candleStep * 0.62));
      candles.forEach((candle, index) => {
        const cx = x(index);
        const rising = candle.close >= candle.open;
        const color = rising ? '#28c890' : '#ff6574';
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.moveTo(cx, y(candle.high)); ctx.lineTo(cx, y(candle.low)); ctx.stroke();
        const bodyTop = y(Math.max(candle.open, candle.close));
        const bodyHeight = Math.max(1.2, Math.abs(y(candle.open) - y(candle.close)));
        ctx.fillRect(cx - bodyWidth / 2, bodyTop, bodyWidth, bodyHeight);
      });

      if (showOverlays) {
        const closes = candles.map((candle) => candle.close);
        const drawSeries = (values: number[], color: string) => {
          ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 1.4; ctx.globalAlpha = 0.88; ctx.beginPath();
          values.forEach((value, index) => index ? ctx.lineTo(x(index), y(value)) : ctx.moveTo(x(index), y(value)));
          ctx.stroke(); ctx.restore();
        };
        drawSeries(ema(closes, 10), '#f6b85c');
        drawSeries(ema(closes, 55), '#70a8ff');
        drawSeries(ema(closes, 200), '#d06cff');
        [
          { price: data.volumeAnalytics.poc, color: '#35d29d' },
          { price: data.volumeAnalytics.vwap, color: '#cfd7e5' },
          { price: data.volumeAnalytics.valueAreaHigh, color: '#54718f' },
          { price: data.volumeAnalytics.valueAreaLow, color: '#54718f' },
        ].forEach((level) => {
          if (level.price < min || level.price > max) return;
          ctx.save(); ctx.strokeStyle = level.color; ctx.globalAlpha = 0.55; ctx.setLineDash([2, 4]); ctx.beginPath(); ctx.moveTo(0, y(level.price)); ctx.lineTo(candleArea, y(level.price)); ctx.stroke(); ctx.restore();
        });
      }

      const labels = levelSpecs
        .map((level) => ({ ...level, actualY: y(level.price), labelY: y(level.price) }))
        .sort((a, b) => a.labelY - b.labelY);
      const minimumLabelY = top + 10;
      const maximumLabelY = height - bottom - 10;
      const labelGap = compact ? 21 : 24;
      labels[0].labelY = Math.max(minimumLabelY, labels[0].labelY);
      for (let index = 1; index < labels.length; index++) labels[index].labelY = Math.max(labels[index].labelY, labels[index - 1].labelY + labelGap);
      if (labels.at(-1)!.labelY > maximumLabelY) {
        labels[labels.length - 1].labelY = maximumLabelY;
        for (let index = labels.length - 2; index >= 0; index--) labels[index].labelY = Math.min(labels[index].labelY, labels[index + 1].labelY - labelGap);
      }
      if (labels[0].labelY < minimumLabelY) {
        const shift = minimumLabelY - labels[0].labelY;
        labels.forEach((level) => { level.labelY += shift; });
      }

      const drawLevel = (level: typeof labels[number]) => {
        const { price, label, detail, color, dashed, actualY, labelY } = level;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.setLineDash(dashed ? [5, 5] : []);
        ctx.beginPath(); ctx.moveTo(0, actualY); ctx.lineTo(labelX - 8, actualY); ctx.stroke();
        ctx.setLineDash([]);
        if (Math.abs(labelY - actualY) > 1) {
          ctx.globalAlpha = 0.72;
          ctx.beginPath(); ctx.moveTo(labelX - 8, actualY); ctx.lineTo(labelX, labelY); ctx.stroke();
          ctx.globalAlpha = 1;
        }
        const text = `${label} ${formatPrice(price)} · ${detail}`;
        ctx.font = levelFont;
        const textWidth = ctx.measureText(text).width + 12;
        ctx.fillStyle = color;
        ctx.fillRect(labelX, labelY - 10, Math.min(labelLaneWidth - 4, textWidth), 21);
        ctx.fillStyle = '#071016';
        ctx.fillText(text, labelX + 6, labelY + 4);
        ctx.restore();
      };
      const entryColors = ['#a88cff', '#70a8ff', '#f6b85c'];
      labels.forEach(drawLevel);

      const lastCandle = candles[candles.length - 1];
      const planPoints = [
        { x: candleArea, price: lastCandle.close },
        ...data.entries.map((entry, index) => ({ x: candleArea + (pathRight - candleArea) * (index + 1) / 4.5, price: entry.price })),
        { x: pathRight, price: data.target },
      ];
      ctx.strokeStyle = 'rgba(168, 140, 255, .78)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      planPoints.forEach((point, index) => index ? ctx.lineTo(point.x, y(point.price)) : ctx.moveTo(point.x, y(point.price)));
      ctx.stroke();
      ctx.setLineDash([]);
      planPoints.slice(1).forEach((point, index) => {
        ctx.fillStyle = index === planPoints.length - 2 ? '#44d6a1' : entryColors[index] || '#44d6a1';
        ctx.beginPath(); ctx.arc(point.x, y(point.price), 4, 0, Math.PI * 2); ctx.fill();
      });
      ctx.fillStyle = '#8d99ad';
      ctx.font = '600 11px ui-monospace, SFMono-Regular, Consolas, monospace';
      if (!compact) ctx.fillText('SECUENCIA PLANIFICADA', candleArea + 8, 14);

      if (hover) {
        ctx.strokeStyle = 'rgba(220, 229, 242, .38)';
        ctx.setLineDash([3, 4]);
        ctx.beginPath(); ctx.moveTo(hover.x, top); ctx.lineTo(hover.x, height - bottom); ctx.stroke();
        ctx.setLineDash([]);
      }

      const tickIndexes = compact ? [candles.length - 1] : [0, Math.floor(candles.length / 3), Math.floor(candles.length * 2 / 3), candles.length - 1];
      ctx.fillStyle = '#7f8ba3';
      ctx.font = `${compact ? 9 : 11}px ui-monospace, SFMono-Regular, Consolas, monospace`;
      tickIndexes.forEach((index) => {
        const label = new Date(candles[index].time).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        const labelWidth = ctx.measureText(label).width;
        const labelX = compact
          ? Math.max(4, candleArea - labelWidth)
          : Math.min(candleArea - labelWidth, x(index));
        ctx.fillText(label, labelX, height - 13);
      });
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(container);
    return () => observer.disconnect();
  }, [data, timeframe, hover, showOverlays]);

  const handlePointer = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const geometry = geometryRef.current;
    if (!canvas || !geometry?.candles.length) return;
    const { candles, candleArea } = geometry;
    const bounds = canvas.getBoundingClientRect();
    const localX = event.clientX - bounds.left;
    if (localX < 0 || localX > candleArea) { setHover(null); return; }
    const index = Math.max(0, Math.min(candles.length - 1, Math.round((localX - 8) / Math.max(candleArea - 16, 1) * (candles.length - 1))));
    setHover({ candle: candles[index], x: localX, y: event.clientY - bounds.top, width: bounds.width });
  };

  return (
    <div className="trade-chart" ref={containerRef}>
      <canvas ref={canvasRef} role="img" aria-label={`Gráfico de velas ${timeframe} con entradas, target e invalidación`} onPointerMove={handlePointer} onPointerLeave={() => setHover(null)} />
      {hover && <div className="chart-tooltip" style={{ left: Math.min(hover.x + 14, hover.width - 190), top: Math.max(12, hover.y - 68) }}><b>{new Date(hover.candle.time).toLocaleString('es-AR')}</b><span>O {formatPrice(hover.candle.open)} · H {formatPrice(hover.candle.high)}</span><span>L {formatPrice(hover.candle.low)} · C {formatPrice(hover.candle.close)}</span><span>Vol {new Intl.NumberFormat('es-AR', { notation: 'compact' }).format(hover.candle.volume)}</span></div>}
    </div>
  );
}
