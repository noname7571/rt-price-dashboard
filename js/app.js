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
    // Apply saved theme to chart (charts are always created with dark defaults)
    chart.applyTheme(document.documentElement.getAttribute('data-theme') !== 'light');

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
    bindThemeToggle(chart);
    bindFullscreen();
    bindKeyboardShortcuts(streams, chart);
    bindSortBar();
    initWatchlist();
    bindViewToggle(streams, chart);
    bindMultiTF(streams, chart);
    bindCorrelationModal();
    bindAlertsModal();
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

  function bindThemeToggle(chart) {
    document.getElementById('themeToggleBtn')?.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      const next    = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem(THEME_KEY, next);
      chart?.applyTheme(next === 'dark');
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

  // ─────────────────────────────────────────────────
  //  Custom watchlist — drag-to-reorder + pin
  // ─────────────────────────────────────────────────

  const WATCHLIST_KEY = 'rt-dashboard-watchlist';

  function _loadWatchlist() {
    try { return JSON.parse(localStorage.getItem(WATCHLIST_KEY)) || {}; }
    catch { return {}; }
  }

  function _saveWatchlist() {
    const list   = document.getElementById('tickerList');
    const order  = [];
    const pinned = [];
    list?.querySelectorAll('.ticker-card').forEach(card => {
      const sym = card.dataset.symbol;
      if (sym) {
        order.push(sym);
        if (card.classList.contains('ticker-card--pinned')) pinned.push(sym);
      }
    });
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify({ order, pinned }));
  }

  function initWatchlist() {
    const list = document.getElementById('tickerList');
    if (!list) return;

    const saved = _loadWatchlist();

    // Inject pin button + make each card draggable
    list.querySelectorAll('.ticker-card').forEach(card => {
      card.setAttribute('draggable', 'true');

      // Pin button — inserted after .ticker-card__change
      const pin = document.createElement('button');
      pin.className = 'ticker-card__pin';
      pin.setAttribute('aria-label', `Pin ${(card.dataset.symbol || '').replace('usdt','').toUpperCase()}`);
      pin.setAttribute('aria-pressed', 'false');
      pin.title = 'Pin / unpin card';
      pin.type  = 'button';
      pin.innerHTML =
        `<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">`
        + `<path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/>`
        + `</svg>`;

      pin.addEventListener('click', (e) => {
        e.stopPropagation();       // don't trigger card click / symbol switch
        const isPinned = card.classList.toggle('ticker-card--pinned');
        pin.setAttribute('aria-pressed', isPinned ? 'true' : 'false');
        _saveWatchlist();
      });

      const header = card.querySelector('.ticker-card__header');
      if (header) header.appendChild(pin);

      // Restore pinned state
      if (saved.pinned?.includes(card.dataset.symbol)) {
        card.classList.add('ticker-card--pinned');
        pin.setAttribute('aria-pressed', 'true');
      }
    });

    // Restore saved order
    if (saved.order?.length) {
      saved.order.forEach(sym => {
        const card = list.querySelector(`[data-symbol="${sym}"]`);
        if (card) list.appendChild(card);
      });
    }

    _bindDragAndDrop(list);
  }

  function _bindDragAndDrop(list) {
    let dragged = null;

    list.addEventListener('dragstart', (e) => {
      const card = e.target.closest('.ticker-card');
      if (!card) return;
      dragged = card;
      // Small timeout so the snapshot doesn't show the dragging style
      requestAnimationFrame(() => card.classList.add('ticker-card--dragging'));
      e.dataTransfer.effectAllowed = 'move';
    });

    list.addEventListener('dragend', () => {
      if (dragged) dragged.classList.remove('ticker-card--dragging');
      list.querySelectorAll('.ticker-card--drag-over')
          .forEach(c => c.classList.remove('ticker-card--drag-over'));
      dragged = null;
      _saveWatchlist();
    });

    list.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const target = e.target.closest('.ticker-card');
      if (!target || target === dragged) return;
      list.querySelectorAll('.ticker-card--drag-over')
          .forEach(c => c.classList.remove('ticker-card--drag-over'));
      target.classList.add('ticker-card--drag-over');
    });

    list.addEventListener('dragleave', (e) => {
      if (!list.contains(e.relatedTarget)) {
        list.querySelectorAll('.ticker-card--drag-over')
            .forEach(c => c.classList.remove('ticker-card--drag-over'));
      }
    });

    list.addEventListener('drop', (e) => {
      e.preventDefault();
      const target = e.target.closest('.ticker-card');
      target?.classList.remove('ticker-card--drag-over');
      if (!target || target === dragged || !dragged) return;

      const all       = Array.from(list.querySelectorAll('.ticker-card'));
      const dragIdx   = all.indexOf(dragged);
      const targetIdx = all.indexOf(target);

      if (dragIdx < targetIdx) {
        list.insertBefore(dragged, target.nextElementSibling);
      } else {
        list.insertBefore(dragged, target);
      }
    });
  }

  // ─────────────────────────────────────────────────
  //  Heatmap view
  // ─────────────────────────────────────────────────

  function changeToHeatColor(pct) {
    if (pct <= -10) return '#7f1d1d';
    if (pct <=  -5) return '#991b1b';
    if (pct <=  -2) return '#b91c1c';
    if (pct <    0) return '#ef4444';
    if (pct ===  0) return '#374151';
    if (pct <    2) return '#16a34a';
    if (pct <    5) return '#15803d';
    if (pct <   10) return '#166534';
    return '#14532d';
  }

  function renderHeatmap(streams, chart) {
    const panel = document.getElementById('heatmapPanel');
    if (!panel) return;
    panel.innerHTML = '';

    SYMBOLS.forEach(sym => {
      const data      = _tickerData[sym] || {};
      const change    = data.change !== undefined ? data.change : null;
      const price     = data.price  || 0;
      const base      = sym.replace('usdt', '').toUpperCase();
      const changeStr = change !== null
        ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`
        : '—';
      const priceStr  = price
        ? `$${price.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
        : '—';

      const tile = document.createElement('div');
      tile.className = 'heatmap-tile';
      tile.style.background = change !== null ? changeToHeatColor(change) : '#374151';
      tile.title = `${base}/USDT — click to view chart`;
      tile.innerHTML = `
        <span class="heatmap-tile__symbol">${base}</span>
        <span class="heatmap-tile__change">${changeStr}</span>
        <span class="heatmap-tile__price">${priceStr}</span>
      `;
      tile.addEventListener('click', () => {
        switchToCardsView();
        selectSymbol(sym, streams, chart);
      });
      panel.appendChild(tile);
    });
  }

  function switchToCardsView() {
    document.getElementById('tickerList')?.removeAttribute('hidden');
    document.getElementById('heatmapPanel')?.setAttribute('hidden', '');
    const viewGroup = document.getElementById('viewGroup');
    viewGroup?.querySelectorAll('.btn-group__btn').forEach(b =>
      b.classList.toggle('btn-group__btn--active', b.dataset.view === 'cards')
    );
  }

  function bindViewToggle(streams, chart) {
    const group = document.getElementById('viewGroup');
    if (!group) return;
    group.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-group__btn');
      if (!btn) return;
      const view = btn.dataset.view;
      if (!view) return;
      group.querySelectorAll('.btn-group__btn').forEach(b =>
        b.classList.toggle('btn-group__btn--active', b === btn)
      );
      if (view === 'heatmap') {
        renderHeatmap(streams, chart);
        document.getElementById('tickerList')?.setAttribute('hidden', '');
        document.getElementById('heatmapPanel')?.removeAttribute('hidden');
      } else {
        switchToCardsView();
      }
    });
  }

  // ─────────────────────────────────────────────────
  //  Multi-timeframe toggle
  // ─────────────────────────────────────────────────

  function bindMultiTF(streams, chart) {
    if (typeof MultiTF === 'undefined') return;
    const btn = document.getElementById('multitfBtn');
    if (!btn) return;

    btn.addEventListener('click', () => {
      if (MultiTF.isOpen()) {
        MultiTF.close();
        btn.classList.remove('is-active');
        btn.setAttribute('aria-pressed', 'false');
      } else {
        MultiTF.open(activeSymbol);
        btn.classList.add('is-active');
        btn.setAttribute('aria-pressed', 'true');
      }
    });
  }

  // ─────────────────────────────────────────────────
  //  Correlation matrix
  // ─────────────────────────────────────────────────

  function bindCorrelationModal() {
    if (typeof Correlation === 'undefined') return;
    const openBtn  = document.getElementById('corrBtn');
    const closeBtn = document.getElementById('corrModalClose');
    const modal    = document.getElementById('corrModal');
    if (!openBtn || !modal) return;

    openBtn.addEventListener('click', () => Correlation.open());
    closeBtn?.addEventListener('click', () => Correlation.close());
    modal.addEventListener('click', (e) => {
      if (e.target === modal) Correlation.close();
    });
  }

  // ─────────────────────────────────────────────────
  //  Price alerts modal
  // ─────────────────────────────────────────────────

  function _refreshAlertBadge() {
    const badge = document.getElementById('alertsBadge');
    if (!badge) return;
    const count = Alerts.getAll().length;
    if (count > 0) badge.removeAttribute('hidden');
    else           badge.setAttribute('hidden', '');
  }

  function _refreshAlertList() {
    const list = document.getElementById('alertList');
    if (!list) return;
    const alerts = Alerts.getAll();

    if (alerts.length === 0) {
      list.innerHTML = '<p class="alert-list__empty">No alerts set.</p>';
      return;
    }

    list.innerHTML = '';
    alerts.forEach(alert => {
      const base     = alert.symbol.replace('usdt', '').toUpperCase();
      const dirLabel = alert.direction === 'above' ? '▲ above' : '▼ below';
      const item     = document.createElement('div');
      item.className = 'alert-item';
      item.innerHTML = `
        <div class="alert-item__info">
          <span class="alert-item__label">${base}/USDT</span>
          <span class="alert-item__sub">${dirLabel} $${Number(alert.price).toLocaleString('en-US', { maximumFractionDigits: 6 })}</span>
        </div>
        <button class="alert-item__remove" data-id="${alert.id}" aria-label="Remove alert">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      `;
      item.querySelector('.alert-item__remove').addEventListener('click', () => {
        Alerts.remove(alert.id);
        _refreshAlertList();
        _refreshAlertBadge();
      });
      list.appendChild(item);
    });
  }

  function bindAlertsModal() {
    if (typeof Alerts === 'undefined') return;

    const modal      = document.getElementById('alertModal');
    const openBtn    = document.getElementById('alertsBtn');
    const closeBtn   = document.getElementById('alertModalClose');
    const form       = document.getElementById('alertForm');
    const dirGroup   = document.getElementById('alertDirGroup');
    const priceInput = document.getElementById('alertPriceInput');
    const hint       = document.getElementById('alertFormHint');

    if (!modal || !openBtn) return;

    // Track selected direction
    let selectedDir = 'above';
    dirGroup?.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-group__btn');
      if (!btn || !btn.dataset.dir) return;
      selectedDir = btn.dataset.dir;
      dirGroup.querySelectorAll('.btn-group__btn').forEach(b =>
        b.classList.toggle('btn-group__btn--active', b === btn)
      );
    });

    // Open modal
    openBtn.addEventListener('click', async () => {
      // Request notification permission on first open
      if (Notification?.permission === 'default') {
        const granted = await Alerts.requestPermission();
        if (hint) {
          hint.className = 'alert-form__hint' + (granted ? '' : ' alert-form__hint--error');
          hint.textContent = granted
            ? 'Notifications enabled.'
            : 'Notifications blocked — alerts will be silent.';
          setTimeout(() => { if (hint) hint.textContent = ''; }, 3000);
        }
      }
      _refreshAlertList();
      modal.showModal?.() || modal.setAttribute('open', '');
    });

    // Close modal
    closeBtn?.addEventListener('click', () => modal.close?.() || modal.removeAttribute('open'));
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.close?.() || modal.removeAttribute('open');
    });

    // Submit form
    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      const symbol = document.getElementById('alertSymbolSelect')?.value;
      const price  = parseFloat(priceInput?.value);
      if (!symbol || isNaN(price) || price <= 0) {
        if (hint) { hint.className = 'alert-form__hint alert-form__hint--error'; hint.textContent = 'Enter a valid price.'; }
        return;
      }
      Alerts.add(symbol, price, selectedDir);
      priceInput.value = '';
      if (hint) { hint.className = 'alert-form__hint'; hint.textContent = 'Alert added!'; setTimeout(() => { if (hint) hint.textContent = ''; }, 2000); }
      _refreshAlertList();
      _refreshAlertBadge();
    });

    // Sync badge on load
    _refreshAlertBadge();
  }

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
      // Restore watchlist-saved order (falls back to SYMBOLS order)
      const saved = _loadWatchlist();
      const order = saved.order?.length ? saved.order : SYMBOLS;
      order.forEach(sym => {
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
    const price  = parseFloat(data.c);
    const change = parseFloat(data.P);
    const volume = parseFloat(data.q);

    // Cache latest values for movers sort & heatmap
    _tickerData[symbol] = { price, change, volume };

    // Check price alerts
    if (typeof Alerts !== 'undefined') Alerts.check(symbol, price);

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
    // Update multi-TF panel if it's open
    if (typeof MultiTF !== 'undefined' && MultiTF.isOpen()) MultiTF.update(symbol);
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
