/**
 * alerts.js
 * ─────────────────────────────────────────────────────
 * Browser-notification price alerts.
 *
 * Public API:
 *   Alerts.add(symbol, price, direction)  → add alert
 *   Alerts.remove(id)                     → delete by id
 *   Alerts.getAll()                       → snapshot array
 *   Alerts.check(symbol, currentPrice)    → fire if threshold met
 *   Alerts.requestPermission()            → returns promise<bool>
 * ─────────────────────────────────────────────────────
 */

const Alerts = (function () {
  'use strict';

  const STORAGE_KEY = 'rt-dashboard-alerts';

  let _alerts = [];
  // Track which alert ids have already fired; reset when price moves away
  const _fired  = {};

  // ──────────── Persistence ────────────

  function _load() {
    try {
      _alerts = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch {
      _alerts = [];
    }
  }

  function _save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_alerts));
  }

  // ──────────── Public API ────────────

  /**
   * @param {string} symbol     e.g. 'btcusdt'
   * @param {number} price      target price in USDT
   * @param {'above'|'below'} direction
   */
  function add(symbol, price, direction) {
    _alerts.push({ id: Date.now(), symbol, price, direction, active: true });
    _save();
    return _alerts[_alerts.length - 1];
  }

  /** Remove alert by numeric id */
  function remove(id) {
    _alerts = _alerts.filter(a => a.id !== id);
    delete _fired[id];
    _save();
  }

  /** Returns a shallow copy of all alerts */
  function getAll() {
    return [..._alerts];
  }

  /**
   * Called on every ticker update; fires a Notification if threshold is crossed.
   * Resets after price bounces ≥ 0.5 % away from the target.
   */
  function check(symbol, currentPrice) {
    _alerts.forEach(alert => {
      if (alert.symbol !== symbol || !alert.active) return;

      const triggered =
        alert.direction === 'above'
          ? currentPrice >= alert.price
          : currentPrice <= alert.price;

      if (triggered && !_fired[alert.id]) {
        _fired[alert.id] = true;
        _notify(alert, currentPrice);
        return;
      }

      // Allow re-trigger once price bounces 0.5 % away
      if (!triggered && _fired[alert.id]) {
        const bounced =
          alert.direction === 'above'
            ? currentPrice < alert.price * 0.995
            : currentPrice > alert.price * 1.005;
        if (bounced) delete _fired[alert.id];
      }
    });
  }

  /** Ask for Notification permission; resolves to true if granted */
  async function requestPermission() {
    if (typeof Notification === 'undefined') return false;
    if (Notification.permission === 'granted')  return true;
    if (Notification.permission === 'denied')   return false;
    const result = await Notification.requestPermission();
    return result === 'granted';
  }

  // ──────────── Internal ────────────

  function _notify(alert, currentPrice) {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const base = alert.symbol.replace('usdt', '').toUpperCase();
    const dir  = alert.direction === 'above' ? '▲ above' : '▼ below';
    new Notification(`🔔 ${base}/USDT alert triggered`, {
      body: `Price hit $${currentPrice.toLocaleString('en-US', { maximumFractionDigits: 4 })}  (${dir} $${alert.price.toLocaleString('en-US', { maximumFractionDigits: 4 })})`,
      tag:  `rt-alert-${alert.id}`,
    });
  }

  // Load persisted alerts on module init
  _load();

  return { add, remove, getAll, check, requestPermission };
})();
