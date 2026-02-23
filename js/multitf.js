/**
 * multitf.js
 * ─────────────────────────────────────────────────────
 * Multi-timeframe side-by-side panel.
 * Renders three LightweightCharts instances (1H / 4H / 1D)
 * for the currently active token.
 *
 * Public API:
 *   MultiTF.open(symbol)   → show panel, load candles
 *   MultiTF.close()        → hide panel, restore main chart view
 *   MultiTF.update(symbol) → reload candles for new symbol (if open)
 *   MultiTF.isOpen()       → boolean
 * ─────────────────────────────────────────────────────
 */

const MultiTF = (function () {
  'use strict';

  const TFS = [
    { key: '1h', label: '1H',   limit: 100 },
    { key: '4h', label: '4H',   limit: 100 },
    { key: '1d', label: '1D',   limit: 100 },
  ];

  let _initialized = false;
  let _open        = false;
  const _charts    = {};  // key → LightweightCharts chart instance
  const _series    = {};  // key → candlestick series

  // ──────────── Data ────────────

  async function _fetchCandles(symbol, interval, limit) {
    const url = `https://api.binance.com/api/v3/klines`
              + `?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${limit}`;
    const res  = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.map(c => ({
      time:  Math.floor(parseInt(c[0]) / 1000),
      open:  parseFloat(c[1]),
      high:  parseFloat(c[2]),
      low:   parseFloat(c[3]),
      close: parseFloat(c[4]),
    }));
  }

  async function _loadAll(symbol) {
    await Promise.all(TFS.map(async ({ key, limit }) => {
      try {
        const candles = await _fetchCandles(symbol, key, limit);
        _series[key]?.setData(candles);
        _charts[key]?.timeScale().fitContent();
      } catch (e) {
        console.warn(`[MultiTF] Failed to load ${key} for ${symbol}:`, e);
      }
    }));
  }

  // ──────────── Chart creation ────────────

  function _resolveTheme() {
    return document.documentElement.getAttribute('data-theme') === 'light'
      ? { bg: '#f8fafc', grid: '#e2e8f0', text: '#475569', border: '#cbd5e1' }
      : { bg: 'transparent', grid: '#1e293b', text: '#9ca3af', border: '#1e2d3d' };
  }

  function _createCharts() {
    if (_initialized) return;
    _initialized = true;

    const theme = _resolveTheme();

    TFS.forEach(({ key }) => {
      const container = document.getElementById(`mtf-canvas-${key}`);
      if (!container) return;

      const chart = LightweightCharts.createChart(container, {
        layout: {
          background: { type: 'solid', color: theme.bg },
          textColor: theme.text,
          fontFamily: "'Inter', sans-serif",
          fontSize: 10,
        },
        grid: {
          vertLines: { color: theme.grid },
          horzLines: { color: theme.grid },
        },
        timeScale: {
          borderColor: theme.border,
          timeVisible: true,
          secondsVisible: false,
        },
        rightPriceScale: {
          borderColor: theme.border,
          scaleMargins: { top: 0.08, bottom: 0.08 },
        },
        crosshair: {
          mode: LightweightCharts.CrosshairMode.Normal,
        },
        handleScroll: true,
        handleScale: true,
      });

      const series = chart.addCandlestickSeries({
        upColor:        '#22c55e',
        downColor:      '#ef4444',
        borderUpColor:  '#22c55e',
        borderDownColor:'#ef4444',
        wickUpColor:    '#22c55e',
        wickDownColor:  '#ef4444',
      });

      _charts[key] = chart;
      _series[key] = series;

      // Auto-resize
      const ro = new ResizeObserver(() => {
        const { offsetWidth: w, offsetHeight: h } = container;
        if (w > 0 && h > 0) chart.applyOptions({ width: w, height: h });
      });
      ro.observe(container);
    });
  }

  // ──────────── Public API ────────────

  async function open(symbol) {
    const panel     = document.getElementById('multitfPanel');
    const chartsArea = document.querySelector('.charts-area');
    const ohlc      = document.getElementById('ohlcReadout');
    if (!panel) return;

    _open = true;
    panel.removeAttribute('hidden');
    if (chartsArea)  chartsArea.setAttribute('hidden', '');
    if (ohlc)        ohlc.setAttribute('hidden', '');

    _createCharts();
    await _loadAll(symbol);

    // Trigger initial resize
    TFS.forEach(({ key }) => {
      const c = document.getElementById(`mtf-canvas-${key}`);
      if (c && _charts[key]) {
        _charts[key].applyOptions({ width: c.offsetWidth, height: c.offsetHeight });
        _charts[key].timeScale().fitContent();
      }
    });
  }

  function close() {
    const panel      = document.getElementById('multitfPanel');
    const chartsArea = document.querySelector('.charts-area');
    const ohlc       = document.getElementById('ohlcReadout');

    _open = false;
    panel?.setAttribute('hidden', '');
    chartsArea?.removeAttribute('hidden');
    ohlc?.removeAttribute('hidden');
  }

  async function update(symbol) {
    if (!_open || !_initialized) return;
    await _loadAll(symbol);
  }

  function isOpen() { return _open; }

  return { open, close, update, isOpen };
})();
