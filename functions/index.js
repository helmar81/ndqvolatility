const { logger } = require('firebase-functions');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');

const NASDAQ_HUT_QUOTE_URL = 'https://api.nasdaq.com/api/quote/HUT/info?assetclass=stocks';
const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';
const TYPESAFE_URL = 'https://api.typesafe.ai/v1/systemone';
const JEV_API_KEY = defineSecret('JEV_API_KEY');
const SIGNAL_CRITERIA = {
	LONG: 'Buy signal',
	SHORT: 'Sell signal',
	NEUTRAL: 'Hold signal'
};
/** @type {Record<string, 'LONG' | 'SHORT' | 'NEUTRAL'>} */
const SIGNAL_ALIASES = {
	LONG: 'LONG',
	BUY: 'LONG',
	'BUY SIGNAL': 'LONG',
	SHORT: 'SHORT',
	SELL: 'SHORT',
	'SELL SIGNAL': 'SHORT',
	NEUTRAL: 'NEUTRAL',
	HOLD: 'NEUTRAL',
	'HOLD SIGNAL': 'NEUTRAL'
};
const STOCK_SYMBOLS = new Set(['NVDA', 'MU', 'GOOGL', 'META', 'MRNA', 'HUT']);
const CHART_TIMEFRAMES = new Map([
	['1m', { interval: '1m', range: '1d' }],
	['5m', { interval: '5m', range: '5d' }],
	['15m', { interval: '15m', range: '1mo' }],
	['1h', { interval: '60m', range: '3mo' }],
	['4h', { interval: '60m', range: '6mo' }]
]);

/**
 * @param {unknown} value
 * @returns {'LONG' | 'SHORT' | 'NEUTRAL' | null}
 */
function parseSignal(value) {
	if (typeof value === 'string') {
		const normalized = value.trim().toUpperCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
		return Object.hasOwn(SIGNAL_ALIASES, normalized) ? SIGNAL_ALIASES[normalized] : null;
	}
	if (!value || typeof value !== 'object') return null;

	const record = /** @type {Record<string, unknown>} */ (value);
	for (const key of [
		'signal',
		'answer',
		'value',
		'choice',
		'selected',
		'result',
		'criteria',
		'key',
		'name',
		'label'
	]) {
		const signal = parseSignal(record[key]);
		if (signal) return signal;
	}
	return null;
}

/**
 * @param {Array<{time: number, open: number, high: number, low: number, close: number, volume: number}>} candles
 */
function aggregateFourHourCandles(candles) {
	const marketTime = new Intl.DateTimeFormat('en-US', {
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
			marketTime
				.formatToParts(new Date(candle.time * 1000))
				.filter(({ type }) => type !== 'literal')
				.map(({ type, value }) => [type, value])
		);
		const minuteOfDay = Number(parts.hour) * 60 + Number(parts.minute);
		if (minuteOfDay < 570 || minuteOfDay >= 960) continue;

		const session = `${parts.year}-${parts.month}-${parts.day}`;
		const bucketIndex = Math.floor((minuteOfDay - 570) / 240);
		const bucketStart = 570 + bucketIndex * 240;
		const key = `${session}-${bucketIndex}`;
		const existing = buckets.get(key);
		if (existing) {
			existing.high = Math.max(existing.high, candle.high);
			existing.low = Math.min(existing.low, candle.low);
			existing.close = candle.close;
			existing.volume += candle.volume;
		} else {
			const [year, month, day] = session.split('-').map(Number);
			const localStart = new Date(Date.UTC(year, month - 1, day, 0, bucketStart));
			const utcOffset = new Intl.DateTimeFormat('en-US', {
				timeZone: 'America/New_York',
				timeZoneName: 'shortOffset'
			})
				.formatToParts(new Date(candle.time * 1000))
				.find(({ type }) => type === 'timeZoneName')?.value;
			const offsetMatch = utcOffset?.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
			const offsetMinutes = offsetMatch
				? (offsetMatch[1] === '-' ? -1 : 1) *
					(Number(offsetMatch[2]) * 60 + Number(offsetMatch[3] || 0))
				: -300;
			const timestamp = Math.floor((localStart.getTime() - offsetMinutes * 60_000) / 1000);
			buckets.set(key, {
				time: timestamp,
				open: candle.open,
				high: candle.high,
				low: candle.low,
				close: candle.close,
				volume: candle.volume
			});
		}
	}

	return [...buckets.values()].sort((a, b) => a.time - b.time);
}

exports.stockChart = onRequest(
	{
		region: 'us-central1',
		timeoutSeconds: 15,
		maxInstances: 10,
		memory: '256MiB'
	},
	async (request, response) => {
		response.set('Cache-Control', 'no-store');
		response.set('X-Content-Type-Options', 'nosniff');
		if (request.method !== 'GET') {
			response.set('Allow', 'GET');
			response.status(405).json({ error: 'Method not allowed.' });
			return;
		}

		const symbol = request.query.symbol;
		const timeframe = request.query.timeframe;
		if (typeof symbol !== 'string' || !STOCK_SYMBOLS.has(symbol)) {
			response.status(400).json({ error: 'A supported stock symbol is required.' });
			return;
		}
		const timeframeConfig =
			typeof timeframe === 'string' ? CHART_TIMEFRAMES.get(timeframe) : undefined;
		if (!timeframeConfig) {
			response.status(400).json({ error: 'A supported chart timeframe is required.' });
			return;
		}

		const { interval, range } = timeframeConfig;
		const url = new URL(`${YAHOO_CHART_URL}/${symbol}`);
		url.searchParams.set('range', range);
		url.searchParams.set('interval', interval);
		url.searchParams.set('events', 'div,splits');

		try {
			const upstream = await fetch(url, {
				headers: {
					'User-Agent': 'Mozilla/5.0 (compatible; NasdaqScreener/1.0)',
					Accept: 'application/json'
				},
				signal: AbortSignal.timeout(10_000)
			});
			if (!upstream.ok) {
				logger.warn('Yahoo Finance chart request failed.', {
					symbol,
					timeframe,
					status: upstream.status
				});
				response.status(502).json({
					error:
						upstream.status === 429
							? 'Yahoo Finance is rate-limiting chart requests. Please try again shortly.'
							: `Yahoo Finance could not provide this chart (HTTP ${upstream.status}).`
				});
				return;
			}
			const contentLength = Number(upstream.headers.get('content-length'));
			if (Number.isFinite(contentLength) && contentLength > 2_000_000) {
				response.status(502).json({ error: 'Yahoo Finance returned an oversized chart response.' });
				return;
			}
			const body = await upstream.text();
			if (body.length > 2_000_000) {
				response.status(502).json({ error: 'Yahoo Finance returned an oversized chart response.' });
				return;
			}
			const payload = JSON.parse(body);
			const result = payload?.chart?.result?.[0];
			if (!result || payload?.chart?.error) {
				logger.warn('Yahoo Finance returned no chart data.', {
					symbol,
					timeframe,
					error: payload?.chart?.error
				});
				response
					.status(502)
					.json({ error: 'Yahoo Finance returned no chart data for this request.' });
				return;
			}

			const quote = result.indicators?.quote?.[0];
			const timestamps = /** @type {number[]} */ (result.timestamp || []);
			const candles = timestamps.flatMap((time, index) => {
				const open = quote?.open?.[index];
				const high = quote?.high?.[index];
				const low = quote?.low?.[index];
				const close = quote?.close?.[index];
				const volume = quote?.volume?.[index];
				if (![time, open, high, low, close].every(Number.isFinite)) return [];
				return [
					{
						time,
						open,
						high,
						low,
						close,
						volume: Number.isFinite(volume) ? volume : 0
					}
				];
			});
			const output = timeframe === '4h' ? aggregateFourHourCandles(candles) : candles;
			if (output.length > 1500) {
				response.status(502).json({ error: 'Yahoo Finance returned too many chart points.' });
				return;
			}

			response.status(200).json({
				symbol,
				timeframe,
				candles: output,
				currency: result.meta?.currency || 'USD',
				exchangeTimezone: result.meta?.exchangeTimezoneName || 'America/New_York',
				fetchedAt: new Date().toISOString(),
				provider: 'Yahoo Finance (unofficial chart endpoint)'
			});
		} catch (/** @type {unknown} */ error) {
			logger.error('Failed to retrieve Yahoo Finance chart.', { symbol, timeframe, error });
			response.status(502).json({
				error:
					error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
						? 'Yahoo Finance chart request timed out. Please try again.'
						: 'Unable to retrieve chart data from Yahoo Finance.'
			});
		}
	}
);

exports.analyzeStock = onRequest(
	{
		region: 'us-central1',
		timeoutSeconds: 30,
		maxInstances: 5,
		secrets: [JEV_API_KEY]
	},
	async (request, response) => {
		response.set('Cache-Control', 'no-store');
		response.set('X-Content-Type-Options', 'nosniff');
		if (request.method !== 'POST') {
			response.set('Allow', 'POST');
			response.status(405).json({ error: 'Method not allowed.' });
			return;
		}

		const { symbol, price, high, low, vwap, volatility, change, changePct } = request.body || {};
		if (typeof symbol !== 'string' || !STOCK_SYMBOLS.has(symbol)) {
			response.status(400).json({ error: 'A supported stock symbol is required.' });
			return;
		}
		if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
			response.status(400).json({ error: 'A valid current stock price is required for analysis.' });
			return;
		}

		const optionalMetrics = { high, low, vwap, volatility, change, changePct };
		for (const [name, value] of Object.entries(optionalMetrics)) {
			if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value))) {
				response.status(400).json({ error: `The ${name} value must be a finite number.` });
				return;
			}
		}

		const apiKey = JEV_API_KEY.value().trim();
		if (!apiKey) {
			logger.error('Typesafe API secret JEV_API_KEY is not configured.');
			response.status(503).json({ error: 'Stock analysis is not configured on the server.' });
			return;
		}

		const state = [
			`Stock: ${symbol}`,
			`Current price: $${price}`,
			`Intraday high: ${high ?? 'unavailable'}`,
			`Intraday low: ${low ?? 'unavailable'}`,
			`VWAP: ${vwap ?? 'unavailable'}`,
			`Volatility: ${volatility ?? 'unavailable'}`,
			`Price change: ${change ?? 'unavailable'}`,
			`Price change percent: ${changePct ?? 'unavailable'}%`
		].join('\n');

		try {
			const upstream = await fetch(TYPESAFE_URL, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${apiKey}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					state,
					model: 'jev-latest',
					questions: {
						signal: {
							type: 'choice',
							criteria: SIGNAL_CRITERIA,
							instructions: `Analyze the market conditions for ${symbol} using the provided price, VWAP, intraday range, volatility, and price change. Choose the best-supported signal.`
						}
					}
				}),
				signal: AbortSignal.timeout(20_000)
			});
			if (!upstream.ok) {
				logger.warn('Typesafe API request failed.', { symbol, status: upstream.status });
				response
					.status(502)
					.json({ error: `Typesafe API request failed with HTTP ${upstream.status}.` });
				return;
			}

			const result = await upstream.json();
			const possibleResults = [
				result?.answers?.signal?.choice,
				result?.answers?.signal,
				result?.response?.body?.questions?.signal?.criteria,
				result?.body?.questions?.signal?.criteria,
				result?.data?.body?.questions?.signal?.criteria,
				result?.data?.questions?.signal?.criteria,
				result?.response?.body?.questions?.signal,
				result?.data?.questions?.signal,
				result?.questions?.signal,
				result?.body?.questions?.signal,
				result?.data?.body?.questions?.signal,
				result?.response?.body?.signal,
				result?.body?.signal,
				result?.data?.signal,
				result?.signal
			];
			const signal = possibleResults.map(parseSignal).find(Boolean) || null;
			if (!signal) {
				logger.error('Typesafe API returned no recognized stock signal.', {
					symbol,
					responseKeys: Object.keys(result || {})
				});
				response
					.status(502)
					.json({ error: 'Typesafe API returned no valid LONG, SHORT, or NEUTRAL signal.' });
				return;
			}

			const reasoning = [
				result?.data?.reasoning,
				result?.reasoning,
				result?.data?.explanation,
				result?.explanation
			].find((value) => typeof value === 'string');
			const rawConfidence =
				result?.answers?.signal?.confidence ?? result?.data?.confidence ?? result?.confidence;
			const confidence = typeof rawConfidence === 'number' ? rawConfidence : null;
			response.status(200).json({
				success: true,
				timestamp: new Date().toISOString(),
				symbol,
				analysis: {
					signal,
					label: SIGNAL_CRITERIA[signal],
					reasoning: reasoning || '',
					confidence,
					criteria: SIGNAL_CRITERIA
				}
			});
		} catch (error) {
			logger.error('Failed to analyze stock with Typesafe.', { symbol, error });
			response.status(502).json({ error: 'Unable to complete stock analysis with Typesafe.' });
		}
	}
);

exports.hutQuote = onRequest(
	{
		region: 'us-central1',
		timeoutSeconds: 15,
		maxInstances: 5
	},
	async (request, response) => {
		response.set('Cache-Control', 'no-store');

		if (request.method !== 'GET') {
			response.set('Allow', 'GET');
			response.status(405).json({ error: 'Method not allowed.' });
			return;
		}

		try {
			const quoteResponse = await fetch(NASDAQ_HUT_QUOTE_URL, {
				headers: {
					'User-Agent': 'Mozilla/5.0',
					Accept: 'application/json, text/plain, */*'
				},
				signal: AbortSignal.timeout(10_000)
			});
			if (!quoteResponse.ok) {
				throw new Error(`Nasdaq returned HTTP ${quoteResponse.status}.`);
			}

			const payload = await quoteResponse.json();
			if (!payload?.data?.primaryData?.lastSalePrice) {
				throw new Error('Nasdaq returned an unexpected HUT quote response.');
			}

			response.status(200).json(payload);
		} catch (error) {
			logger.error('Failed to retrieve HUT quote from Nasdaq.', error);
			response.status(502).json({ error: 'Unable to retrieve HUT quote from Nasdaq.' });
		}
	}
);
