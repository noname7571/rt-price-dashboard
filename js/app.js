/**
 * app.js
 * ─────────────────────────────────────────────────────
 * Entry point. Wires ChartManager, StreamManager, and UI together.
 *
 * Responsibilities:
 *  - Define the list of tracked symbols
 *  - Initialise chart, streams, and UI state
 *  - Route WebSocket callbacks to UI and chart updates
 *  - Handle user interactions (ticker card clicks, interval
 *    buttons, chart-type buttons)
 * ─────────────────────────────────────────────────────
 */

(function () {
  'use strict';

  // ─────────────────────────────────────────────────
  //  Configuration
  // ─────────────────────────────────────────────────

  const SYMBOLS          = ['btcusdt', 'ethusdt', 'solusdt', 'bnbusdt', 'xrpusdt', 'adausdt', 'dogeusdt', 'avaxusdt', 'linkusdt'];
  const DEFAULT_SYMBOL   = 'btcusdt';
  const DEFAULT_INTERVAL = '1m';
  const DEFAULT_TYPE     = 'candlestick';

  // ─────────────────────────────────────────────────
  //  State
  // ─────────────────────────────────────────────────

  let activeSymbol   = DEFAULT_SYMBOL;
  let activeInterval = DEFAULT_INTERVAL;
  let activeType     = DEFAULT_TYPE;

  // ─────────────────────────────────────────────────
  //  Bootstrap
  // ─────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', () => {
    // 0. Theme — apply before any paint
    initTheme();
    // 1. Chart — pass both container IDs
    const chart = new ChartManager('priceChart', 'volumeChart', (bar) => {
      UI.updateOHLC(bar);
    });

    // 2. Streams
    const streams = new StreamManager(
      SYMBOLS,
      handleTickerUpdate,
      (symbol, data) => handleKlineUpdate(symbol, data, chart),
      (status) => UI.setConnectionStatus(status)
    );

    // 3. Initial UI state
    UI.setActiveCard(DEFAULT_SYMBOL);
    UI.setChartSymbolLabel(DEFAULT_SYMBOL);
    UI.setActiveInterval(DEFAULT_INTERVAL);
    UI.setActiveChartType(DEFAULT_TYPE);

    // 4. Start streams (also kicks off historical candle fetch)
    streams.start(DEFAULT_SYMBOL, DEFAULT_INTERVAL);
    chart.load(DEFAULT_SYMBOL, DEFAULT_INTERVAL, DEFAULT_TYPE);

    // 5. Sparklines — fetch 24h of hourly closes for every symbol
    SYMBOLS.forEach(fetchSparkline);

    // 6. Fear & Greed index (refreshes every 5 min)
    fetchFearGreed();
    setInterval(fetchFearGreed, 5 * 60 * 1000);

    // 7. Bind user interactions
    bindTickerCards(streams, chart);
    bindIntervalButtons(streams, chart);
    bindChartTypeButtons(chart);
    bindThemeToggle();
    bindFullscreen();
    bindKeyboardShortcuts(streams, chart);
    bindSortBar();
    bindTutorial();
    bindTipBanner();
  });

  // ─────────────────────────────────────────────────
  //  Fear & Greed index
  // ─────────────────────────────────────────────────

  async function fetchFearGreed() {
    try {
      const res  = await fetch('https://api.alternative.me/fng/?limit=1');
      const json = await res.json();
      const item = json?.data?.[0];
      if (!item) return;

      const value = parseInt(item.value, 10);
      const classification = item.value_classification; // e.g. 'Fear'

      const sentiment =
        value <= 24 ? 'extreme-fear' :
        value <= 49 ? 'fear'         :
        value === 50 ? 'neutral'     :
        value <= 74 ? 'greed'        : 'extreme-greed';

      const widget = document.getElementById('fearGreedWidget');
      if (widget) {
        widget.setAttribute('data-sentiment', sentiment);
        widget.title = `Fear & Greed Index: ${value} — ${classification}`;
      }
      const valEl   = document.getElementById('fearGreedValue');
      const classEl = document.getElementById('fearGreedClass');
      if (valEl)   valEl.textContent   = value;
      if (classEl) classEl.textContent = classification;
    } catch (e) {
      console.warn('[FearGreed] Failed to fetch:', e);
    }
  }

  // ─────────────────────────────────────────────────
  //  Theme toggle
  // ─────────────────────────────────────────────────

  const THEME_KEY = 'rt-dashboard-theme';

  function initTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    // Also respect prefers-color-scheme if no saved preference
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = saved || (prefersDark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
  }

  function bindThemeToggle() {
    document.getElementById('themeToggleBtn')?.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      const next    = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem(THEME_KEY, next);
    });
  }

  // ─────────────────────────────────────────────────
  //  Fullscreen
  // ─────────────────────────────────────────────────

  function bindFullscreen() {
    const chartPanel = document.querySelector('.chart-panel');
    document.getElementById('fullscreenBtn')?.addEventListener('click', toggleFullscreen);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey &&
          document.activeElement.tagName !== 'INPUT') {
        toggleFullscreen();
      }
    });
    function toggleFullscreen() {
      chartPanel?.classList.toggle('is-fullscreen');
    }
  }

  // ─────────────────────────────────────────────────
  //  Sparkline fetch
  // ─────────────────────────────────────────────────

  async function fetchSparkline(symbol) {
    try {
      const url = `https://api.binance.com/api/v3/klines?symbol=${symbol.toUpperCase()}&interval=1h&limit=24`;
      const res  = await fetch(url);
      const data = await res.json();
      const prices = data.map(c => parseFloat(c[4])); // close prices
      UI.drawSparkline(symbol, prices);
    } catch (e) {
      console.warn('[sparkline] Failed for', symbol, e);
    }
  }

  // ─────────────────────────────────────────────────
  //  Movers sort
  // ─────────────────────────────────────────────────

  // Last-known ticker data per symbol — populated by handleTickerUpdate
  const _tickerData = {};

  function bindSortBar() {
    const group = document.getElementById('sortGroup');
    if (!group) return;
    group.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-group__btn');
      if (!btn) return;
      const sort = btn.dataset.sort;
      if (!sort) return;
      group.querySelectorAll('.btn-group__btn').forEach(b =>
        b.classList.toggle('btn-group__btn--active', b === btn)
      );
      sortTickerCards(sort);
    });
  }

  function sortTickerCards(sort) {
    const list = document.getElementById('tickerList');
    if (!list) return;

    const cards = Array.from(list.querySelectorAll('.ticker-card'));
    if (sort === 'default') {
      // Restore original SYMBOLS order
      SYMBOLS.forEach(sym => {
        const card = list.querySelector(`[data-symbol="${sym}"]`);
        if (card) list.appendChild(card);
      });
      return;
    }

    cards.sort((a, b) => {
      const da = _tickerData[a.dataset.symbol] || {};
      const db = _tickerData[b.dataset.symbol] || {};
      if (sort === 'change')  return (db.change  || 0) - (da.change  || 0);
      if (sort === 'volume')  return (db.volume  || 0) - (da.volume  || 0);
      if (sort === 'price')   return (db.price   || 0) - (da.price   || 0);
      return 0;
    });
    cards.forEach(card => list.appendChild(card));
  }

  // ─────────────────────────────────────────────────
  //  Stream callbacks
  // ─────────────────────────────────────────────────

  function handleTickerUpdate(symbol, data) {
    // Cache latest values for movers sort
    _tickerData[symbol] = {
      price:  parseFloat(data.c),
      change: parseFloat(data.P),
      volume: parseFloat(data.q),
    };
    UI.updateTickerCard(symbol, data);
  }

  function handleKlineUpdate(symbol, data, chart) {
    // Only feed live candles into chart for the active symbol
    if (symbol !== activeSymbol) return;
    chart.updateCandle(data);
  }

  // ─────────────────────────────────────────────────
  //  User interaction — ticker cards
  // ─────────────────────────────────────────────────

  function bindTickerCards(streams, chart) {
    const list = document.getElementById('tickerList');
    if (!list) return;

    list.addEventListener('click', (e) => {
      const card = e.target.closest('.ticker-card');
      if (!card) return;

      const symbol = card.dataset.symbol;
      if (!symbol || symbol === activeSymbol) return;

      activeSymbol = symbol;

      // UI
      UI.setActiveCard(symbol);
      UI.setChartSymbolLabel(symbol);
      UI.updateOHLC(null);

      // Switch kline stream + reload chart history
      streams.switchKline(symbol, activeInterval);
      chart.load(symbol, activeInterval, activeType);
    });
  }

  // ─────────────────────────────────────────────────
  //  User interaction — interval buttons
  // ─────────────────────────────────────────────────

  function bindIntervalButtons(streams, chart) {
    const group = document.getElementById('intervalGroup');
    if (!group) return;

    group.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-group__btn');
      if (!btn) return;

      const interval = btn.dataset.interval;
      if (!interval || interval === activeInterval) return;

      activeInterval = interval;

      UI.setActiveInterval(interval);
      UI.setActiveChartType(activeType); // re-sync label
      UI.updateOHLC(null);

      streams.switchKline(activeSymbol, interval);
      chart.load(activeSymbol, interval, activeType);
    });
  }

  // ─────────────────────────────────────────────────
  //  User interaction — chart type buttons
  // ─────────────────────────────────────────────────

  function bindChartTypeButtons(chart) {
    const group = document.getElementById('chartTypeGroup');
    if (!group) return;

    group.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-group__btn');
      if (!btn) return;

      const type = btn.dataset.type;
      if (!type || type === activeType) return;

      activeType = type;

      UI.setActiveChartType(type);
      chart.setSeriesType(type);
    });
  }

  // ─────────────────────────────────────────────────
  //  Keyboard shortcuts
  // ─────────────────────────────────────────────────

  const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'];

  function bindKeyboardShortcuts(streams, chart) {
    document.addEventListener('keydown', (e) => {
      // Ignore when typing in inputs
      if (document.activeElement.tagName === 'INPUT' ||
          document.activeElement.tagName === 'TEXTAREA') return;
      // Ignore modifier combos
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      switch (e.key) {
        // j / ArrowRight — next token
        case 'j':
        case 'ArrowRight': {
          const idx = SYMBOLS.indexOf(activeSymbol);
          const next = SYMBOLS[(idx + 1) % SYMBOLS.length];
          selectSymbol(next, streams, chart);
          break;
        }
        // k / ArrowLeft — prev token
        case 'k':
        case 'ArrowLeft': {
          const idx = SYMBOLS.indexOf(activeSymbol);
          const prev = SYMBOLS[(idx - 1 + SYMBOLS.length) % SYMBOLS.length];
          selectSymbol(prev, streams, chart);
          break;
        }
        // 1–6 — switch interval
        case '1': selectInterval('1m',  streams, chart); break;
        case '2': selectInterval('5m',  streams, chart); break;
        case '3': selectInterval('15m', streams, chart); break;
        case '4': selectInterval('1h',  streams, chart); break;
        case '5': selectInterval('4h',  streams, chart); break;
        case '6': selectInterval('1d',  streams, chart); break;
        // c — toggle chart type
        case 'c': {
          const next = activeType === 'candlestick' ? 'line' : 'candlestick';
          activeType = next;
          UI.setActiveChartType(next);
          chart.setSeriesType(next);
          break;
        }
        // ? — open tutorial
        case '?':
          document.getElementById('helpBtn')?.click();
          break;
      }
    });
  }

  /** Shared helper — switch active symbol (used by clicks AND keyboard). */
  function selectSymbol(symbol, streams, chart) {
    if (symbol === activeSymbol) return;
    activeSymbol = symbol;
    UI.setActiveCard(symbol);
    UI.setChartSymbolLabel(symbol);
    UI.updateOHLC(null);
    streams.switchKline(symbol, activeInterval);
    chart.load(symbol, activeInterval, activeType);
  }

  /** Shared helper — switch interval. */
  function selectInterval(interval, streams, chart) {
    if (interval === activeInterval) return;
    activeInterval = interval;
    UI.setActiveInterval(interval);
    UI.setActiveChartType(activeType); // re-sync label suffix
    UI.updateOHLC(null);
    streams.switchKline(activeSymbol, interval);
    chart.load(activeSymbol, interval, activeType);
  }

  // ─────────────────────────────────────────────────
  //  Tutorial modal
  // ─────────────────────────────────────────────────

  function openTutorial() {
    const overlay = document.getElementById('tutorialOverlay');
    if (overlay) {
      overlay.hidden = false;
      // trap focus on close button
      const closeBtn = document.getElementById('tutorialClose');
      if (closeBtn) closeBtn.focus();
    }
  }

  function closeTutorial() {
    const overlay = document.getElementById('tutorialOverlay');
    if (overlay) overlay.hidden = true;
  }

  function bindTutorial() {
    document.getElementById('helpBtn')     ?.addEventListener('click',  openTutorial);
    document.getElementById('tutorialClose')?.addEventListener('click', closeTutorial);
    document.getElementById('tutorialOk')  ?.addEventListener('click', closeTutorial);

    // Close on overlay backdrop click
    document.getElementById('tutorialOverlay')?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeTutorial();
    });

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeTutorial();
    });
  }

  // ─────────────────────────────────────────────────
  //  First-visit tip banner
  // ─────────────────────────────────────────────────

  const TIP_STORAGE_KEY = 'rt-dashboard-tip-dismissed';

  function bindTipBanner() {
    const banner = document.getElementById('tipBanner');
    if (!banner) return;

    // Hide immediately if already dismissed
    if (localStorage.getItem(TIP_STORAGE_KEY)) {
      banner.classList.add('is-hidden');
      return;
    }

    document.getElementById('tipDismiss')?.addEventListener('click', () => {
      banner.classList.add('is-hidden');
      localStorage.setItem(TIP_STORAGE_KEY, '1');
    });

    document.getElementById('tipLearnMore')?.addEventListener('click', () => {
      banner.classList.add('is-hidden');
      localStorage.setItem(TIP_STORAGE_KEY, '1');
      openTutorial();
    });
  }

})();
