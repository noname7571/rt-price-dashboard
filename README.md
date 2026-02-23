# Real-Time Price Dashboard

A real-time cryptocurrency price dashboard that streams live data from Binance via WebSocket and renders interactive candlestick / line charts using TradingView Lightweight Charts.

## Features

- **Live price streaming** — Multiple tokens via Binance public WebSocket API
- **Candlestick & line charts** — Powered by TradingView Lightweight Charts v4
- **Multiple intervals** — 1m, 5m, 15m, 1h, 4h, 1D
- **24h stats** — Current price (with flash animation), high, low, percentage change, volume
- **OHLC readout** — Hovering the crosshair shows O/H/L/C values in real time
- **Auto-reconnect** — Exponential back-off reconnection on WebSocket drops
- **Dark theme** — clean, modern UI — no frameworks, plain HTML / CSS / JS

## Project Structure

```
rt-price-dashboard/
├── index.html          # App shell
├── css/
│   └── styles.css      # Dark theme stylesheet
├── js/
│   ├── app.js          # Entry point — wires everything together
│   ├── websocket.js    # Binance WebSocket manager (BinanceStream + StreamManager)
│   ├── chart.js        # ChartManager — Lightweight Charts integration
│   └── ui.js           # DOM helpers for cards, badges, OHLC readout
└── README.md
```

## Running Locally

No build step required — open `index.html` directly in a modern browser, **or** serve it with any static file server:

```bash
# Python
python3 -m http.server 8080

# Node.js (npx)
npx serve .
```

Then visit `http://localhost:8080`.

## APIs Used

| Purpose | Endpoint |
|---|---|
| Historical candles | `GET https://api.binance.com/api/v3/klines` |
| Live candlestick stream | `wss://stream.binance.com:9443/ws/<symbol>@kline_<interval>` |
| 24h ticker stats | `wss://stream.binance.com:9443/ws/<symbol>@ticker` |

All APIs are public — no API key required.

## Tech Stack

- **HTML / CSS / Vanilla JS** — no frameworks
- **[Lightweight Charts](https://github.com/tradingview/lightweight-charts)** (TradingView) — financial charting
- **Binance WebSocket API** — free public market data