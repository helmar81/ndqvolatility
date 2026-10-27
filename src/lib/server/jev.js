import { env } from '$env/dynamic/private';

const TYPESAFE_URL = 'https://api.typesafe.ai/v1/systemone';
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

/**
 * @typedef {{
 *   symbol: string;
 *   price: number;
 *   high?: number;
 *   low?: number;
 *   vwap?: number;
 *   volatility?: number;
 *   change?: number;
 *   changePct?: number;
 * }} MarketContext
 */

/**
 * @param {unknown} value
 * @returns {'LONG' | 'SHORT' | 'NEUTRAL' | null}
 */
function findSignal(value) {
	if (typeof value === 'string') {
		const normalized = value.trim().toUpperCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
		return SIGNAL_ALIASES[normalized] || null;
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
		const candidate = record[key];
		if (typeof candidate === 'string') {
			const signal = findSignal(candidate);
			if (signal) return signal;
		}
		if (candidate && typeof candidate === 'object' && key !== 'criteria') {
			const signal = findSignal(candidate);
			if (signal) return signal;
		}
	}

	return null;
}

/**
 * @param {MarketContext} marketContext
 */
export async function analyzeEntryWithJev(marketContext) {
	const apiKey = env.JEV_API_KEY?.trim();
	if (!apiKey) {
		throw new Error('JEV_API_KEY is not configured.');
	}

	const state = [
		`Stock: ${marketContext.symbol}`,
		`Current price: $${marketContext.price}`,
		`Intraday high: ${marketContext.high ?? 'unavailable'}`,
		`Intraday low: ${marketContext.low ?? 'unavailable'}`,
		`VWAP: ${marketContext.vwap ?? 'unavailable'}`,
		`Volatility: ${marketContext.volatility ?? 'unavailable'}`,
		`Price change: ${marketContext.change ?? 'unavailable'}`,
		`Price change percent: ${marketContext.changePct ?? 'unavailable'}%`
	].join('\n');

	const response = await fetch(TYPESAFE_URL, {
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
					instructions: `Analyze the market conditions for ${marketContext.symbol} using the provided price, VWAP, intraday range, volatility, and price change. Choose the best-supported signal.`
				}
			}
		}),
		signal: AbortSignal.timeout(20_000)
	});

	if (!response.ok) {
		throw new Error(`Typesafe API request failed with HTTP ${response.status}.`);
	}

	const result = await response.json();
	const signalAnswers = [
		result?.answers?.signal?.choice,
		result?.answers?.signal,
		result?.response?.body?.questions?.signal?.criteria,
		result?.body?.questions?.signal?.criteria,
		result?.data?.body?.questions?.signal?.criteria,
		result?.data?.questions?.signal?.criteria,
		result?.response?.body?.questions?.signal,
		result?.body?.questions?.signal,
		result?.data?.body?.questions?.signal,
		result?.data?.questions?.signal,
		result?.response?.body?.signal,
		result?.body?.signal,
		result?.data?.signal,
		result?.signal
	];
	const signal = signalAnswers.map(findSignal).find(Boolean) || null;
	if (!signal) {
		throw new Error(
			`Typesafe API returned no valid LONG, SHORT, or NEUTRAL signal (response keys: ${Object.keys(result || {}).join(', ') || 'none'}).`
		);
	}

	const reasoning = [
		result?.data?.reasoning,
		result?.reasoning,
		result?.data?.explanation,
		result?.explanation
	].find((value) => typeof value === 'string');
	const rawConfidence =
		result?.answers?.signal?.confidence ?? result?.data?.confidence ?? result?.confidence;
	const confidence = typeof rawConfidence === 'number' ? rawConfidence : Number.NaN;

	return {
		signal,
		label: SIGNAL_CRITERIA[signal],
		reasoning: reasoning || '',
		confidence: Number.isFinite(confidence) ? confidence : null,
		criteria: SIGNAL_CRITERIA
	};
}
