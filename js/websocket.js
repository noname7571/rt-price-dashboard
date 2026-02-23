/**
 * websocket.js
 * ─────────────────────────────────────────────────────
 * Manages Binance WebSocket stream connections.
 *
 * Two stream types are used:
 *  1. Ticker stream  — <symbol>@ticker            (24h stats, price updates)
 *  2. Kline stream   — <symbol>@kline_<interval>  (candlestick data)
 *
 * Each stream has automatic exponential-backoff reconnection.
 * ─────────────────────────────────────────────────────
 */

const WS_BASE = 'wss://stream.binance.com:9443/ws';
const RECONNECT_BASE_DELAY = 1000;   // ms
const RECONNECT_MAX_DELAY  = 30000;  // ms

class BinanceStream {
  /**
   * @param {string}   streamName  e.g. 'btcusdt@ticker' or 'btcusdt@kline_1m'
   * @param {Function} onMessage   called with parsed JSON payload
   * @param {Function} onStatus    called with 'connected' | 'disconnected' | 'error'
   */
  constructor(streamName, onMessage, onStatus) {
    this.streamName     = streamName;
    this.onMessage      = onMessage;
    this.onStatus       = onStatus || (() => {});
    this._ws            = null;
    this._destroyed     = false;
    this._reconnectDelay = RECONNECT_BASE_DELAY;
    this._reconnectTimer = null;
  }

  connect() {
    if (this._destroyed) return;
    this._clearReconnectTimer();

    const url = `${WS_BASE}/${this.streamName}`;
    this._ws = new WebSocket(url);

    this._ws.addEventListener('open', () => {
      this._reconnectDelay = RECONNECT_BASE_DELAY;
      this.onStatus('connected');
    });

    this._ws.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data);
        this.onMessage(data);
      } catch (err) {
        console.warn('[BinanceStream] Failed to parse message:', err);
      }
    });

    this._ws.addEventListener('close', (event) => {
      if (this._destroyed) return;
      this.onStatus('disconnected');
      this._scheduleReconnect();
    });

    this._ws.addEventListener('error', () => {
      if (this._destroyed) return;
      this.onStatus('error');
      // 'close' fires after 'error', reconnect is handled there
    });
  }

  /** Cleanly close and prevent any further reconnections. */
  destroy() {
    this._destroyed = true;
    this._clearReconnectTimer();
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
  }

  _scheduleReconnect() {
    this._reconnectTimer = setTimeout(() => {
      if (!this._destroyed) {
        console.log(`[BinanceStream] Reconnecting ${this.streamName} in ${this._reconnectDelay}ms…`);
        this.connect();
        this._reconnectDelay = Math.min(this._reconnectDelay * 2, RECONNECT_MAX_DELAY);
      }
    }, this._reconnectDelay);
  }

  _clearReconnectTimer() {
    if (this._reconnectTimer !== null) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }
}


/**
 * StreamManager
 * ─────────────────────────────────────────────────────
 * Owns the active ticker streams (always-on for all symbols) and a
 * single swappable kline stream (changes when the user picks a
 * different symbol or interval).
 */
class StreamManager {
  /**
   * @param {string[]} symbols           e.g. ['btcusdt','ethusdt','solusdt']
   * @param {Function} onTickerUpdate    fn(symbol, tickerPayload)
   * @param {Function} onKlineUpdate     fn(symbol, klinePayload)
   * @param {Function} onConnectionChange fn(status)   'connected'|'disconnected'|'error'
   */
  constructor(symbols, onTickerUpdate, onKlineUpdate, onConnectionChange) {
    this._symbols            = symbols;
    this._onTickerUpdate     = onTickerUpdate;
    this._onKlineUpdate      = onKlineUpdate;
    this._onConnectionChange = onConnectionChange;

    this._tickerStreams = {};   // symbol -> BinanceStream
    this._klineStream  = null; // single active BinanceStream

    this._connectedTickers = new Set();
    this._activeKlineSymbol   = null;
    this._activeKlineInterval = null;
  }

  /** Start all ticker streams and an initial kline stream. */
  start(initialSymbol, initialInterval) {
    this._symbols.forEach((sym) => this._openTickerStream(sym));
    this.switchKline(initialSymbol, initialInterval);
  }

  /** Replace the kline stream with a new symbol / interval combo. */
  switchKline(symbol, interval) {
    if (
      symbol   === this._activeKlineSymbol &&
      interval === this._activeKlineInterval
    ) return;

    if (this._klineStream) {
      this._klineStream.destroy();
      this._klineStream = null;
    }

    this._activeKlineSymbol   = symbol;
    this._activeKlineInterval = interval;

    const streamName = `${symbol}@kline_${interval}`;
    this._klineStream = new BinanceStream(
      streamName,
      (data) => this._onKlineUpdate(symbol, data),
      (status) => this._handleKlineStatus(status)
    );
    this._klineStream.connect();
  }

  /** Tear everything down. */
  destroy() {
    Object.values(this._tickerStreams).forEach((s) => s.destroy());
    this._tickerStreams = {};
    if (this._klineStream) {
      this._klineStream.destroy();
      this._klineStream = null;
    }
  }

  // ── Private ──────────────────────────────────────

  _openTickerStream(symbol) {
    const stream = new BinanceStream(
      `${symbol}@ticker`,
      (data) => this._onTickerUpdate(symbol, data),
      (status) => this._handleTickerStatus(symbol, status)
    );
    this._tickerStreams[symbol] = stream;
    stream.connect();
  }

  _handleTickerStatus(symbol, status) {
    if (status === 'connected') {
      this._connectedTickers.add(symbol);
    } else {
      this._connectedTickers.delete(symbol);
    }

    // Broadcast overall connection state once all tickers are up
    const allUp = this._symbols.every((s) => this._connectedTickers.has(s));
    this._onConnectionChange(allUp ? 'connected' : status);
  }

  _handleKlineStatus(status) {
    // Propagate kline errors but don't override a healthy ticker connection
    if (status === 'error') {
      this._onConnectionChange('error');
    }
  }
}
