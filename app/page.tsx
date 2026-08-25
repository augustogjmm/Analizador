'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TradeChart from './components/TradeChart';
import type { AnalysisResult, LiquidityCluster } from '../lib/types';

const defaultSymbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'LINKUSDT'];
const frames = ['15m', '1h', '4h', '1d'];
const nf = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat('es-AR', { notation: 'compact', maximumFractionDigits: 2 });
const money = (value: number) => `$${nf.format(value)}`;
const pct = (value: number, digits = 2) => `${value >= 0 ? '+' : ''}${value.toFixed(digits).replace('.', ',')}%`;
const directionText = { LONG: 'Sesgo alcista', SHORT: 'Sesgo bajista', NEUTRAL: 'Sin ventaja clara' };
const trendText = { LONG: 'Alcista', SHORT: 'Bajista', NEUTRAL: 'Mixta' };
const structureText = { BOS_ALCISTA: 'BOS alcista', BOS_BAJISTA: 'BOS bajista', SECUENCIA_ALCISTA: 'Secuencia alcista', SECUENCIA_BAJISTA: 'Secuencia bajista', RANGO: 'Rango' };

interface SavedWall { key: string; timestamp: string; notional?: number }
interface RiskSettings { riskPct: number; feePct: number; slippagePct: number; leverage: number; dailyLossPct: number }
type PlanStatus = 'ESPERANDO' | 'E1_ACTIVA' | 'E2_ACTIVA' | 'E3_ACTIVA' | 'TP' | 'INVALIDADO' | 'VENCIDO';
interface TrackedPlan {
  id: string; symbol: string; timeframe: string; direction: 'LONG' | 'SHORT'; probability: number; createdAt: string; validUntil: string; status: PlanStatus;
  entries: AnalysisResult['entries']; target: number; invalidation: number; activatedEntries: number; lastPrice: number; capital: number;
  closedAt?: string; resultPct?: number; resultUSDT?: number;
}
interface AlertItem { id: string; timestamp: string; title: string; detail: string; tone: 'info' | 'success' | 'danger' }
interface ScannerRow { symbol: string; direction: 'LONG' | 'SHORT' | 'NEUTRAL'; score: number; price: number; priceChangePct: number; quoteVolume: number; rsi: number; atrPct: number }
interface HistoryStatus { available: boolean; snapshots: number; firstAt: string | null; lastAt: string | null }
interface LiveFeed { status: 'CONECTANDO' | 'LIVE' | 'RECONECTANDO' | 'ERROR'; price: number | null; bid: number | null; ask: number | null; bookImbalancePct: number; flowDeltaPct: number; lastMessageAt: number | null }
interface LabResult {
  available: boolean; symbol: string; timeframe: string; snapshots: number; pending: number; evaluated: number; notActivated: number; resolved: number; wins: number; invalidations: number; expired: number; winRatePct: number; brierScore: number; logLoss: number; expectedCalibrationErrorPct: number; expectancyR: number; averageMfePct: number; averageMaePct: number; averageResolutionMinutes: number; trainWinRatePct: number; outOfSampleWinRatePct: number; outOfSampleCount: number; recentWinRatePct: number; priorWinRatePct: number; driftPct: number; status: string; recommendation: string; progressPct: number; targets: { initial: number; calibration: number; professional: number; definitive: number }; bins: Array<{ label: string; count: number; predictedPct: number; observedPct: number; errorPct: number }>; byRegime: Array<{ regime: string; count: number; winRatePct: number; expectancyR: number }>;
}
const wallKey = (cluster: LiquidityCluster, spot: number) => `${cluster.side}:${Math.round(cluster.executionPrice / (spot * 0.0025))}`;
const readLocal = <T,>(key: string, fallback: T): T => {
  if (typeof window === 'undefined') return fallback;
  try { return JSON.parse(localStorage.getItem(key) || '') as T; } catch { return fallback; }
};
const defaultRiskSettings: RiskSettings = { riskPct: 1, feePct: 0.1, slippagePct: 0.08, leverage: 1, dailyLossPct: 3 };
const readRiskSettings = () => ({ ...defaultRiskSettings, ...readLocal<Partial<RiskSettings>>('liquidity-lab-risk-v4', {}) });
const planStatusText: Record<PlanStatus, string> = { ESPERANDO: 'Esperando E1', E1_ACTIVA: 'E1 activa', E2_ACTIVA: 'E2 activa', E3_ACTIVA: 'E3 activa', TP: 'Target alcanzado', INVALIDADO: 'Plan invalidado', VENCIDO: 'Plan vencido' };
const persistRecord = async (type: 'snapshot' | 'plan' | 'event', data: Record<string, unknown>) => {
  try { await fetch('/api/history', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, data }) }); } catch { /* La interfaz conserva el fallback local. */ }
};

function ConfidenceGauge({ value, direction, source = 'Estimación del modelo' }: { value: number; direction: AnalysisResult['direction']; source?: string }) {
  const band = value >= 70 ? 'Alta' : value >= 58 ? 'Moderada' : 'Baja';
  return <div className={`confidence ${direction.toLowerCase()}`} role="progressbar" aria-label={`Confianza ${value}%`} aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
    <div className="confidence-ring" style={{ '--confidence': `${value}%` } as React.CSSProperties}><div><strong>{value}</strong><span>%</span><small>CONFIANZA</small></div></div>
    <div className="confidence-band"><span>{band}</span><small>{source}</small></div>
    <div className="confidence-scale"><span>0</span><i /><span>50</span><i /><span>100</span></div>
  </div>;
}

export default function Home() {
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [symbolInput, setSymbolInput] = useState('BTCUSDT');
  const [availableSymbols, setAvailableSymbols] = useState(defaultSymbols);
  const [capital, setCapital] = useState(10000);
  const [allocations, setAllocations] = useState([40, 35, 25]);
  const [draftCapital, setDraftCapital] = useState('10000');
  const [draftAllocations, setDraftAllocations] = useState([40, 35, 25]);
  const [riskSettings, setRiskSettings] = useState<RiskSettings>(readRiskSettings);
  const [draftRisk, setDraftRisk] = useState<RiskSettings>(readRiskSettings);
  const [trackedPlan, setTrackedPlan] = useState<TrackedPlan | null>(() => readLocal<TrackedPlan | null>('liquidity-lab-active-plan-v4', null));
  const [journal, setJournal] = useState<TrackedPlan[]>(() => readLocal<TrackedPlan[]>('liquidity-lab-journal-v4', []));
  const [alerts, setAlerts] = useState<AlertItem[]>(() => readLocal<AlertItem[]>('liquidity-lab-alerts-v4', []));
  const [showOverlays, setShowOverlays] = useState(true);
  const [eventPause, setEventPause] = useState(() => readLocal('liquidity-lab-event-pause-v4', false));
  const [scannerRows, setScannerRows] = useState<ScannerRow[]>([]);
  const [scannerLoading, setScannerLoading] = useState(false);
  const [historyStatus, setHistoryStatus] = useState<HistoryStatus>({ available: false, snapshots: 0, firstAt: null, lastAt: null });
  const [liveFeed, setLiveFeed] = useState<LiveFeed>({ status: 'CONECTANDO', price: null, bid: null, ask: null, bookImbalancePct: 0, flowDeltaPct: 0, lastMessageAt: null });
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(() => typeof Notification === 'undefined' ? 'denied' : Notification.permission);
  const [replayIndex, setReplayIndex] = useState(0);
  const [labResult, setLabResult] = useState<LabResult | null>(null);
  const [labLoading, setLabLoading] = useState(false);
  const labLastLoadedRef = useRef(0);
  const labLastKeyRef = useRef('');
  const [data, setData] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [expanded, setExpanded] = useState<'derivatives' | 'method' | null>(null);
  const [wallHistory, setWallHistory] = useState<SavedWall[]>(() => {
    if (typeof window === 'undefined') return [];
    try { return JSON.parse(localStorage.getItem('liquidity-lab-walls-v2') || '[]'); } catch { return []; }
  });
  const [chartFrame, setChartFrame] = useState('1h');
  const [nextRefresh, setNextRefresh] = useState(30);

  useEffect(() => {
    fetch('/api/symbols').then((response) => response.ok ? response.json() : Promise.reject()).then((result) => {
      const loaded = result.symbols?.map((item: { symbol: string }) => item.symbol);
      if (loaded?.length) setAvailableSymbols(loaded);
    }).catch(() => setAvailableSymbols(defaultSymbols));
  }, []);

  useEffect(() => {
    let socket: WebSocket | null = null; let reconnectTimer = 0; let stopped = false;
    const flow: Array<{ time: number; buy: number; sell: number }> = [];
    const connect = () => {
      const streamSymbol = symbol.toLowerCase();
      socket = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streamSymbol}@bookTicker/${streamSymbol}@aggTrade`);
      socket.onopen = () => setLiveFeed((current) => ({ ...current, status: 'LIVE' }));
      socket.onmessage = (message) => {
        const packet = JSON.parse(String(message.data)) as { stream: string; data: Record<string, string | boolean> };
        const now = Date.now();
        if (packet.stream.endsWith('@bookTicker')) {
          const bid = Number(packet.data.b); const ask = Number(packet.data.a); const bidQty = Number(packet.data.B); const askQty = Number(packet.data.A);
          const imbalance = bidQty + askQty ? (bidQty - askQty) / (bidQty + askQty) * 100 : 0;
          setLiveFeed((current) => ({ ...current, status: 'LIVE', bid, ask, price: (bid + ask) / 2, bookImbalancePct: imbalance, lastMessageAt: now }));
        } else if (packet.stream.endsWith('@aggTrade')) {
          const notional = Number(packet.data.p) * Number(packet.data.q); const sellerAggressor = Boolean(packet.data.m);
          flow.push({ time: now, buy: sellerAggressor ? 0 : notional, sell: sellerAggressor ? notional : 0 });
          while (flow.length && now - flow[0].time > 60_000) flow.shift();
          const buy = flow.reduce((sum, item) => sum + item.buy, 0); const sell = flow.reduce((sum, item) => sum + item.sell, 0);
          const delta = buy + sell ? (buy - sell) / (buy + sell) * 100 : 0;
          setLiveFeed((current) => ({ ...current, status: 'LIVE', price: Number(packet.data.p), flowDeltaPct: delta, lastMessageAt: now }));
        }
      };
      socket.onerror = () => setLiveFeed((current) => ({ ...current, status: 'ERROR' }));
      socket.onclose = () => { if (!stopped) { setLiveFeed((current) => ({ ...current, status: 'RECONECTANDO' })); reconnectTimer = window.setTimeout(connect, 2500); } };
    };
    connect();
    return () => { stopped = true; window.clearTimeout(reconnectTimer); socket?.close(); };
  }, [symbol]);

  const analyze = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/analyze?symbol=${symbol}&capital=${capital}&allocations=${allocations.join(',')}&timeframe=${chartFrame}&_=${Date.now()}`, { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'No se pudo analizar el mercado.');
      setData(result);
      void persistRecord('snapshot', { id: `${result.symbol}-${result.executionTimeframe}-${result.timestamp}`, symbol: result.symbol, timeframe: result.executionTimeframe, timestamp: result.timestamp, spotPrice: result.spotPrice, direction: result.direction, probability: result.probability, target: result.target, invalidation: result.invalidation, riskReward: result.riskReward, regime: result.regime.label, confirmation: result.confirmation.status, orderFlowDelta: result.orderFlow.deltaPct, openInterest: result.derivatives.openInterest, funding: result.derivatives.fundingRate, scenarios: result.forecast.scenarios, entries: result.entries.map((entry: AnalysisResult['entries'][number]) => ({ name: entry.name, price: entry.price, averageAfter: entry.averageAfter })) });
      void fetch(`/api/history?symbol=${result.symbol}`, { cache: 'no-store' }).then((historyResponse) => historyResponse.json()).then((history) => {
        setHistoryStatus({ available: Boolean(history.available), snapshots: Number(history.snapshots || 0), firstAt: history.firstAt || null, lastAt: history.lastAt || null });
        if (Array.isArray(history.plans) && history.plans.length) { setJournal(history.plans); localStorage.setItem('liquidity-lab-journal-v4', JSON.stringify(history.plans)); }
      }).catch(() => undefined);
      const labKey = `${result.symbol}-${result.executionTimeframe}`;
      if (labLastKeyRef.current !== labKey || Date.now() - labLastLoadedRef.current > 300_000) {
        labLastKeyRef.current = labKey; labLastLoadedRef.current = Date.now(); setLabLoading(true);
        void fetch(`/api/lab?symbol=${result.symbol}&timeframe=${result.executionTimeframe}`, { cache: 'no-store' }).then((labResponse) => labResponse.json()).then((lab) => setLabResult(lab)).catch(() => undefined).finally(() => setLabLoading(false));
      }
      setNextRefresh(30);
      setWallHistory((current) => {
        const now = Date.now();
        const fresh = result.clusters.map((cluster: LiquidityCluster) => ({ key: wallKey(cluster, result.spotPrice), timestamp: result.timestamp, notional: cluster.notional }));
        const retained = current.filter((item) => now - new Date(item.timestamp).getTime() < 7 * 24 * 60 * 60 * 1000);
        const updated = [...retained, ...fresh].slice(-1200);
        localStorage.setItem('liquidity-lab-walls-v2', JSON.stringify(updated));
        return updated;
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Error inesperado.');
    } finally { setLoading(false); }
  }, [symbol, capital, allocations, chartFrame]);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => void analyze(), 0);
    const refreshTimer = window.setInterval(() => void analyze(), 30_000);
    return () => { window.clearTimeout(initialTimer); window.clearInterval(refreshTimer); };
  }, [analyze]);

  useEffect(() => {
    const countdown = window.setInterval(() => setNextRefresh((current) => Math.max(0, current - 1)), 1000);
    return () => window.clearInterval(countdown);
  }, []);

  const wallStats = useMemo(() => {
    const grouped = new Map<string, SavedWall[]>();
    for (const item of wallHistory) grouped.set(item.key, [...(grouped.get(item.key) || []), item]);
    const stats = new Map<string, { count: number; changePct: number }>();
    grouped.forEach((items, key) => {
      const ordered = [...items].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      const latest = ordered.at(-1)?.notional || 0;
      const previous = ordered.at(-2)?.notional || latest;
      stats.set(key, { count: ordered.length, changePct: previous ? (latest - previous) / previous * 100 : 0 });
    });
    return stats;
  }, [wallHistory]);

  useEffect(() => {
    if (!data || !trackedPlan || ['TP', 'INVALIDADO', 'VENCIDO'].includes(trackedPlan.status) || data.symbol !== trackedPlan.symbol || data.executionTimeframe !== trackedPlan.timeframe) return;
    const longPlan = trackedPlan.direction === 'LONG';
    const marketPrice = liveFeed.price || data.spotPrice;
    let status = trackedPlan.status;
    let activatedEntries = trackedPlan.activatedEntries;
    let tone: AlertItem['tone'] = 'info';
    let title = '';
    if (new Date(data.timestamp).getTime() >= new Date(trackedPlan.validUntil).getTime()) { status = 'VENCIDO'; title = 'El plan venció sin resolución'; }
    else if (longPlan ? marketPrice <= trackedPlan.invalidation : marketPrice >= trackedPlan.invalidation) { status = 'INVALIDADO'; title = 'Invalidación alcanzada'; tone = 'danger'; }
    else if (activatedEntries > 0 && (longPlan ? marketPrice >= trackedPlan.target : marketPrice <= trackedPlan.target)) { status = 'TP'; title = 'Target alcanzado'; tone = 'success'; }
    else {
      trackedPlan.entries.forEach((entry, index) => {
        if (index >= activatedEntries && (longPlan ? marketPrice <= entry.price : marketPrice >= entry.price)) activatedEntries = index + 1;
      });
      if (activatedEntries !== trackedPlan.activatedEntries) { status = `${trackedPlan.entries[activatedEntries - 1].name}_ACTIVA` as PlanStatus; title = `${trackedPlan.entries[activatedEntries - 1].name} activada`; }
    }
    if (status === trackedPlan.status && activatedEntries === trackedPlan.activatedEntries) return;
    const terminal = ['TP', 'INVALIDADO', 'VENCIDO'].includes(status);
    const usedEntries = trackedPlan.entries.slice(0, activatedEntries);
    const usedCapital = usedEntries.reduce((sum, entry) => sum + entry.allocationValue, 0);
    const averagePrice = usedEntries.at(-1)?.averageAfter || trackedPlan.entries[0].price;
    const exitPrice = status === 'TP' ? trackedPlan.target : status === 'INVALIDADO' ? trackedPlan.invalidation : marketPrice;
    const grossPct = activatedEntries ? (longPlan ? (exitPrice - averagePrice) / averagePrice : (averagePrice - exitPrice) / averagePrice) * 100 * riskSettings.leverage : 0;
    const costsPct = activatedEntries ? (riskSettings.feePct + riskSettings.slippagePct) * 2 * riskSettings.leverage : 0;
    const nextPlan: TrackedPlan = { ...trackedPlan, status, activatedEntries, lastPrice: marketPrice, ...(terminal ? { closedAt: new Date().toISOString(), resultPct: grossPct - costsPct, resultUSDT: usedCapital * (grossPct - costsPct) / 100 } : {}) };
    const updateTimer = window.setTimeout(() => {
      setTrackedPlan(nextPlan);
      localStorage.setItem('liquidity-lab-active-plan-v4', JSON.stringify(nextPlan));
      void persistRecord('plan', { ...nextPlan });
      if (title) {
        const item = { id: `${nextPlan.id}-${status}`, timestamp: new Date().toISOString(), title, detail: `${trackedPlan.symbol} ${trackedPlan.timeframe} · ${money(marketPrice)}`, tone };
        void persistRecord('event', { ...item, planId: nextPlan.id, eventType: status });
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification(`Liquidity Lab · ${title}`, { body: item.detail });
        setAlerts((current) => { const updated = [item, ...current].slice(0, 50); localStorage.setItem('liquidity-lab-alerts-v4', JSON.stringify(updated)); return updated; });
      }
      if (terminal) setJournal((current) => { const updated = [nextPlan, ...current.filter((item) => item.id !== nextPlan.id)].slice(0, 200); localStorage.setItem('liquidity-lab-journal-v4', JSON.stringify(updated)); return updated; });
    }, 0);
    return () => window.clearTimeout(updateTimer);
  }, [data, trackedPlan, riskSettings, liveFeed.price]);

  const openSettings = () => {
    setDraftCapital(String(capital));
    setDraftAllocations(allocations);
    setDraftRisk(riskSettings);
    setSettingsOpen(true);
  };
  const applySettings = () => {
    const parsedCapital = Number(draftCapital);
    setCapital(Number.isFinite(parsedCapital) ? Math.max(100, parsedCapital) : 100);
    setAllocations(draftAllocations);
    setRiskSettings(draftRisk);
    localStorage.setItem('liquidity-lab-risk-v4', JSON.stringify(draftRisk));
    setSettingsOpen(false);
  };
  const applySymbol = () => {
    const normalized = symbolInput.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (normalized.length >= 5) {
      setSymbolInput(normalized);
      setSymbol(normalized);
    }
  };
  const startSimulation = () => {
    if (!data || data.direction === 'NEUTRAL' || eventPause || dailyLossHit) return;
    const plan: TrackedPlan = { id: `${data.symbol}-${data.executionTimeframe}-${Date.now()}`, symbol: data.symbol, timeframe: data.executionTimeframe, direction: data.direction, probability: data.probability, createdAt: data.timestamp, validUntil: data.validUntil, status: 'ESPERANDO', entries: data.entries, target: data.target, invalidation: data.invalidation, activatedEntries: 0, lastPrice: data.spotPrice, capital: data.capital };
    setTrackedPlan(plan);
    localStorage.setItem('liquidity-lab-active-plan-v4', JSON.stringify(plan));
    void persistRecord('plan', { ...plan });
    const item: AlertItem = { id: `${plan.id}-created`, timestamp: data.timestamp, title: 'Simulación iniciada', detail: `${plan.symbol} ${plan.timeframe} · vence ${new Date(plan.validUntil).toLocaleString('es-AR')}`, tone: 'info' };
    setAlerts((current) => { const updated = [item, ...current].slice(0, 50); localStorage.setItem('liquidity-lab-alerts-v4', JSON.stringify(updated)); return updated; });
  };
  const discardPlan = () => {
    setTrackedPlan(null);
    localStorage.removeItem('liquidity-lab-active-plan-v4');
  };
  const exportJournal = () => {
    const rows = [['Símbolo', 'Marco', 'Dirección', 'Creado', 'Cerrado', 'Estado', 'Entradas', 'Resultado %', 'Resultado USDT'], ...journal.map((item) => [item.symbol, item.timeframe, item.direction, item.createdAt, item.closedAt || '', item.status, String(item.activatedEntries), String(item.resultPct ?? ''), String(item.resultUSDT ?? '')])];
    const blob = new Blob([rows.map((row) => row.join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `liquidity-lab-journal-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(link.href);
  };
  const loadScanner = async () => {
    setScannerLoading(true);
    try {
      const response = await fetch('/api/scanner', { cache: 'no-store' }); const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'No se pudo cargar el radar.');
      setScannerRows(result.opportunities || []);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No se pudo cargar el radar.'); }
    finally { setScannerLoading(false); }
  };
  const enableNotifications = async () => {
    if (typeof Notification === 'undefined') return;
    setNotificationPermission(await Notification.requestPermission());
  };
  const refreshLab = async () => {
    setLabLoading(true);
    try { const response = await fetch(`/api/lab?symbol=${symbol}&timeframe=${chartFrame}`, { cache: 'no-store' }); const result = await response.json(); setLabResult(result); labLastLoadedRef.current = Date.now(); labLastKeyRef.current = `${symbol}-${chartFrame}`; }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'No se pudo actualizar el laboratorio.'); }
    finally { setLabLoading(false); }
  };

  const draftTotal = draftAllocations.reduce((sum, value) => sum + value, 0);
  const average = data?.entries.at(-1)?.averageAfter || 0;
  const isLongPlan = data ? data.target >= average : true;
  const resultFromAverage = (price: number) => !average ? 0 : isLongPlan ? (price - average) / average * 100 : (average - price) / average * 100;
  const bids = data?.clusters.filter((cluster) => cluster.side === 'bid').sort((a, b) => b.notional - a.notional).slice(0, 8) || [];
  const asks = data?.clusters.filter((cluster) => cluster.side === 'ask').sort((a, b) => b.notional - a.notional).slice(0, 8) || [];
  const maxLiquidity = Math.max(1, ...bids.concat(asks).map((cluster) => cluster.notional));
  const activeStructure = data?.structure.find((item) => item.timeframe === data.executionTimeframe);
  const terminalJournal = journal.filter((item) => ['TP', 'INVALIDADO', 'VENCIDO'].includes(item.status));
  const wins = terminalJournal.filter((item) => (item.resultUSDT || 0) > 0).length;
  const netResult = terminalJournal.reduce((sum, item) => sum + (item.resultUSDT || 0), 0);
  const winRate = terminalJournal.length ? wins / terminalJournal.length * 100 : 0;
  const finalRiskDistancePct = data && average ? Math.abs(average - data.invalidation) / average * 100 : 0;
  const plannedNotional = capital * riskSettings.leverage;
  const estimatedCosts = plannedNotional * (riskSettings.feePct + riskSettings.slippagePct) * 2 / 100;
  const estimatedMaxLoss = plannedNotional * finalRiskDistancePct / 100 + estimatedCosts;
  const riskBudget = capital * riskSettings.riskPct / 100;
  const recommendedMargin = finalRiskDistancePct ? riskBudget / Math.max((finalRiskDistancePct + (riskSettings.feePct + riskSettings.slippagePct) * 2) * riskSettings.leverage / 100, 1e-9) : capital;
  const todayKey = new Date().toISOString().slice(0, 10);
  const todayNet = terminalJournal.filter((item) => item.closedAt?.slice(0, 10) === todayKey).reduce((sum, item) => sum + (item.resultUSDT || 0), 0);
  const dailyLossLimit = capital * riskSettings.dailyLossPct / 100;
  const dailyLossHit = todayNet <= -dailyLossLimit;
  const calibratedPlans = terminalJournal.filter((item) => Number.isFinite(item.probability));
  const calibrationError = calibratedPlans.length ? calibratedPlans.reduce((sum, item) => sum + Math.abs(((item.resultUSDT || 0) > 0 ? 100 : 0) - item.probability), 0) / calibratedPlans.length : 0;
  const replayCandles = data?.candles[data.executionTimeframe] || [];
  const replayPosition = Math.min(replayIndex || replayCandles.length - 1, Math.max(0, replayCandles.length - 1));
  const replayCandle = replayCandles[replayPosition];
  const replayStart = replayCandles[Math.max(0, replayPosition - 10)];
  const replayMomentumPct = replayCandle && replayStart ? (replayCandle.close - replayStart.close) / replayStart.close * 100 : 0;
  const calibrationBin = data && labResult && labResult.resolved >= 30 ? labResult.bins.find((bin) => data.probability >= Number(bin.label.slice(0, 2)) && data.probability < Number(bin.label.slice(0, 2)) + 10) : null;
  const calibratedProbability = data && calibrationBin && calibrationBin.count >= 20 ? Math.round(calibrationBin.observedPct) : data?.probability || 0;
  const confidenceSource = calibrationBin && calibrationBin.count >= 20 ? `Calibrada con ${calibrationBin.count} casos` : 'Estimación aún no calibrada';

  return <main>
    <header className="terminal-header">
      <div className="brand"><span className="brand-mark">LL</span><div><strong>Liquidity Lab</strong><small>MARKET EXECUTION CONSOLE</small></div></div>
      <div className="feed-status"><span className={`live-dot ${loading || liveFeed.status !== 'LIVE' ? 'pulse' : ''}`} /><div><b>{liveFeed.status === 'LIVE' ? 'BINANCE WEBSOCKET' : liveFeed.status}</b><small>{liveFeed.lastMessageAt ? `Tick ${new Date(liveFeed.lastMessageAt).toLocaleTimeString('es-AR')}` : data ? `Snapshot ${new Date(data.timestamp).toLocaleTimeString('es-AR')}` : 'Esperando mercado'}</small></div></div>
      <div className="header-actions"><button className={eventPause ? 'event-active' : ''} onClick={() => setEventPause((current) => { localStorage.setItem('liquidity-lab-event-pause-v4', JSON.stringify(!current)); return !current; })}>{eventPause ? 'Pausa por evento ACTIVA' : 'Pausa por evento'}</button><button onClick={openSettings}>Gestión de capital</button><button className="icon-button" aria-label="Ajustes" onClick={openSettings}>⚙</button></div>
    </header>

    <section className="market-command">
      <label>ACTIVO<div className="pair-input"><input list="binance-symbols" value={symbolInput} onChange={(event) => setSymbolInput(event.target.value.toUpperCase())} onKeyDown={(event) => { if (event.key === 'Enter') applySymbol(); }} aria-label="Par de Binance" /><datalist id="binance-symbols">{availableSymbols.map((item) => <option value={item} key={item} />)}</datalist><button onClick={applySymbol}>Cargar</button></div></label>
      <div className="spot-block"><small>PRECIO SPOT · LIVE</small><strong>{data ? money(liveFeed.price || data.spotPrice) : '—'}</strong>{data && <span className={data.priceChangePct < 0 ? 'negative-chip' : 'positive-chip'}>{pct(data.priceChangePct)}</span>}<small>Flow 60s {pct(liveFeed.flowDeltaPct, 1)} · libro {pct(liveFeed.bookImbalancePct, 1)}</small></div>
      <div className="feed-clock"><small>PRÓXIMA ACTUALIZACIÓN</small><b>00:{String(nextRefresh).padStart(2, '0')}</b><span>Automática cada 30 s</span></div>
      <button className="refresh-button" onClick={() => void analyze()} disabled={loading}><span>{loading ? '◌' : '↻'}</span>{loading ? 'Actualizando mercado' : 'Actualizar ahora'}</button>
    </section>

    <section className="console" aria-live="polite">
      {error && <div className="error-banner" role="alert"><b>La fuente en vivo no respondió</b><span>{error}</span><button onClick={() => void analyze()}>Reintentar</button></div>}
      {!data && !error && <div className="loading-panel"><span className="spinner" /><b>Sincronizando con Binance</b><p>Descargando libro completo, velas, operaciones y derivados.</p></div>}
      {data && <>
        <section className="decision-strip">
          <div className={`decision-copy ${data.direction.toLowerCase()}`}><span className="section-code">01 / DIRECTION ENGINE</span><div className="decision-title"><span className="direction-tag">{data.direction}</span><h1>{directionText[data.direction]}</h1></div><p>{data.directionSummary}</p><div className="decision-factors"><div><small>ESTRUCTURA 4H</small><b>{trendText[data.timeframes[2].trend]}</b><span>Score {data.timeframes[2].score.toFixed(1)}</span></div><div><small>ORDER FLOW</small><b>{data.orderFlow.label}</b><span>Delta {pct(data.orderFlow.deltaPct, 1)}</span></div><div><small>DERIVADOS</small><b>{data.derivatives.label}</b><span>{data.derivatives.fundingRate === null ? 'Cobertura parcial' : 'Futuros USD-M'}</span></div></div></div>
          <ConfidenceGauge value={calibratedProbability} direction={data.direction} source={confidenceSource} />
          <aside className="derivatives-brief"><div className="section-code">DERIVADOS</div><div className="brief-row"><span>Open interest</span><b>{data.derivatives.openInterest ? compact.format(data.derivatives.openInterest) : 'N/D'}</b></div><div className="brief-row"><span>Variación OI · 2h30</span><b>{data.derivatives.openInterestChangePct === null ? 'N/D' : pct(data.derivatives.openInterestChangePct)}</b></div><div className="brief-row"><span>Funding · 8h</span><b>{data.derivatives.fundingRate === null ? 'N/D' : pct(data.derivatives.fundingRate * 100, 4)}</b></div><div className="brief-row"><span>Libro futuros</span><b>{data.derivatives.futuresBookImbalancePct === null ? 'N/D' : `${data.derivatives.futuresBookImbalancePct >= 0 ? 'Demanda' : 'Oferta'} ${pct(Math.abs(data.derivatives.futuresBookImbalancePct))}`}</b></div><p>{data.derivatives.explanation}</p><button className="inline-action" onClick={() => setExpanded(expanded === 'derivatives' ? null : 'derivatives')}>{expanded === 'derivatives' ? 'Ocultar metodología' : 'Cómo se interpreta'}</button>{expanded === 'derivatives' && <div className="method-note">El OI mide posiciones abiertas, el funding muestra qué lado paga y el libro de futuros compara demanda y oferta visibles. Acompañan la lectura, pero nunca deciden una entrada por sí solos.</div>}</aside>
        </section>

        <section className="forecast-panel">
          <div className="panel-heading"><div><span className="section-code">02 / FORECAST ENGINE · {data.executionTimeframe.toUpperCase()}</span><h2>Pronóstico condicionado y contexto de mercado</h2></div><div className={`forecast-status ${data.forecast.actionable ? 'enabled' : 'waiting'}`}><small>DECISIÓN DEL MODELO</small><b>{data.forecast.actionable ? 'PLAN HABILITADO' : 'ESPERAR'}</b><span>Horizonte {data.forecast.horizon}</span></div></div>
          <div className="forecast-alert"><b>{data.forecast.actionMessage}</b><span>Rango esperado: {money(data.forecast.expectedLow)} — {money(data.forecast.expectedHigh)}</span></div>
          <div className="forecast-context"><article><small>RÉGIMEN</small><b>{data.regime.label}</b><span>Volatilidad {data.regime.volatility.toLowerCase()} · ATR {data.regime.atrPct.toFixed(2)}%</span><p>{data.regime.explanation}</p></article><article><small>ESTRUCTURA {data.executionTimeframe.toUpperCase()}</small><b>{activeStructure ? structureText[activeStructure.state] : 'Sin lectura'}</b><span>{activeStructure ? `${money(activeStructure.swingLow)} — ${money(activeStructure.swingHigh)}` : 'N/D'}</span><p>{activeStructure?.explanation}</p></article><article><small>CONTEXTO BTC</small><b>{data.marketContext.label}</b><span>Correlación {data.marketContext.correlation.toFixed(2)} · Fuerza relativa {pct(data.marketContext.relativeStrengthPct)}</span><p>{data.marketContext.explanation}</p></article><article><small>PRECIO + OPEN INTEREST</small><b>{data.derivatives.basisPct === null ? 'Basis N/D' : `Basis ${pct(data.derivatives.basisPct, 3)}`}</b><span>Precio comparable {pct(data.derivatives.priceChangeComparablePct)} · OI {data.derivatives.openInterestChangePct === null ? 'N/D' : pct(data.derivatives.openInterestChangePct)}</span><p>{data.derivatives.priceOiMatrix}</p></article><article><small>CONFIRMACIÓN EXTERNA</small><b>{data.crossExchange.label}</b><span>{data.crossExchange.priceSpreadPct === null ? 'Bybit no disponible' : `Spread Binance/Bybit ${pct(data.crossExchange.priceSpreadPct, 3)}`}</span><p>{data.crossExchange.explanation}</p></article></div>
          <div className="value-map"><header><span className="section-code">MAPA DE VALOR · VOLUME PROFILE + VWAP</span><b>{data.volumeAnalytics.position === 'SOBRE_VALOR' ? 'Precio sobre el área de valor' : data.volumeAnalytics.position === 'BAJO_VALOR' ? 'Precio bajo el área de valor' : 'Precio dentro del área de valor'}</b></header><div><span><small>VAL</small><b>{money(data.volumeAnalytics.valueAreaLow)}</b></span><span><small>POC</small><b>{money(data.volumeAnalytics.poc)}</b></span><span><small>VAH</small><b>{money(data.volumeAnalytics.valueAreaHigh)}</b></span><span><small>VWAP</small><b>{money(data.volumeAnalytics.vwap)}</b></span><span><small>VWAP ANCLADO</small><b>{money(data.volumeAnalytics.anchoredVwap)}</b></span></div></div>
          <div className="forecast-scenarios">{data.forecast.scenarios.map((scenario, index) => <article className={`forecast-case case-${index + 1}`} key={scenario.name}><header><span>{scenario.name}</span><strong>{scenario.probability}%</strong></header><i><em style={{ width: `${scenario.probability}%` }} /></i><small>CONDICIÓN</small><p>{scenario.trigger}</p><small>RECORRIDO</small><p>{scenario.path}</p></article>)}</div>
          <p className="forecast-calibration">{data.forecast.calibration}</p>
        </section>

        <section className="control-panel">
          <div className="panel-heading"><div><span className="section-code">03 / VALIDACIÓN, RIESGO Y SIMULACIÓN</span><h2>Control operativo antes y después de entrar</h2></div><div className={`plan-state ${trackedPlan ? trackedPlan.status.toLowerCase() : 'inactive'}`}><small>PLAN SEGUIDO</small><b>{trackedPlan ? planStatusText[trackedPlan.status] : 'Sin simulación activa'}</b></div></div>
          <div className="control-grid">
            <article className="confirmation-card"><header><div><small>CONFIRMACIÓN DE ENTRADA</small><b>{data.confirmation.status === 'CONFIRMADA' ? 'Entrada confirmada' : data.confirmation.status === 'DEBIL' ? 'Confirmación débil' : 'Todavía fuera de E1'}</b></div><strong>{data.confirmation.score}/6</strong></header><p>{data.confirmation.explanation}</p><div className="check-grid">{data.confirmation.checks.map((check) => <span className={check.passed ? 'passed' : 'pending'} title={check.explanation} key={check.label}>{check.passed ? '✓' : '○'} {check.label}</span>)}</div><small className="validity">Válido hasta {new Date(data.validUntil).toLocaleString('es-AR')}</small></article>
            <article className="risk-card"><header><div><small>RIESGO MONETARIO ESTIMADO</small><b>{money(estimatedMaxLoss)} · {(estimatedMaxLoss / capital * 100).toFixed(2)}% de la cuenta</b></div><strong>{riskSettings.leverage}×</strong></header><div className="risk-grid"><span><small>NOCIONAL</small><b>{money(plannedNotional)}</b></span><span><small>COSTOS IDA/VUELTA</small><b>{money(estimatedCosts)}</b></span><span><small>PRESUPUESTO DE RIESGO</small><b>{money(riskBudget)}</b></span><span><small>MARGEN SUGERIDO</small><b>{money(Math.min(capital, recommendedMargin))}</b></span></div><p>Incluye comisión {riskSettings.feePct}% y slippage {riskSettings.slippagePct}% por lado. Ajustalo en Gestión de capital.</p></article>
          </div>
          {eventPause && <div className="event-pause-banner"><b>Operación pausada manualmente por evento.</b><span>El análisis continúa actualizándose, pero no se permite iniciar una simulación hasta desactivar la pausa.</span></div>}
          <div className="validation-grid">
            <article><small>VALIDACIÓN HISTÓRICA PROXY</small><b>{data.historicalValidation.label}</b><div><span><small>MUESTRA</small><strong>{data.historicalValidation.sampleSize}</strong></span><span><small>WIN RATE</small><strong>{data.historicalValidation.winRatePct.toFixed(1)}%</strong></span><span><small>EXPECTATIVA</small><strong>{data.historicalValidation.expectancyR.toFixed(2)}R</strong></span><span><small>PROFIT FACTOR</small><strong>{data.historicalValidation.profitFactor >= 99 ? '∞' : data.historicalValidation.profitFactor.toFixed(2)}</strong></span><span><small>MAX DRAWDOWN</small><strong>{data.historicalValidation.maxDrawdownR.toFixed(1)}R</strong></span></div><p>{data.historicalValidation.methodology}</p></article>
            <article className="simulation-card"><small>SEGUIMIENTO DEL PLAN</small>{trackedPlan ? <><b>{trackedPlan.symbol} · {trackedPlan.timeframe} · {trackedPlan.direction}</b><div className="plan-progress">{trackedPlan.entries.map((entry, index) => <span className={index < trackedPlan.activatedEntries ? 'done' : ''} key={entry.name}>{entry.name}</span>)}<span className={trackedPlan.status === 'TP' ? 'done target' : ''}>TP</span></div><p>Último precio {money(trackedPlan.lastPrice)} · vence {new Date(trackedPlan.validUntil).toLocaleString('es-AR')}</p><button className="secondary-button" onClick={discardPlan}>{['TP', 'INVALIDADO', 'VENCIDO'].includes(trackedPlan.status) ? 'Cerrar seguimiento' : 'Cancelar simulación'}</button></> : <><b>Probá el plan sin enviar órdenes</b><p>La consola conservará entradas, vencimiento y resultado entre actualizaciones.</p><button className="primary-button" disabled={data.direction === 'NEUTRAL' || eventPause || dailyLossHit} onClick={startSimulation}>{dailyLossHit ? 'Límite diario alcanzado' : eventPause ? 'Pausa por evento activa' : data.direction === 'NEUTRAL' ? 'Esperar dirección clara' : 'Iniciar simulación'}</button></>}</article>
          </div>
          <div className="journal-row"><article><header><div><small>RESULTADOS DEL DISPOSITIVO</small><b>{terminalJournal.length} simulaciones cerradas</b></div><button className="secondary-button" disabled={!journal.length} onClick={exportJournal}>Exportar CSV</button></header><div className="journal-kpis"><span><small>WIN RATE</small><b>{winRate.toFixed(1)}%</b></span><span><small>RESULTADO NETO</small><b className={netResult >= 0 ? 'positive' : 'negative'}>{money(netResult)}</b></span><span><small>GANADORAS</small><b>{wins}</b></span><span><small>PERDEDORAS / VENCIDAS</small><b>{terminalJournal.length - wins}</b></span></div></article><article className="alerts-card"><header><div><small>CENTRO DE ALERTAS</small><b>Últimos eventos</b></div><div className="alert-actions"><button className="secondary-button" disabled={notificationPermission === 'granted' || notificationPermission === 'denied'} onClick={() => void enableNotifications()}>{notificationPermission === 'granted' ? 'Notificaciones activas' : 'Activar avisos'}</button><button className="secondary-button" disabled={!alerts.length} onClick={() => { setAlerts([]); localStorage.removeItem('liquidity-lab-alerts-v4'); }}>Limpiar</button></div></header>{alerts.length ? alerts.slice(0, 3).map((item) => <div className={`alert-item ${item.tone}`} key={item.id}><b>{item.title}</b><span>{item.detail}</span><small>{new Date(item.timestamp).toLocaleString('es-AR')}</small></div>) : <p>Las activaciones, el target, la invalidación y el vencimiento aparecerán aquí.</p>}</article></div>
        </section>

        <section className="scanner-panel">
          <div className="panel-heading"><div><span className="section-code">RADAR DE OPORTUNIDADES · BINANCE 4H</span><h2>Comparar los pares con mayor volumen</h2></div><button className="secondary-button" onClick={() => void loadScanner()} disabled={scannerLoading}>{scannerLoading ? 'Analizando mercado…' : scannerRows.length ? 'Actualizar radar' : 'Buscar oportunidades'}</button></div>
          {scannerRows.length ? <div className="table-wrap"><table><thead><tr><th>Par</th><th>Dirección técnica</th><th>Calidad</th><th>Variación 24h</th><th>RSI</th><th>ATR</th><th>Volumen</th><th>Acción</th></tr></thead><tbody>{scannerRows.map((row) => <tr key={row.symbol}><td><b>{row.symbol}</b></td><td><span className={`trend ${row.direction.toLowerCase()}`}>{trendText[row.direction]}</span></td><td>{row.score}/100</td><td className={row.priceChangePct >= 0 ? 'positive' : 'negative'}>{pct(row.priceChangePct)}</td><td>{row.rsi.toFixed(1)}</td><td>{row.atrPct.toFixed(2)}%</td><td>{compact.format(row.quoteVolume)} USDT</td><td><button className="inline-action" onClick={() => { setSymbolInput(row.symbol); setSymbol(row.symbol); }}>Analizar</button></td></tr>)}</tbody></table></div> : <p className="scanner-empty">El radar se ejecuta manualmente para no consumir datos innecesarios. Ordena los pares USDT líquidos por estructura EMA 10/55, RSI, ATR y volumen; después el análisis completo decide si existe un plan.</p>}
        </section>

        <section className="professional-panel">
          <div className="panel-heading"><div><span className="section-code">SISTEMA PROFESIONAL · VALIDACIÓN CONTINUA</span><h2>Replay, calibración, cartera y estado de fuentes</h2></div><span className={`system-health ${data.sourceHealth.spot === 'OK' && liveFeed.status === 'LIVE' ? 'healthy' : 'warning'}`}>{data.sourceHealth.spot === 'OK' && liveFeed.status === 'LIVE' ? 'SISTEMA OPERATIVO' : 'COBERTURA PARCIAL'}</span></div>
          <div className="professional-grid">
            <article className="replay-card"><header><div><small>REPLAY SIN INFORMACIÓN FUTURA</small><b>{replayCandle ? new Date(replayCandle.time).toLocaleString('es-AR') : 'Sin velas'}</b></div><strong>{replayCandle ? money(replayCandle.close) : '—'}</strong></header>{replayCandles.length > 1 && <input type="range" min="0" max={replayCandles.length - 1} value={replayPosition} onChange={(event) => setReplayIndex(Number(event.target.value))} aria-label="Posición del replay" />}<div className="replay-kpis"><span><small>MOMENTUM 10 VELAS</small><b className={replayMomentumPct >= 0 ? 'positive' : 'negative'}>{pct(replayMomentumPct)}</b></span><span><small>POSICIÓN</small><b>{replayPosition + 1}/{replayCandles.length}</b></span></div><p>Mové el control para recorrer la historia disponible. Los cálculos usan únicamente las velas anteriores al punto seleccionado.</p></article>
            <article className="model-card"><small>COMPARACIÓN DE MODELOS</small><b>Baseline EMA vs filtro completo</b><div><span><small>BASELINE WIN RATE</small><strong>{data.historicalValidation.baselineWinRatePct.toFixed(1)}%</strong></span><span><small>BASELINE EXPECTATIVA</small><strong>{data.historicalValidation.baselineExpectancyR.toFixed(2)}R</strong></span><span><small>MODELO COMPLETO</small><strong>{data.historicalValidation.expectancyR.toFixed(2)}R</strong></span><span><small>MEJORA</small><strong className={data.historicalValidation.improvementR >= 0 ? 'positive' : 'negative'}>{data.historicalValidation.improvementR >= 0 ? '+' : ''}{data.historicalValidation.improvementR.toFixed(2)}R</strong></span></div><p>{calibratedPlans.length ? `Error absoluto de calibración observado: ${calibrationError.toFixed(1)} puntos sobre ${calibratedPlans.length} operaciones cerradas.` : 'La calibración progresiva comenzará cuando haya simulaciones cerradas.'}</p></article>
            <article className="source-health-card"><small>SALUD Y TRAZABILIDAD</small><b>{historyStatus.available ? `${historyStatus.snapshots} snapshots persistidos` : 'Base central no enlazada · fallback local'}</b><div><span><i className={liveFeed.status === 'LIVE' ? 'ok' : ''} />WebSocket {liveFeed.status}</span><span><i className={data.sourceHealth.spot === 'OK' ? 'ok' : ''} />Binance spot {data.sourceHealth.spot}</span><span><i className={data.sourceHealth.derivatives === 'OK' ? 'ok' : ''} />Derivados {data.sourceHealth.derivatives}</span><span><i className={data.sourceHealth.bybit === 'OK' ? 'ok' : ''} />Bybit {data.sourceHealth.bybit}</span></div><p>Respuesta completa {data.sourceHealth.totalLatencyMs} ms · último snapshot {new Date(data.sourceHealth.generatedAt).toLocaleTimeString('es-AR')}.</p></article>
            <article className="portfolio-card"><small>RIESGO DE CARTERA Y EJECUCIÓN</small><b className={dailyLossHit ? 'negative' : ''}>{dailyLossHit ? 'Límite diario alcanzado' : 'Riesgo diario disponible'}</b><div><span><small>RESULTADO HOY</small><strong>{money(todayNet)}</strong></span><span><small>LÍMITE DIARIO</small><strong>{money(dailyLossLimit)}</strong></span><span><small>RIESGO DEL PLAN</small><strong>{money(estimatedMaxLoss)}</strong></span><span><small>PLANES SIMULTÁNEOS</small><strong>{trackedPlan && !['TP', 'INVALIDADO', 'VENCIDO'].includes(trackedPlan.status) ? '1 / 1' : '0 / 1'}</strong></span></div><div className="execution-lock"><b>ORDEN REAL BLOQUEADA</b><span>Solo simulación. Requiere credenciales, permisos limitados y confirmación explícita antes de habilitarse.</span></div></article>
          </div>
        </section>

        <section className="lab-panel">
          <div className="panel-heading"><div><span className="section-code">LABORATORIO ESTADÍSTICO · {data.symbol} {data.executionTimeframe.toUpperCase()}</span><h2>¿Las probabilidades realmente se cumplen?</h2></div><div className="lab-heading-actions">{labResult && <span className={`lab-status ${labResult.status.toLowerCase().replaceAll(' ', '-')}`}>{labResult.status}</span>}<button className="secondary-button" onClick={() => void refreshLab()} disabled={labLoading}>{labLoading ? 'Resolviendo pronósticos…' : 'Actualizar laboratorio'}</button></div></div>
          {!labResult || !labResult.available ? <div className="lab-empty"><b>{labLoading ? 'Procesando la historia…' : 'Laboratorio esperando datos'}</b><p>Los snapshots nuevos se guardan automáticamente. Cuando exista recorrido posterior suficiente, cada pronóstico se resolverá como TP, invalidación o vencimiento.</p></div> : <>
            <div className="validation-progress"><header><div><small>PROGRESO HACIA EVIDENCIA DEFINITIVA</small><b>{labResult.resolved} de {labResult.targets.definitive} pronósticos independientes resueltos</b></div><strong>{labResult.progressPct.toFixed(1)}%</strong></header><i><em style={{ width: `${labResult.progressPct}%` }} /></i><div><span className={labResult.resolved >= labResult.targets.initial ? 'done' : ''}>Inicial · {labResult.targets.initial}</span><span className={labResult.resolved >= labResult.targets.calibration ? 'done' : ''}>Calibración · {labResult.targets.calibration}</span><span className={labResult.resolved >= labResult.targets.professional ? 'done' : ''}>Profesional · {labResult.targets.professional}</span><span className={labResult.resolved >= labResult.targets.definitive ? 'done' : ''}>Definitiva · {labResult.targets.definitive}</span></div></div>
            <div className="lab-kpis"><article><small>SNAPSHOTS</small><b>{labResult.snapshots}</b><span>{labResult.pending} hipótesis pendiente</span></article><article><small>RESUELTOS</small><b>{labResult.resolved}</b><span>{labResult.wins} TP · {labResult.invalidations} inval. · {labResult.expired} vencidos · {labResult.notActivated} sin E1</span></article><article><small>WIN RATE</small><b>{labResult.winRatePct.toFixed(1)}%</b><span>Solo planes que activaron E1</span></article><article><small>EXPECTATIVA</small><b className={labResult.expectancyR >= 0 ? 'positive' : 'negative'}>{labResult.expectancyR.toFixed(2)}R</b><span>Por pronóstico activado</span></article><article><small>BRIER SCORE</small><b>{labResult.resolved ? labResult.brierScore.toFixed(3) : '—'}</b><span>Menor es mejor</span></article><article><small>ERROR CALIBRACIÓN</small><b>{labResult.resolved ? `${labResult.expectedCalibrationErrorPct.toFixed(1)}%` : '—'}</b><span>Previsto vs observado</span></article></div>
            <div className="lab-analysis-grid"><article><small>VALIDACIÓN TEMPORAL 70/30</small><b>Dentro vs fuera de muestra</b><div><span><small>ENTRENAMIENTO</small><strong>{labResult.trainWinRatePct.toFixed(1)}%</strong></span><span><small>FUERA DE MUESTRA</small><strong>{labResult.outOfSampleCount ? `${labResult.outOfSampleWinRatePct.toFixed(1)}%` : 'Sin muestra'}</strong></span><span><small>CASOS OOS</small><strong>{labResult.outOfSampleCount}</strong></span><span><small>LOG LOSS</small><strong>{labResult.resolved ? labResult.logLoss.toFixed(3) : '—'}</strong></span></div></article><article><small>DERIVA RECIENTE</small><b className={labResult.driftPct < -12 ? 'negative' : ''}>{labResult.resolved ? `${labResult.driftPct >= 0 ? '+' : ''}${labResult.driftPct.toFixed(1)} puntos` : 'Sin muestra'}</b><div><span><small>PERÍODO ANTERIOR</small><strong>{labResult.priorWinRatePct.toFixed(1)}%</strong></span><span><small>PERÍODO RECIENTE</small><strong>{labResult.recentWinRatePct.toFixed(1)}%</strong></span><span><small>MFE PROMEDIO</small><strong>{labResult.averageMfePct.toFixed(2)}%</strong></span><span><small>MAE PROMEDIO</small><strong>{labResult.averageMaePct.toFixed(2)}%</strong></span></div></article></div>
            <div className="calibration-section"><header><div><small>CURVA DE CALIBRACIÓN</small><b>Probabilidad prevista frente a frecuencia observada</b></div><span>{labResult.recommendation}</span></header><div className="calibration-grid">{labResult.bins.map((bin) => <article key={bin.label}><small>{bin.label} · {bin.count} casos</small><div><span style={{ height: `${Math.max(3, bin.predictedPct)}%` }}><i>Prev. {bin.predictedPct.toFixed(0)}%</i></span><span className="observed" style={{ height: `${Math.max(3, bin.observedPct)}%` }}><i>Obs. {bin.observedPct.toFixed(0)}%</i></span></div><b>Error {bin.count ? `${bin.errorPct.toFixed(1)} puntos` : 'sin muestra'}</b></article>)}</div></div>
            <div className="regime-validation"><header><small>RESULTADOS POR RÉGIMEN</small><b>La estrategia no se considera validada si depende de un único entorno</b></header>{labResult.byRegime.length ? <div className="table-wrap"><table><thead><tr><th>Régimen</th><th>Casos</th><th>Win rate</th><th>Expectativa</th><th>Estado</th></tr></thead><tbody>{labResult.byRegime.map((item) => <tr key={item.regime}><td><b>{item.regime}</b></td><td>{item.count}</td><td>{item.winRatePct.toFixed(1)}%</td><td className={item.expectancyR >= 0 ? 'positive' : 'negative'}>{item.expectancyR.toFixed(2)}R</td><td>{item.count >= 30 ? 'Evaluable' : 'Recolectando'}</td></tr>)}</tbody></table></div> : <p>Aún no hay pronósticos resueltos para separar por régimen.</p>}</div>
            <p className="lab-method">Cada muestra comienza después de que termina la anterior, evitando contar decenas de snapshots superpuestos como predicciones independientes. Un resultado solo entra en las métricas después de activar E1; los planes no activados se informan aparte. La resolución usa precios posteriores almacenados y nunca información futura disponible al emitir la hipótesis.</p>
          </>}
        </section>

        <section className="chart-panel">
          <div className="panel-heading"><div><span className="section-code">04 / DESARROLLO DEL TRADE · PLAN {data.executionTimeframe.toUpperCase()}</span><h2>Precio, velas y niveles propios de {data.executionTimeframe}</h2></div><div className="chart-controls"><button className={`overlay-toggle ${showOverlays ? 'active' : ''}`} onClick={() => setShowOverlays((current) => !current)}>EMA + valor</button><div className="frame-selector" aria-label="Temporalidad del gráfico">{frames.map((frame) => <button key={frame} className={chartFrame === frame ? 'active' : ''} onClick={() => setChartFrame(frame)}>{frame}</button>)}</div></div></div>
          <div className="chart-legend"><span><i className="legend-candle up" />Vela alcista</span><span><i className="legend-candle down" />Vela bajista</span><span><i className="legend-zone" />Zona operativa</span><span><i className="legend-line entries-line" />Precio exacto E1/E2/E3</span><span><i className="legend-line target-line" />Target</span><span><i className="legend-line stop-line" />Invalidación</span><small>Velas reales de Binance · trayectoria punteada = secuencia del plan, no predicción</small></div>
          <TradeChart data={data} timeframe={chartFrame} showOverlays={showOverlays} />
          <div className="chart-explainer"><section><span className="section-code">CÓMO LEER EL GRÁFICO</span><ol><li><b>Velas:</b> muestran el precio real del marco seleccionado; cambiar 15m, 1h, 4h o 1d recalcula el contexto del plan.</li><li><b>Spot:</b> es el precio actual y el punto desde donde se mide cada distancia.</li><li><b>Porcentajes:</b> E1/E2/E3 muestran distancia desde spot. TP muestra spot + profit desde promedio; Invalidación muestra spot + riesgo desde promedio.</li><li><b>E1 / E2 / E3:</b> combinan nodos históricos de volumen, liquidaciones públicas estimadas, EMA 200 de 4h y confirmación del libro visible.</li><li><b>Target:</b> queda ligeramente antes de la primera zona de oferta relevante para aumentar la probabilidad de ejecución.</li><li><b>Invalidación:</b> si el precio la atraviesa, la hipótesis deja de ser válida; no es una cuarta entrada.</li></ol></section><section><span className="section-code">QUÉ HACER EN CADA CASO</span><div className="scenario-list"><div><b>Antes de E1</b><p>No perseguir el precio. Esperar que llegue al nivel o recalcular si cambia la estructura.</p></div><div><b>Activa E1</b><p>Usar solo su asignación. E2 y E3 siguen pendientes, no se anticipan.</p></div><div><b>Activa E2 o E3</b><p>Promediar únicamente si el sesgo y la invalidación siguen vigentes. El promedio nuevo aparece en cada tarjeta.</p></div><div><b>Llega al target</b><p>La salida está colocada antes del muro objetivo. Evita exigir que el precio toque exactamente el máximo de la zona.</p></div><div className="danger"><b>Toca invalidación</b><p>Cancelar entradas restantes y descartar el plan. Esperar un análisis nuevo antes de volver a operar.</p></div></div></section></div>
        </section>

        <section className="execution-panel">
          <div className="panel-heading"><div><span className="section-code">05 / EXECUTION ENGINE · {data.executionTimeframe.toUpperCase()}</span><h2>{data.direction === 'NEUTRAL' ? `Plan ${data.executionTimeframe} condicional — esperar confirmación` : `Entradas y salida operativa para ${data.executionTimeframe}`}</h2></div><div className="capital-readout"><small>CAPITAL ASIGNADO</small><b>{money(data.capital)} USDT</b></div></div>
          {data.direction === 'NEUTRAL' && <div className="neutral-note">La confianza actual no habilita una ejecución inmediata. Los niveles se muestran para preparar el escenario.</div>}
          <div className="selection-rule"><b>CRITERIO · LIQUIDEZ COMPUESTA</b><span>Las entradas no dependen solo del snapshot. Se priorizan confluencias entre nodos históricos 4h/1d, liquidaciones estimadas, EMA 200 de 4h y muros visibles. Así aparecen también las zonas estructurales lejanas que ves en un mapa de liquidez.</span></div>
          <div className="entry-grid">{data.entries.map((entry, index) => {
            const movementFromSpot = (entry.price - data.spotPrice) / data.spotPrice * 100;
            const profitToTarget = isLongPlan ? (data.target - entry.averageAfter) / entry.averageAfter * 100 : (entry.averageAfter - data.target) / entry.averageAfter * 100;
            return <article className={`entry-card entry-${index + 1}`} key={entry.name}><header><span>{entry.name}</span><small>{index === 0 ? 'ENTRADA INICIAL' : index === 1 ? 'PROMEDIACIÓN' : 'ENTRADA PROFUNDA'}</small><b>{money(entry.price)}</b><div className="entry-confidence"><span>CONFIANZA RELATIVA · {entry.confirmations} CONFIRMACIONES</span><strong>{entry.confidence}%</strong><i><em style={{ width: `${entry.confidence}%` }} /></i></div></header><div className="entry-zone"><span>ZONA OPERATIVA</span><b>{money(entry.zoneLow)} — {money(entry.zoneHigh)}</b><small>Orden sugerida: {money(entry.price)}</small></div><div className="entry-metrics"><span><small>ASIGNACIÓN</small><b>{entry.allocationPct.toFixed(0)}% · {money(entry.allocationValue)}</b></span><span><small>MOVIMIENTO DESDE SPOT</small><b className="movement-value">{pct(movementFromSpot)}</b></span><span><small>PROMEDIO RESULTANTE</small><b>{money(entry.averageAfter)}</b></span><span><small>PROFIT HASTA TARGET</small><b className="profit-value">{pct(profitToTarget)}</b></span></div><p>{entry.reason}</p><div className="entry-evidence">{entry.evidence.map((item) => <span key={item}>✓ {item}</span>)}</div></article>;
          })}</div>
          <div className="case-breakdown"><div className="case-heading"><span className="section-code">ESCENARIOS DE EJECUCIÓN</span><b>Qué pasa según cuántas compras se activen</b></div><div className="case-grid">{data.entries.map((entry, index) => {
            const activeEntries = data.entries.slice(0, index + 1);
            const capitalUsed = activeEntries.reduce((sum, item) => sum + item.allocationValue, 0);
            const capitalPct = activeEntries.reduce((sum, item) => sum + item.allocationPct, 0);
            const reboundToBreakeven = isLongPlan ? (entry.averageAfter - entry.price) / entry.price * 100 : (entry.price - entry.averageAfter) / entry.price * 100;
            const profitToTarget = isLongPlan ? (data.target - entry.averageAfter) / entry.averageAfter * 100 : (entry.averageAfter - data.target) / entry.averageAfter * 100;
            const estimatedProfit = capitalUsed * Math.max(0, profitToTarget) / 100;
            return <article key={`case-${entry.name}`}><header><span>CASO {index + 1}</span><b>{index === 0 ? 'Solo activa E1' : `Activa E1 hasta ${entry.name}`}</b></header><div><span><small>CAPITAL UTILIZADO</small><b>{capitalPct.toFixed(0)}% · {money(capitalUsed)}</b></span><span><small>PROMEDIO</small><b>{money(entry.averageAfter)}</b></span><span><small>REBOTE A B/E</small><b>{pct(Math.max(0, reboundToBreakeven))}</b></span><span className="case-profit"><small>RECORRIDO AL TARGET</small><b>{pct(profitToTarget)}</b><em>Profit bruto est. {money(estimatedProfit)}</em></span></div></article>;
          })}</div><p className="case-footnote">Los porcentajes y el profit estimado no incluyen comisiones, slippage, funding ni impuestos.</p></div>
          <div className="trade-kpis"><div><small>PROMEDIO FINAL</small><strong>{money(average)}</strong></div><div className="target"><small>TARGET EXACTO</small><strong>{money(data.target)}</strong><span>Spot {pct((data.target - data.spotPrice) / data.spotPrice * 100)} · Profit {pct(resultFromAverage(data.target))}</span></div><div className="stop"><small>INVALIDACIÓN</small><strong>{money(data.invalidation)}</strong><span>Spot {pct((data.invalidation - data.spotPrice) / data.spotPrice * 100)} · Riesgo {pct(resultFromAverage(data.invalidation))}</span></div><div><small>R:R</small><strong>{data.riskReward.toFixed(2)}</strong></div><div><small>REBOTE A B/E</small><strong>{data.breakevenReboundPct.toFixed(2)}%</strong><span>Desde {data.entries.at(-1)?.name || 'la entrada'}</span></div><div><small>REBOTE A TP</small><strong>{data.targetReboundPct.toFixed(2)}%</strong><span>Desde {data.entries.at(-1)?.name || 'la entrada'}</span></div></div>
        </section>

        <section className="liquidity-panel-pro">
          <div className="panel-heading"><div><span className="section-code">06 / MAPA DE LIQUIDEZ GLOBAL</span><h2>Los muros más grandes del snapshot</h2></div><div className="book-coverage"><b>{nf.format(data.orderBookCoverage.bidLevels)} + {nf.format(data.orderBookCoverage.askLevels)}</b><span>niveles recibidos</span><small>Cobertura real: {pct(data.orderBookCoverage.bidDistancePct)} abajo · {pct(data.orderBookCoverage.askDistancePct)} arriba</small></div></div>
          <div className="liquidity-columns"><LiquidityColumn title="DEMANDA · BIDS" clusters={bids} max={maxLiquidity} spot={data.spotPrice} stats={wallStats} /><LiquidityColumn title="OFERTA · ASKS" clusters={asks} max={maxLiquidity} spot={data.spotPrice} stats={wallStats} /></div>
          <div className="macro-radar"><header><div><b>RADAR MACRO DE LIQUIDEZ</b><span>Mayores nodos históricos de volumen · 4h y 1d</span></div><small>COMPLEMENTA EL LÍMITE DEL LIBRO ACTUAL</small></header><div className="macro-zone-grid">{data.macroLiquidityZones.slice(0, 10).map((zone, index) => <div className={`macro-zone ${zone.side}`} key={`${zone.timeframe}-${zone.executionPrice}`}><span>{String(index + 1).padStart(2, '0')}</span><div><b>{money(zone.executionPrice)}</b><small>{nf.format(zone.low)} — {nf.format(zone.high)}</small></div><strong>{pct(zone.distancePct)}</strong><div><b>{zone.score.toFixed(1)}×</b><small>{zone.timeframe} · {zone.touchCount} velas</small></div></div>)}</div></div>
          <p className="source-note">El ranking examina todos los niveles que Binance entrega en su snapshot público y muestra arriba sus límites reales. Binance no permite paginar más allá de esa fotografía, por lo que no se presenta como “libro completo”. El radar macro agrega zonas lejanas históricas de 4h y 1d; no son órdenes actualmente en espera.</p>
        </section>

        <section className="structure-panel">
          <div className="panel-heading"><div><span className="section-code">07 / ESTRUCTURA MULTI-TIMEFRAME</span><h2>Confirmación técnica</h2></div><span className="indicator-list">EMA 10/55/200 · RSI · MACD · BOLLINGER</span></div>
          <div className="table-wrap"><table><thead><tr><th>Marco</th><th>Lectura</th><th>Estructura</th><th>EMA 10</th><th>EMA 55</th><th>EMA 200</th><th>RSI</th><th>MACD vs señal</th><th>Bollinger</th></tr></thead><tbody>{data.timeframes.map((frame) => { const frameStructure = data.structure.find((item) => item.timeframe === frame.timeframe); return <tr key={frame.timeframe}><td><b>{frame.timeframe}</b></td><td><span className={`trend ${frame.trend.toLowerCase()}`}>{trendText[frame.trend]}</span></td><td>{frameStructure ? structureText[frameStructure.state] : 'N/D'}</td><td>{nf.format(frame.ema10)}</td><td>{nf.format(frame.ema55)}</td><td>{nf.format(frame.ema200)}</td><td>{frame.rsi.toFixed(1)}</td><td className={frame.macd > frame.macdSignal ? 'positive' : 'negative'}>{frame.macd > frame.macdSignal ? '▲' : '▼'} {nf.format(frame.macd)}</td><td>{nf.format(frame.bollingerLower)} — {nf.format(frame.bollingerUpper)}</td></tr>; })}</tbody></table></div>
        </section>

        <section className="assumptions"><button className="assumption-head" onClick={() => setExpanded(expanded === 'method' ? null : 'method')}><span><b>Metodología, supuestos y límites</b><small>Transparencia del modelo antes de operar</small></span><i>{expanded === 'method' ? '−' : '+'}</i></button>{expanded === 'method' && <ul>{data.limitations.map((item) => <li key={item}>{item}</li>)}<li>La profundidad máxima pública consultada es de 5.000 niveles por lado; “global” significa todo ese tramo visible, no órdenes privadas o fuera de la respuesta.</li><li>La consola se recalcula cada 30 segundos y conserva persistencia de muros durante 7 días en este dispositivo.</li></ul>}</section>
      </>}
    </section>

    {settingsOpen && <div className="modal-backdrop" onMouseDown={() => setSettingsOpen(false)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setSettingsOpen(false)}>×</button><span className="section-code">GESTIÓN DE CAPITAL Y RIESGO</span><h2 id="settings-title">Configurar ejecución</h2><label>Capital total · USDT<input type="number" inputMode="decimal" min="100" value={draftCapital} onChange={(event) => setDraftCapital(event.target.value)} placeholder="Ejemplo: 700" /></label><small className="field-help">Podés borrar el valor completo y escribir uno nuevo. Mínimo operativo: 100 USDT.</small><div className="allocation-fields">{draftAllocations.map((value, index) => <label key={index}>E{index + 1} · %<input type="number" min="0" max="100" value={value} onChange={(event) => setDraftAllocations((current) => current.map((item, itemIndex) => itemIndex === index ? Math.max(0, Number(event.target.value)) : item))} /></label>)}</div><p className={draftTotal === 100 ? 'valid-total' : 'invalid-total'}>Total: {draftTotal}% {draftTotal !== 100 && '· Se normalizará proporcionalmente a 100%.'}</p><div className="risk-fields"><label>Riesgo máximo · % cuenta<input type="number" min="0.1" max="20" step="0.1" value={draftRisk.riskPct} onChange={(event) => setDraftRisk((current) => ({ ...current, riskPct: Math.max(0.1, Number(event.target.value)) }))} /></label><label>Apalancamiento<input type="number" min="1" max="125" step="1" value={draftRisk.leverage} onChange={(event) => setDraftRisk((current) => ({ ...current, leverage: Math.max(1, Number(event.target.value)) }))} /></label><label>Comisión · % por lado<input type="number" min="0" max="2" step="0.01" value={draftRisk.feePct} onChange={(event) => setDraftRisk((current) => ({ ...current, feePct: Math.max(0, Number(event.target.value)) }))} /></label><label>Slippage · % por lado<input type="number" min="0" max="5" step="0.01" value={draftRisk.slippagePct} onChange={(event) => setDraftRisk((current) => ({ ...current, slippagePct: Math.max(0, Number(event.target.value)) }))} /></label><label>Límite de pérdida diaria · %<input type="number" min="0.5" max="30" step="0.5" value={draftRisk.dailyLossPct} onChange={(event) => setDraftRisk((current) => ({ ...current, dailyLossPct: Math.max(0.5, Number(event.target.value)) }))} /></label></div><button className="refresh-button modal-apply" onClick={applySettings}>Aplicar y recalcular</button></section></div>}
  </main>;
}

function LiquidityColumn({ title, clusters, max, spot, stats }: { title: string; clusters: LiquidityCluster[]; max: number; spot: number; stats: Map<string, { count: number; changePct: number }> }) {
  return <div className="liquidity-column"><header><span>{title}</span><small>PRECIO · DISTANCIA · NOCIONAL</small></header>{clusters.map((cluster, index) => { const wall = stats.get(wallKey(cluster, spot)) || { count: 1, changePct: 0 }; const quality = wall.count < 2 ? 'nuevo / sin confirmar' : wall.changePct > 20 ? `creciendo ${pct(wall.changePct, 0)}` : wall.changePct < -20 ? `retirándose ${pct(wall.changePct, 0)}` : 'persistente / estable'; return <div className={`wall-row ${cluster.side}`} key={`${cluster.side}-${cluster.executionPrice}`}><span className="wall-rank">{String(index + 1).padStart(2, '0')}</span><div className="wall-bar"><i style={{ width: `${Math.max(3, cluster.notional / max * 100)}%` }} /></div><div className="wall-price"><b>{money(cluster.executionPrice)}</b><small>{nf.format(cluster.low)} — {nf.format(cluster.high)}</small></div><span className="wall-distance">{pct(cluster.distancePct)}</span><div className="wall-size"><b>{compact.format(cluster.notional)} USDT</b><small>{cluster.strength.toFixed(1)}× · {quality} · visto {wall.count}×</small></div></div>; })}</div>;
}
