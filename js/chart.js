/**
 * chart.js
 * ─────────────────────────────────────────────────────
 * Wraps TradingView Lightweight Charts.
 *
 * Layout: two stacked chart instances sharing a synchronised
 * time-scale — price (candlestick / line) on top, volume
 * histogram on bottom.
 *
 * Public API
 *  new ChartManager(priceWrapperId, volumeWrapperId, onCrosshair)
 *  .load(symbol, interval, seriesType)   — fetch history, reset series
 *  .setSeriesType('candlestick'|'line')  — switch without re-fetch
 *  .updateCandle(binanceKlinePayload)    — live WebSocket tick
 *  .destroy()
 * ─────────────────────────────────────────────────────
 */

const BINANCE_REST  = 'https://api.binance.com/api/v3/klines';
const HISTORY_LIMIT = 200;

// ── Shared theme ────────────────────────────────────
const SHARED_LAYOUT = {
  background:  { color: '#13161e' },
  textColor:   '#8b90a7',
  fontSize:    11,
  fontFamily:  "'Inter', 'Segoe UI', system-ui, sans-serif",
};

const SHARED_GRID = {
  vertLines: { color: 'rgba(255,255,255,0.04)' },
  horzLines:  { color: 'rgba(255,255,255,0.04)' },
};

const SHARED_CROSSHAIR = {
  mode: 1,
  vertLine: {
    color: 'rgba(99,102,241,0.5)',
    labelBackgroundColor: '#252940',
  },
  horzLine: {
    color: 'rgba(99,102,241,0.5)',
    labelBackgroundColor: '#252940',
  },
};

const PRICE_CHART_OPTIONS = {
  layout:    SHARED_LAYOUT,
  grid:      SHARED_GRID,
  crosshair: SHARED_CROSSHAIR,
  rightPriceScale: { borderColor: 'rgba(255,255,255,0.06)' },
  timeScale: {
    borderColor:    'rgba(255,255,255,0.06)',
    visible:        false,   // time labels shown on volume chart only
    timeVisible:    true,
    secondsVisible: false,
  },
  handleScroll:  true,
  handleScale:   true,
  kineticScroll: { touch: true, mouse: false },
};

const VOLUME_CHART_OPTIONS = {
  layout: {
    ...SHARED_LAYOUT,
    background: { color: '#0f111a' }, // slightly darker to differentiate
  },
  grid: {
    vertLines: { color: 'rgba(255,255,255,0.04)' },
    horzLines:  { color: 'transparent' },
  },
  crosshair: {
    ...SHARED_CROSSHAIR,
    horzLine: { visible: false },  // no horizontal crosshair on volume
  },
  rightPriceScale: {
    borderColor:  'rgba(255,255,255,0.06)',
    scaleMargins: { top: 0.1, bottom: 0 },
    drawTicks:    false,
  },
  timeScale: {
    borderColor:    'rgba(255,255,255,0.06)',
    visible:        true,
    timeVisible:    true,
    secondsVisible: false,
  },
  handleScroll:  true,
  handleScale:   true,
  kineticScroll: { touch: true, mouse: false },
};

const CANDLE_STYLE = {
  upColor:         '#22c55e',
  downColor:       '#ef4444',
  borderUpColor:   '#22c55e',
  borderDownColor: '#ef4444',
  wickUpColor:     '#22c55e',
  wickDownColor:   '#ef4444',
};

const LINE_STYLE = {
  color:     '#6366f1',
  lineWidth: 2,
  crosshairMarkerBackgroundColor: '#6366f1',
};


class ChartManager {
  /**
   * @param {string}   priceWrapperId   id of the price chart container
   * @param {string}   volumeWrapperId  id of the volume chart container
   * @param {Function} onCrosshair      fn({ open, high, low, close, volume, time }) | fn(null)
   */
  constructor(priceWrapperId, volumeWrapperId, onCrosshair) {
    this._priceWrapper  = document.getElementById(priceWrapperId);
    this._volumeWrapper = document.getElementById(volumeWrapperId);
    this._onCrosshair   = onCrosshair || (() => {});

    this._priceChart  = null;
    this._volumeChart = null;

    this._priceSeries  = null;
    this._volumeSeries = null;

    this._seriesType = 'candlestick';

    this._barCache    = new Map();  // time → { time, open, high, low, close }
    this._volumeCache = new Map();  // time → { time, value, color }

    this._syncingRange = false;     // prevents feedback loop in timescale sync
    this._loading      = null;

    this._resizeObserver = null;

    this._initCharts();
    this._syncTimescales();
    this._bindResize();
  }

  // ─────────────────────────────────────────────────
  //  Public API
  // ─────────────────────────────────────────────────

  async load(symbol, interval, seriesType) {
    this._symbol   = symbol;
    this._interval = interval;
    if (seriesType && seriesType !== this._seriesType) {
      this._seriesType = seriesType;
    }

    this._showLoading();
    this._barCache.clear();
    this._volumeCache.clear();

    try {
      const candles = await this._fetchHistory(symbol, interval);
      this._resetSeries();
      this._populateSeries(candles);
      this._priceChart.timeScale().fitContent();
      this._volumeChart.timeScale().fitContent();
    } catch (err) {
      console.error('[ChartManager] Failed to load history:', err);
    } finally {
      this._hideLoading();
    }
  }

  setSeriesType(type) {
    if (type === this._seriesType) return;
    this._seriesType = type;

    const bars = Array.from(this._barCache.values()).sort((a, b) => a.time - b.time);
    this._resetSeries();

    if (this._seriesType === 'line') {
      this._priceSeries.setData(bars.map((b) => ({ time: b.time, value: b.close })));
    } else {
      this._priceSeries.setData(bars);
    }

    const volBars = Array.from(this._volumeCache.values()).sort((a, b) => a.time - b.time);
    this._volumeSeries.setData(volBars);

    this._priceChart.timeScale().fitContent();
    this._volumeChart.timeScale().fitContent();
  }

  /**
   * Feed a live Binance kline WebSocket event.
   * Payload: { k: { t, o, h, l, c, v, x } }
   */
  updateCandle(payload) {
    const k = payload.k;
    if (!k) return;

    const bar = {
      time:  Math.floor(k.t / 1000),
      open:  parseFloat(k.o),
      high:  parseFloat(k.h),
      low:   parseFloat(k.l),
      close: parseFloat(k.c),
    };

    const volBar = {
      time:  bar.time,
      value: parseFloat(k.v),
      color: parseFloat(k.c) >= parseFloat(k.o)
        ? 'rgba(34,197,94,0.5)'
        : 'rgba(239,68,68,0.5)',
    };

    this._barCache.set(bar.time, bar);
    this._volumeCache.set(bar.time, volBar);

    if (this._priceSeries) {
      if (this._seriesType === 'line') {
        this._priceSeries.update({ time: bar.time, value: bar.close });
      } else {
        this._priceSeries.update(bar);
      }
    }

    if (this._volumeSeries) {
      this._volumeSeries.update(volBar);
    }
  }

  applyTheme(isDark) {
    const t = isDark ? {
      priceBg:  '#13161e',
      volBg:    '#0f111a',
      text:     '#8b90a7',
      grid:     'rgba(255,255,255,0.04)',
      border:   'rgba(255,255,255,0.06)',
      label:    '#252940',
    } : {
      priceBg:  '#ffffff',
      volBg:    '#f0f2f7',
      text:     '#4b5073',
      grid:     'rgba(0,0,0,0.05)',
      border:   'rgba(0,0,0,0.08)',
      label:    '#dde0ea',
    };

    const sharedLayout  = { textColor: t.text };
    const sharedGrid    = { vertLines: { color: t.grid }, horzLines: { color: t.grid } };
    const sharedCross   = {
      vertLine: { color: 'rgba(99,102,241,0.5)', labelBackgroundColor: t.label },
      horzLine: { color: 'rgba(99,102,241,0.5)', labelBackgroundColor: t.label },
    };
    const sharedBorder  = { rightPriceScale: { borderColor: t.border }, timeScale: { borderColor: t.border } };

    this._priceChart?.applyOptions({
      layout:    { ...sharedLayout, background: { color: t.priceBg } },
      grid:      sharedGrid,
      crosshair: sharedCross,
      ...sharedBorder,
    });

    this._volumeChart?.applyOptions({
      layout:    { ...sharedLayout, background: { color: t.volBg } },
      grid:      { vertLines: { color: t.grid }, horzLines: { color: 'transparent' } },
      crosshair: { ...sharedCross, horzLine: { visible: false } },
      ...sharedBorder,
    });
  }

  destroy() {
    if (this._resizeObserver) this._resizeObserver.disconnect();
    if (this._priceChart)  this._priceChart.remove();
    if (this._volumeChart) this._volumeChart.remove();
  }

  // ─────────────────────────────────────────────────
  //  Private — chart initialisation
  // ─────────────────────────────────────────────────

  _initCharts() {
    // Loading overlay sits over the price chart
    this._loading = document.createElement('div');
    this._loading.className = 'chart-wrapper__loading';
    this._loading.innerHTML = '<div class="spinner"></div><span>Loading chart…</span>';
    this._priceWrapper.appendChild(this._loading);

    this._priceChart = LightweightCharts.createChart(this._priceWrapper, {
      ...PRICE_CHART_OPTIONS,
      width:  this._priceWrapper.clientWidth,
      height: this._priceWrapper.clientHeight,
    });

    this._volumeChart = LightweightCharts.createChart(this._volumeWrapper, {
      ...VOLUME_CHART_OPTIONS,
      width:  this._volumeWrapper.clientWidth,
      height: this._volumeWrapper.clientHeight,
    });

    // Crosshair → feed OHLC readout from price chart
    this._priceChart.subscribeCrosshairMove((param) => {
      if (!param.seriesData || !this._priceSeries) {
        this._onCrosshair(null);
        return;
      }
      const priceData = param.seriesData.get(this._priceSeries);
      const volData   = this._volumeSeries
        ? param.seriesData.get(this._volumeSeries)
        : null;

      if (!priceData) {
        this._onCrosshair(null);
        return;
      }

      const base = this._seriesType === 'line'
        ? { close: priceData.value }
        : priceData;

      this._onCrosshair({
        ...base,
        volume: volData ? volData.value : null,
      });
    });
  }

  // ─────────────────────────────────────────────────
  //  Private — timescale sync (scroll + zoom)
  // ─────────────────────────────────────────────────

  _syncTimescales() {
    const priceTS  = this._priceChart.timeScale();
    const volumeTS = this._volumeChart.timeScale();

    priceTS.subscribeVisibleLogicalRangeChange((range) => {
      if (this._syncingRange || !range) return;
      this._syncingRange = true;
      volumeTS.setVisibleLogicalRange(range);
      this._syncingRange = false;
    });

    volumeTS.subscribeVisibleLogicalRangeChange((range) => {
      if (this._syncingRange || !range) return;
      this._syncingRange = true;
      priceTS.setVisibleLogicalRange(range);
      this._syncingRange = false;
    });
  }

  // ─────────────────────────────────────────────────
  //  Private — series management
  // ─────────────────────────────────────────────────

  _resetSeries() {
    if (this._priceSeries) {
      this._priceChart.removeSeries(this._priceSeries);
      this._priceSeries = null;
    }
    if (this._volumeSeries) {
      this._volumeChart.removeSeries(this._volumeSeries);
      this._volumeSeries = null;
    }

    if (this._seriesType === 'candlestick') {
      this._priceSeries = this._priceChart.addCandlestickSeries(CANDLE_STYLE);
    } else {
      this._priceSeries = this._priceChart.addLineSeries(LINE_STYLE);
    }

    this._volumeSeries = this._volumeChart.addHistogramSeries({
      priceFormat:  { type: 'volume' },
      priceScaleId: 'right',
      color:        'rgba(99,102,241,0.4)',
    });
    this._volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.1, bottom: 0 },
    });
  }

  _populateSeries(candles) {
    const bars    = [];
    const volBars = [];

    candles.forEach((c) => {
      const open  = parseFloat(c[1]);
      const close = parseFloat(c[4]);
      const bar = {
        time:  Math.floor(c[0] / 1000),
        open,
        high:  parseFloat(c[2]),
        low:   parseFloat(c[3]),
        close,
      };
      bars.push(bar);
      this._barCache.set(bar.time, bar);

      const volBar = {
        time:  bar.time,
        value: parseFloat(c[5]),
        color: close >= open
          ? 'rgba(34,197,94,0.5)'
          : 'rgba(239,68,68,0.5)',
      };
      volBars.push(volBar);
      this._volumeCache.set(volBar.time, volBar);
    });

    if (this._seriesType === 'line') {
      this._priceSeries.setData(bars.map((b) => ({ time: b.time, value: b.close })));
    } else {
      this._priceSeries.setData(bars);
    }

    this._volumeSeries.setData(volBars);
  }

  // ─────────────────────────────────────────────────
  //  Private — REST fetch
  // ─────────────────────────────────────────────────

  async _fetchHistory(symbol, interval) {
    const url = new URL(BINANCE_REST);
    url.searchParams.set('symbol',   symbol.toUpperCase());
    url.searchParams.set('interval', interval);
    url.searchParams.set('limit',    HISTORY_LIMIT);
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  // ─────────────────────────────────────────────────
  //  Private — resize
  // ─────────────────────────────────────────────────

  _bindResize() {
    this._resizeObserver = new ResizeObserver(() => {
      if (this._priceChart) {
        this._priceChart.applyOptions({
          width:  this._priceWrapper.clientWidth,
          height: this._priceWrapper.clientHeight,
        });
      }
      if (this._volumeChart) {
        this._volumeChart.applyOptions({
          width:  this._volumeWrapper.clientWidth,
          height: this._volumeWrapper.clientHeight,
        });
      }
    });
    this._resizeObserver.observe(this._priceWrapper);
    this._resizeObserver.observe(this._volumeWrapper);
  }

  // ─────────────────────────────────────────────────
  //  Private — loading overlay
  // ─────────────────────────────────────────────────

  _showLoading() { if (this._loading) this._loading.style.display = 'flex'; }
  _hideLoading()  { if (this._loading) this._loading.style.display = 'none'; }
}
