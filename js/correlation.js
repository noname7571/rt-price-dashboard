/**
 * correlation.js
 * ─────────────────────────────────────────────────────
 * Fetch 1h close prices for all tracked symbols and render a
 * Pearson correlation matrix inside a <dialog> modal.
 *
 * Public API:
 *   Correlation.open()   → fetch data, render, show modal
 *   Correlation.close()  → close modal
 * ─────────────────────────────────────────────────────
 */

const Correlation = (function () {
  'use strict';

  const SYMBOLS = [
    'btcusdt', 'ethusdt', 'solusdt', 'bnbusdt', 'xrpusdt',
    'adausdt', 'dogeusdt', 'avaxusdt', 'linkusdt',
  ];
  const LABELS  = SYMBOLS.map(s => s.replace('usdt', '').toUpperCase());

  // ──────────── Data fetching ────────────

  async function _fetchKlines(symbol, limit = 100) {
    const url = `https://api.binance.com/api/v3/klines` +
                `?symbol=${symbol.toUpperCase()}&interval=1h&limit=${limit}`;
    const res  = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${symbol}`);
    const data = await res.json();
    return data.map(c => parseFloat(c[4])); // close prices
  }

  // ──────────── Pearson r ────────────

  function _pearson(x, y) {
    const n = Math.min(x.length, y.length);
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
    for (let i = 0; i < n; i++) {
      sumX  += x[i];
      sumY  += y[i];
      sumXY += x[i] * y[i];
      sumX2 += x[i] ** 2;
      sumY2 += y[i] ** 2;
    }
    const num = n * sumXY - sumX * sumY;
    const den = Math.sqrt((n * sumX2 - sumX ** 2) * (n * sumY2 - sumY ** 2));
    return den === 0 ? 1 : num / den;
  }

  // ──────────── Colour mapping ────────────
  // Maps Pearson r ∈ [−1, +1] to a background colour

  function _rToColor(r) {
    if (r >=  0.9) return '#14532d';
    if (r >=  0.7) return '#166534';
    if (r >=  0.5) return '#15803d';
    if (r >=  0.3) return '#16a34a';
    if (r >=  0.1) return '#4ade80';
    if (r >= -0.1) return '#374151';
    if (r >= -0.3) return '#f87171';
    if (r >= -0.5) return '#ef4444';
    if (r >= -0.7) return '#dc2626';
    return '#991b1b';
  }

  function _rToTextColor(r) {
    // Light text on dark tiles, dark text on light tiles
    return Math.abs(r) >= 0.3 ? '#fff' : '#e5e7eb';
  }

  // ──────────── Rendering ────────────

  function _render(allKlines, container) {
    const n = SYMBOLS.length;

    // Compute full matrix
    const matrix = SYMBOLS.map((_, i) =>
      SYMBOLS.map((_, j) => (i === j ? 1 : _pearson(allKlines[i], allKlines[j])))
    );

    // Header row
    let html = `<div class="corr-grid" style="grid-template-columns: 40px repeat(${n}, 1fr)">`;
    html += `<div class="corr-cell corr-cell--corner"></div>`;
    LABELS.forEach(lbl => {
      html += `<div class="corr-cell corr-cell--head">${lbl}</div>`;
    });

    // Data rows
    matrix.forEach((row, i) => {
      html += `<div class="corr-cell corr-cell--row-head">${LABELS[i]}</div>`;
      row.forEach((r, j) => {
        const bg      = _rToColor(r);
        const fg      = _rToTextColor(r);
        const tooltip = `${LABELS[i]} vs ${LABELS[j]}: ${r.toFixed(3)}`;
        html += `<div class="corr-cell corr-cell--data" `         +
                `style="background:${bg};color:${fg}" `          +
                `title="${tooltip}">${r.toFixed(2)}</div>`;
      });
    });
    html += '</div>';

    // Legend
    html += `
      <div class="corr-legend">
        <span class="corr-legend__label">Pearson r ·  1h closes ·  last 100 bars</span>
        <div class="corr-legend__scale">
          <span style="background:#991b1b"></span>
          <span style="background:#ef4444"></span>
          <span style="background:#374151"></span>
          <span style="background:#16a34a"></span>
          <span style="background:#14532d"></span>
        </div>
        <div class="corr-legend__ticks">
          <span>−1</span><span>−0.5</span><span>0</span><span>+0.5</span><span>+1</span>
        </div>
      </div>`;

    container.innerHTML = html;
  }

  // ──────────── Public API ────────────

  async function open() {
    const modal = document.getElementById('corrModal');
    const body  = document.getElementById('corrBody');
    if (!modal || !body) return;

    body.innerHTML = `<p class="corr-loading">
      <span class="corr-loading__spinner"></span>Fetching 100 × 1h candles for all 9 tokens…</p>`;
    modal.showModal?.() || modal.setAttribute('open', '');

    try {
      const allKlines = await Promise.all(SYMBOLS.map(s => _fetchKlines(s)));
      _render(allKlines, body);
    } catch (err) {
      body.innerHTML = `<p class="corr-loading corr-loading--error">
        Failed to load data.<br><small>${err.message}</small></p>`;
    }
  }

  function close() {
    const modal = document.getElementById('corrModal');
    modal?.close?.() || modal?.removeAttribute('open');
  }

  return { open, close };
})();
