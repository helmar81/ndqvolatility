import { json } from '@sveltejs/kit';
import { analyzeEntryWithJev } from '$lib/server/jev';

const STOCK_SYMBOLS = new Set(['NVDA', 'MU', 'GOOGL', 'META', 'MRNA', 'HUT']);
const OPTIONAL_METRICS = ['high', 'low', 'vwap', 'volatility', 'change', 'changePct'];

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function POST({ request }) {
	let body;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'A valid JSON request body is required.' }, { status: 400 });
	}

	if (!isRecord(body) || typeof body.symbol !== 'string' || !STOCK_SYMBOLS.has(body.symbol)) {
		return json({ error: 'A supported stock symbol is required.' }, { status: 400 });
	}

	if (typeof body.price !== 'number' || !Number.isFinite(body.price) || body.price <= 0) {
		return json(
			{ error: 'A valid current stock price is required for analysis.' },
			{ status: 400 }
		);
	}

	/** @type {{ symbol: string; price: number; high?: number; low?: number; vwap?: number; volatility?: number; change?: number; changePct?: number }} */
	const marketContext = {
		symbol: body.symbol,
		price: body.price
	};
	for (const metric of OPTIONAL_METRICS) {
		const value = body[metric];
		if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value))) {
			return json({ error: `The ${metric} value must be a finite number.` }, { status: 400 });
		}
		if (typeof value === 'number') {
			marketContext[
				/** @type {'high' | 'low' | 'vwap' | 'volatility' | 'change' | 'changePct'} */ (metric)
			] = value;
		}
	}

	try {
		const analysis = await analyzeEntryWithJev(marketContext);
		return json(
			{
				success: true,
				timestamp: new Date().toISOString(),
				symbol: body.symbol,
				analysis
			},
			{ headers: { 'Cache-Control': 'no-store' } }
		);
	} catch (error) {
		console.error('API /api/analyze Error:', error);
		const message = error instanceof Error ? error.message : 'Unable to analyze this stock.';
		const status = message === 'JEV_API_KEY is not configured.' ? 503 : 502;
		return json({ error: message }, { status });
	}
}
