# Nasdaq Volatility Screener

A SvelteKit market dashboard for NVDA, MU, GOOGL, META, MRNA, and HUT. Stock cards provide a live intraday chart in a separate window, with candlesticks, volume, and selectable 1m, 5m, 15m, 1h, and 4h intervals.

## AI discovery

The deployed site serves [`/llms.txt`](https://ndqvolatility.web.app/llms.txt) and [`/ai-catalog.json`](https://ndqvolatility.web.app/ai-catalog.json) with a concise overview, page links, and data limitations for AI agents and other automated consumers.

## Development

```sh
npm install
npm run dev
```

The Vite development server proxies `/api/stock-chart` to Yahoo Finance and `/api/hut-quote` to Nasdaq. The chart proxy accepts only the screener's six supported symbols and known timeframes.

## Stock analysis

Each stock card can request a market signal from the Typesafe `systemone` API. Analysis uses the current price, VWAP, intraday range, volatility, and price change to choose a LONG (Buy), SHORT (Sell), or NEUTRAL (Hold) signal. The API key is only used server-side.

For local development, set `JEV_API_KEY` in the root `.env` file. For Firebase, configure the `JEV_API_KEY` secret before deployment:

```sh
firebase functions:secrets:set JEV_API_KEY
```

The `/api/analyze` hosting rewrite invokes the `analyzeStock` function in production.

## Chart history and refresh

The chart uses Yahoo Finance's **unofficial** chart endpoint, accessed through the allowlisted Firebase HTTPS function in `functions/index.js`. It requires no API credentials, but Yahoo may change or rate-limit the endpoint; chart availability and historical coverage are not guaranteed. A failed refresh is shown in the chart rather than silently presented as current data.

Requested history windows are 1 day for 1m candles, 5 days for 5m, 1 month for 15m, 3 months for 1h, and 6 months of hourly source data for 4h. Yahoo does not provide 4h candles directly: the function aggregates 60-minute bars into New York regular-session buckets, keeping each session separate and excluding pre-market and after-hours bars. Actual history can be shorter where Yahoo limits intraday data. Charts refresh every 20 seconds while open; this is periodic polling, not a streaming quote feed.

The existing HUT screener quote continues to use Nasdaq independently of chart data.

## Build and validation

```sh
npm run check
npm run build
npm run lint
```

## Firebase deployment

The static SvelteKit build is hosted from `build/`. Hosting rewrites `/api/stock-chart` to the `stockChart` function and `/api/hut-quote` to the existing `hutQuote` function before falling back to the SPA. The function runtime is Node.js 22. Deploy Hosting and Functions together:

```sh
firebase deploy --only hosting,functions
```

Deploying Cloud Functions requires a Firebase project with billing enabled.
