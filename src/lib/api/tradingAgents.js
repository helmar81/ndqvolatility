/**
 * @param {{ ticker: string; date: string; analysts?: string; outputLanguage?: string }} options
 */
export async function analyzeTicker({
	ticker,
	date,
	analysts = 'market,news,fundamentals',
	outputLanguage = 'English'
}) {
	const rawBase = import.meta.env.VITE_API_BASE_URL ?? '';
	const baseUrl = rawBase.replace(/\/+$/, '');

	if (!baseUrl && !import.meta.env.DEV) {
		throw new Error(
			'TradingAgents backend is not configured on this deployed site. The Python backend runs separately — deploy the backend and build with VITE_API_BASE_URL set to its URL (or run locally with npm run dev).'
		);
	}

	const endpoint = baseUrl ? `${baseUrl}/api/analyze` : '/api/tradingagents/analyze';

	let response;
	try {
		response = await fetch(endpoint, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				ticker,
				date,
				analysts,
				output_language: outputLanguage
			})
		});
	} catch (error) {
		throw new Error(
			`Could not reach TradingAgents backend (${error instanceof Error ? error.message : 'connection failed'}). Ensure backend server is running on port 8000.`,
			{ cause: error }
		);
	}

	const contentType = response.headers.get('content-type') || '';
	let data;
	if (contentType.includes('application/json')) {
		try {
			data = await response.json();
		} catch {
			// json parse error handled below
		}
	}

	if (!response.ok) {
		let message = `TradingAgents request failed (HTTP ${response.status})`;
		if (data?.detail || data?.error) {
			message = data.detail || data.error;
		} else if (response.status === 502) {
			message =
				'TradingAgents backend is not responding (502 Bad Gateway). Please ensure the Python backend is running on port 8000.';
		}
		throw new Error(message);
	}

	if (!data) {
		throw new Error(
			'TradingAgents backend returned an HTML response instead of JSON. Ensure VITE_API_BASE_URL points to a valid TradingAgents backend API.'
		);
	}

	return data;
}
