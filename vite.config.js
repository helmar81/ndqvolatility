import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';

const chartSymbols = new Set(['NVDA', 'MU', 'GOOGL', 'META', 'MRNA', 'HUT']);
const chartTimeframes = new Map([
	['1m', ['1m', '1d']],
	['5m', ['5m', '5d']],
	['15m', ['15m', '1mo']],
	['1h', ['60m', '3mo']],
	['4h', ['60m', '6mo']]
]);

/** @typedef {{time: number, open: number, high: number, low: number, close: number, volume: number}} ChartCandle */

/** @param {ChartCandle[]} candles */
function aggregateFourHourCandles(candles) {
	const formatter = new Intl.DateTimeFormat('en-US', {
		timeZone: 'America/New_York',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23'
	});
	const buckets = new Map();

	for (const candle of candles) {
		const parts = Object.fromEntries(
			formatter.formatToParts(new Date(candle.time * 1000))
				.filter(({ type }) => type !== 'literal')
				.map(({ type, value }) => [type, value])
		);
		const minute = Number(parts.hour) * 60 + Number(parts.minute);
		if (minute < 570 || minute >= 960) continue;

		const session = `${parts.year}-${parts.month}-${parts.day}`;
		const bucketIndex = Math.floor((minute - 570) / 240);
		const key = `${session}-${bucketIndex}`;
		const bucket = buckets.get(key);
		if (bucket) {
			bucket.high = Math.max(bucket.high, candle.high);
			bucket.low = Math.min(bucket.low, candle.low);
			bucket.close = candle.close;
			bucket.volume += candle.volume;
			continue;
		}

		const [year, month, day] = session.split('-').map(Number);
		const localStart = new Date(Date.UTC(year, month - 1, day, 0, 570 + bucketIndex * 240));
		const zone = new Intl.DateTimeFormat('en-US', {
			timeZone: 'America/New_York',
			timeZoneName: 'shortOffset'
		}).formatToParts(new Date(candle.time * 1000)).find(({ type }) => type === 'timeZoneName')?.value;
		const offset = zone?.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
		const offsetMinutes = offset
			? (offset[1] === '-' ? -1 : 1) * (Number(offset[2]) * 60 + Number(offset[3] || 0))
			: -300;
		buckets.set(key, {
			time: Math.floor((localStart.getTime() - offsetMinutes * 60_000) / 1000),
			open: candle.open,
			high: candle.high,
			low: candle.low,
			close: candle.close,
			volume: candle.volume
		});
	}

	return [...buckets.values()].sort((a, b) => a.time - b.time);
}

/**
 * @param {Record<string, any>} payload
 * @param {string} symbol
 * @param {string} timeframe
 */
function transformYahooChart(payload, symbol, timeframe) {
	const result = payload?.chart?.result?.[0];
	if (!result || payload?.chart?.error) throw new Error('Yahoo Finance returned no chart data.');
	const quote = result.indicators?.quote?.[0];
	const timestamps = /** @type {number[]} */ (result.timestamp || []);
	const candles = timestamps.flatMap((time, index) => {
		const open = quote?.open?.[index];
		const high = quote?.high?.[index];
		const low = quote?.low?.[index];
		const close = quote?.close?.[index];
		const volume = quote?.volume?.[index];
		if (![time, open, high, low, close].every(Number.isFinite)) return [];
		return [{ time, open, high, low, close, volume: Number.isFinite(volume) ? volume : 0 }];
	});
	const output = timeframe === '4h' ? aggregateFourHourCandles(candles) : candles;
	if (output.length > 1500) throw new Error('Yahoo Finance returned too many chart points.');
	return {
		symbol,
		timeframe,
		candles: output,
		currency: result.meta?.currency || 'USD',
		exchangeTimezone: result.meta?.exchangeTimezoneName || 'America/New_York',
		fetchedAt: new Date().toISOString(),
		provider: 'Yahoo Finance (unofficial chart endpoint)'
	};
}

export default defineConfig({
	server: {
		proxy: {
			'/api/analyze': {
				target: 'http://localhost:8000',
				changeOrigin: true,
				secure: false
			},
			'/api': {
				target: 'http://localhost:8000',
				changeOrigin: true,
				secure: false
			},
			'/api/stock-chart': {
				target: 'https://query1.finance.yahoo.com',
				changeOrigin: true,
				rewrite: (path) => {
					const url = new URL(path, 'http://localhost');
					const symbol = url.searchParams.get('symbol') || '';
					const timeframe = url.searchParams.get('timeframe') || '';
					const settings = chartTimeframes.get(timeframe);
					if (!chartSymbols.has(symbol) || !settings) return '/__invalid_stock_chart_request__';
					const query = new URLSearchParams({
						interval: settings[0],
						range: settings[1],
						events: 'div,splits'
					});
					return `/v8/finance/chart/${symbol}?${query}`;
				},
				timeout: 12_000,
				proxyTimeout: 10_000,
				selfHandleResponse: true,
				configure: (proxy) => {
					proxy.on('proxyReq', (proxyReq) => {
						proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (compatible; NasdaqScreener/1.0)');
						proxyReq.setHeader('Accept', 'application/json');
						proxyReq.setHeader('Accept-Encoding', 'identity');
					});
					proxy.on('proxyRes', (proxyRes, request, response) => {
						const chunks = /** @type {Buffer[]} */ ([]);
						let size = 0;
						proxyRes.on('data', (chunk) => {
							size += chunk.length;
							if (size <= 2_000_000) chunks.push(chunk);
						});
						proxyRes.on('end', () => {
							/** @param {number} status @param {Record<string, any>} body */
							const send = (status, body) => {
								response.writeHead(status, {
									'Cache-Control': 'no-store',
									'Content-Type': 'application/json; charset=utf-8'
								});
								response.end(JSON.stringify(body));
							};
							if (size > 2_000_000) {
								send(502, { error: 'Yahoo Finance returned an oversized chart response.' });
								return;
							}
							if (proxyRes.statusCode !== 200) {
								send(502, {
									error: proxyRes.statusCode === 429
										? 'Yahoo Finance is rate-limiting chart requests. Please try again shortly.'
										: `Yahoo Finance could not provide this chart (HTTP ${proxyRes.statusCode}).`
								});
								return;
							}
							try {
								const url = new URL(request.url || '/', 'http://localhost');
								const symbol = url.pathname.match(
									/^\/v8\/finance\/chart\/(NVDA|MU|GOOGL|META|MRNA|HUT)$/
								)?.[1];
								const [timeframe] = [...chartTimeframes].find(([, settings]) =>
									settings[0] === url.searchParams.get('interval') &&
									settings[1] === url.searchParams.get('range')
								) || [];
								if (!symbol || !timeframe) throw new Error('A supported chart request is required.');
								const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
								send(200, transformYahooChart(payload, symbol, timeframe));
							} catch (error) {
								send(502, { error: error instanceof Error ? error.message : 'Unable to read chart data.' });
							}
						});
					});
					proxy.on('error', (error, request, response) => {
						if ('writeHead' in response && !response.headersSent) {
							response.writeHead(502, {
								'Cache-Control': 'no-store',
								'Content-Type': 'application/json; charset=utf-8'
							});
							response.end(JSON.stringify({ error: 'Unable to retrieve chart data from Yahoo Finance.' }));
						}
					});
				}
			},
			'/api/hut-quote': {
				target: 'https://api.nasdaq.com',
				changeOrigin: true,
				rewrite: () => '/api/quote/HUT/info?assetclass=stocks',
				configure: (proxy) => {
					proxy.on('proxyReq', (proxyReq) => {
						proxyReq.setHeader('User-Agent', 'Mozilla/5.0');
						proxyReq.setHeader('Accept', 'application/json, text/plain, */*');
					});
				}
			}
		}
	},
	plugins: [
		tailwindcss(),
		sveltekit(),
		SvelteKitPWA({
			srcDir: './src',
			mode: 'development',
			strategies: 'generateSW',
			manifest: {
				short_name: 'Volatility',
				name: 'Nasdaq Volatility Screener',
				start_url: '/',
				display: 'standalone',
				theme_color: '#0f172a',
				background_color: '#0f172a',
				icons: [
					{
						src: '/assets/icon-192.png',
						sizes: '192x192',
						type: 'image/png'
					},
					{
						src: '/assets/icon-512.png',
						sizes: '512x512',
						type: 'image/png'
					}
				]
			}
		})
	]
});
