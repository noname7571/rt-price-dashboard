/**
 * ui.js
 * ─────────────────────────────────────────────────────
 * Pure DOM helpers — no state, no network.
 *
 * Exports a single `UI` namespace with functions for:
 *  - Updating ticker card prices/stats
 *  - Flashing price elements on change
 *  - Updating the connection badge
 *  - Updating the OHLC readout bar
 *  - Marking the active ticker card
 *  - Marking the active interval / chart-type button
 * ─────────────────────────────────────────────────────
 */

const UI = (() => {

  // ─────────────────────────────────────────────────
  //  Formatters
  // ─────────────────────────────────────────────────

  /** Format a price value with appropriate decimal places. */
  function formatPrice(value, symbol) {
    const num = parseFloat(value);
    if (isNaN(num)) return '—';

    // BTC: 2dp, ETH: 2dp, SOL: 2dp — adjust per asset if needed
    const decimals = num >= 1000 ? 2 : num >= 10 ? 3 : 4;
    return num.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  /** Format a percentage with sign and 2dp. */
  function formatPct(value) {
    const num = parseFloat(value);
    if (isNaN(num)) return '—';
    const sign = num >= 0 ? '+' : '';
    return `${sign}${num.toFixed(2)}%`;
  }

  /** Format a large number as compact (e.g. 1.23B, 456.7M). */
  function formatVolume(value) {
    const num = parseFloat(value);
    if (isNaN(num)) return '—';
    if (num >= 1e9) return `${(num / 1e9).toFixed(2)}B`;
    if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
    if (num >= 1e3) return `${(num / 1e3).toFixed(1)}K`;
    return num.toFixed(0);
  }

  // ─────────────────────────────────────────────────
  //  Ticker card updates
  // ─────────────────────────────────────────────────

  // Track last price per symbol for flash direction
  const _lastPrices = {};

  /**
   * Update a ticker card with fresh 24h ticker data.
   * @param {string} symbol   e.g. 'btcusdt'
   * @param {object} data     Binance @ticker payload
   */
  function updateTickerCard(symbol, data) {
    const price   = parseFloat(data.c); // current / last price
    const high    = parseFloat(data.h);
    const low     = parseFloat(data.l);
    const change  = parseFloat(data.P); // percent change
    const volume  = parseFloat(data.q); // quote asset volume (USDT)

    // Price element + flash
    const priceEl = document.getElementById(`price-${symbol}`);
    if (priceEl) {
      const prev = _lastPrices[symbol];
      const formatted = formatPrice(price);

      if (prev !== undefined && prev !== price) {
        const cls = price > prev ? 'price-flash-up' : 'price-flash-down';
        priceEl.classList.remove('price-flash-up', 'price-flash-down');
        // Force reflow to restart animation
        void priceEl.offsetWidth;
        priceEl.classList.add(cls);
      }
      priceEl.textContent = formatted;
      _lastPrices[symbol] = price;
    }

    // 24h high
    const highEl = document.getElementById(`high-${symbol}`);
    if (highEl) highEl.textContent = formatPrice(high);

    // 24h low
    const lowEl = document.getElementById(`low-${symbol}`);
    if (lowEl) lowEl.textContent = formatPrice(low);

    // Volume
    const volEl = document.getElementById(`vol-${symbol}`);
    if (volEl) volEl.textContent = formatVolume(volume);

    // % change badge
    const changeEl = document.getElementById(`change-${symbol}`);
    if (changeEl) {
      changeEl.textContent = formatPct(change);
      changeEl.className = 'ticker-card__change ' +
        (change >= 0 ? 'positive' : 'negative');
    }
  }

  // ─────────────────────────────────────────────────
  //  Active card
  // ─────────────────────────────────────────────────

  function setActiveCard(symbol) {
    document.querySelectorAll('.ticker-card').forEach((card) => {
      card.classList.toggle('ticker-card--active', card.dataset.symbol === symbol);
    });
  }

  // ─────────────────────────────────────────────────
  //  Chart symbol label
  // ─────────────────────────────────────────────────

  function setChartSymbolLabel(symbol) {
    const el = document.getElementById('chartSymbolLabel');
    if (!el) return;
    // e.g. 'btcusdt' → 'BTC/USDT'
    const base  = symbol.replace('usdt', '').toUpperCase();
    el.textContent = `${base}/USDT`;
  }

  // ─────────────────────────────────────────────────
  //  Interval & chart-type buttons
  // ─────────────────────────────────────────────────

  function setActiveInterval(interval) {
    document.querySelectorAll('#intervalGroup .btn-group__btn').forEach((btn) => {
      btn.classList.toggle('btn-group__btn--active', btn.dataset.interval === interval);
    });
    // Update the interval label in the toolbar
    const label = document.querySelector('.chart-panel__interval-label');
    if (label) label.textContent = `${interval} Candlestick`;
  }

  function setActiveChartType(type) {
    document.querySelectorAll('#chartTypeGroup .btn-group__btn').forEach((btn) => {
      btn.classList.toggle('btn-group__btn--active', btn.dataset.type === type);
    });
    // Update interval label suffix
    const label = document.querySelector('.chart-panel__interval-label');
    if (label) {
      const intervalBtn = document.querySelector('#intervalGroup .btn-group__btn--active');
      const interval = intervalBtn ? intervalBtn.dataset.interval : '';
      label.textContent = `${interval} ${type === 'line' ? 'Line' : 'Candlestick'}`;
    }
  }

  // ─────────────────────────────────────────────────
  //  Connection badge
  // ─────────────────────────────────────────────────

  function setConnectionStatus(status) {
    const badge = document.getElementById('connectionBadge');
    const label = document.getElementById('connectionLabel');
    if (!badge || !label) return;

    badge.className = 'connection-badge';

    switch (status) {
      case 'connected':
        badge.classList.add('is-connected');
        label.textContent = 'Live';
        break;
      case 'disconnected':
        label.textContent = 'Reconnecting…';
        break;
      case 'error':
        badge.classList.add('is-error');
        label.textContent = 'Error';
        break;
      default:
        label.textContent = 'Connecting…';
    }
  }

  // ─────────────────────────────────────────────────
  //  OHLC readout (crosshair data from the chart)
  // ─────────────────────────────────────────────────

  function updateOHLC(bar) {
    const fmt = (v) => (v !== undefined && v !== null)
      ? parseFloat(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })
      : '—';

    const fmtVol = (v) => {
      if (v === undefined || v === null) return '—';
      const n = parseFloat(v);
      if (isNaN(n)) return '—';
      if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
      if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
      return n.toFixed(2);
    };

    document.getElementById('ohlcO').textContent   = bar ? fmt(bar.open)    : '—';
    document.getElementById('ohlcH').textContent   = bar ? fmt(bar.high)    : '—';
    document.getElementById('ohlcL').textContent   = bar ? fmt(bar.low)     : '—';
    document.getElementById('ohlcC').textContent   = bar ? fmt(bar.close)   : '—';
    document.getElementById('ohlcVol').textContent = bar ? fmtVol(bar.volume) : '—';
  }

  // ─────────────────────────────────────────────────
  //  Public
  // ─────────────────────────────────────────────────

  return {
    updateTickerCard,
    setActiveCard,
    setChartSymbolLabel,
    setActiveInterval,
    setActiveChartType,
    setConnectionStatus,
    updateOHLC,
    formatPrice,
  };

})();
