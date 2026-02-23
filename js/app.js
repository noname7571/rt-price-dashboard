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

  const SYMBOLS          = ['btcusdt', 'ethusdt', 'solusdt'];
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

    // 5. Bind user interactions
    bindTickerCards(streams, chart);
    bindIntervalButtons(streams, chart);
    bindChartTypeButtons(chart);
    bindTutorial();
    bindTipBanner();
  });

  // ─────────────────────────────────────────────────
  //  Stream callbacks
  // ─────────────────────────────────────────────────

  function handleTickerUpdate(symbol, data) {
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
