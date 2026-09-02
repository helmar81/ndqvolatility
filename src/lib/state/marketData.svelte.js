export function createMarketData() {
	/**
	 * @type {Record<string, {
	 *   symbol: string;
	 *   price: number;
	 *   history: number[];
	 *   volatility: number;
	 *   bias: string;
	 *   change: number;
	 *   vwap: number;
	 * }>}
	 */
	let stocks = $state({
		NVDA: {
			symbol: 'NVDA',
			price: 0,
			history: [],
			volatility: 0,
			bias: 'NEUTRAL',
			change: 0,
			vwap: 0
		},
		MU: {
			symbol: 'MU',
			price: 0,
			history: [],
			volatility: 0,
			bias: 'NEUTRAL',
			change: 0,
			vwap: 0
		},
		GOOGL: {
			symbol: 'GOOGL',
			price: 0,
			history: [],
			volatility: 0,
			bias: 'NEUTRAL',
			change: 0,
			vwap: 0
		},
		META: {
			symbol: 'META',
			price: 0,
			history: [],
			volatility: 0,
			bias: 'NEUTRAL',
			change: 0,
			vwap: 0
		}
	});

	let isConnected = $state(false);
	let isMocking = $state(false);

	/**
	 * @type {WebSocket | null}
	 */
	let ws = null;

	/**
	 * @type {string | number | NodeJS.Timeout | null | undefined}
	 */
	let mockInterval = null;

	const API_KEY = import.meta.env.VITE_MASSIVE_API_KEY || '9hPCpdCQOCIuM0ZDlWtisGlOV0DHonnE';

	const fallbackPrices = {
		NVDA: 223.35,
		MU: 130.20,
		GOOGL: 175.40,
		META: 505.10
	};

	/**
	 * Fetch previous real market prices from Massive.
	 */
	async function fetchBasePrices() {
		if (!API_KEY) {
			throw new Error(
				'VITE_MASSIVE_API_KEY is missing. Check your .env file and restart the development server.'
			);
		}

		const symbols = Object.keys(stocks);

		for (const sym of symbols) {
			try {
				const url =
					`https://api.massive.com/v2/aggs/ticker/${sym}/prev` +
					`?adjusted=true&apiKey=${encodeURIComponent(API_KEY)}`;

				const res = await fetch(url);
				const data = await res.json();

				if (
					res.ok &&
					data.results &&
					data.results.length > 0 &&
					typeof data.results[0].c === 'number'
				) {
					const prevClose = data.results[0].c;

					stocks[sym].price = prevClose;
					stocks[sym].vwap = prevClose;
					stocks[sym].history = [prevClose];
					stocks[sym].change = 0;

					console.log(`Massive real price ${sym}: $${prevClose}`);
				} else {
					console.warn(
						`Could not fetch real price for ${sym}.`,
						data
					);

					// Use fallback only if Massive doesn't return data.
					// @ts-ignore
					stocks[sym].price = fallbackPrices[sym];
					// @ts-ignore
					stocks[sym].vwap = fallbackPrices[sym];
					// @ts-ignore
					stocks[sym].history = [fallbackPrices[sym]];
				}
			} catch (err) {
				console.error(`Failed to fetch base price for ${sym}:`, err);

				// @ts-ignore
				stocks[sym].price = fallbackPrices[sym];
				// @ts-ignore
				stocks[sym].vwap = fallbackPrices[sym];
				// @ts-ignore
				stocks[sym].history = [fallbackPrices[sym]];
			}
		}
	}

	/**
	 * Calculate volatility, VWAP and execution bias.
	 *
	 * @param {string} symbol
	 * @param {number} newPrice
	 */
	function calculateMetrics(symbol, newPrice) {
		const stock = stocks[symbol];

		if (!stock || !Number.isFinite(newPrice)) {
			return;
		}

		stock.history.push(newPrice);

		if (stock.history.length > 50) {
			stock.history.shift();
		}

		const sum = stock.history.reduce((a, b) => a + b, 0);
		stock.vwap = sum / stock.history.length;

		const mean = stock.vwap;

		const variance =
			stock.history.reduce(
				(acc, val) => acc + Math.pow(val - mean, 2),
				0
			) / stock.history.length;

		stock.volatility = Math.sqrt(variance);

		const threshold = newPrice * 0.0005;

		if (stock.volatility > threshold) {
			if (newPrice > stock.vwap) {
				stock.bias = 'LONG';
			} else if (newPrice < stock.vwap) {
				stock.bias = 'SHORT';
			} else {
				stock.bias = 'NEUTRAL';
			}
		} else {
			stock.bias = 'NEUTRAL';
		}
	}

	/**
	 * Temporary mock stream.
	 * Only used when Massive WebSocket authentication fails.
	 */
	function startMockFallback() {
		if (mockInterval) {
			return;
		}

		console.warn('Starting MOCK market-data stream.');

		isMocking = true;
		isConnected = true;

		mockInterval = setInterval(() => {
			const symbols = Object.keys(stocks);

			const numUpdates =
				Math.floor(Math.random() * 2) + 1;

			for (let i = 0; i < numUpdates; i++) {
				const sym =
					symbols[
						Math.floor(Math.random() * symbols.length)
					];

				const stock = stocks[sym];

				if (!stock || stock.price === 0) {
					continue;
				}

				const change =
					(Math.random() - 0.5) *
					(stock.price * 0.004);

				const newPrice = stock.price + change;

				stock.change = newPrice - stock.price;
				stock.price = newPrice;

				calculateMetrics(sym, newPrice);
			}
		}, 800);
	}

	/**
	 * Connect to Massive WebSocket.
	 */
	async function connect() {
		if (!API_KEY) {
			console.error(
				'VITE_MASSIVE_API_KEY is not defined.'
			);
			return;
		}

		try {
			// First load real previous prices.
			await fetchBasePrices();

			console.log(
				'Real base prices loaded. Connecting to Massive WebSocket...'
			);

			ws = new WebSocket(
				'wss://delayed.massive.com/stocks'
			);

			ws.onopen = () => {
				console.log(
					'Massive WebSocket connected. Authenticating...'
				);

				// @ts-ignore
				ws.send(
					JSON.stringify({
						action: 'auth',
						params: API_KEY
					})
				);
			};

			ws.onmessage = (event) => {
				try {
					const parsed = JSON.parse(event.data);

					// Massive normally returns an array,
					// but handle a single message too.
					const messages = Array.isArray(parsed)
						? parsed
						: [parsed];

					for (const msg of messages) {
						if (msg.ev === 'status') {
							console.log(
								'Massive status:',
								msg
							);

							if (
								msg.status ===
								'auth_success'
							) {
								isConnected = true;
								isMocking = false;

								console.log(
									'Massive authentication successful.'
								);

								// @ts-ignore
								ws.send(
									JSON.stringify({
										action: 'subscribe',
										params:
											'T.NVDA,T.MU,T.GOOGL,T.META'
									})
								);

								console.log(
									'Subscribed to NVDA, MU, GOOGL and META.'
								);
							}

							if (
								msg.status ===
								'auth_failed'
							) {
								console.error(
									'Massive WebSocket authentication failed:',
									msg
								);

								// Close WebSocket.
								// Do NOT pretend this is real-time data.
								// The app will retain the real previous-close prices.
								// @ts-ignore
								ws.close();

								startMockFallback();
							}
						}

						// Trade event
						if (msg.ev === 'T') {
							const sym = msg.sym;
							const newPrice = Number(msg.p);

							if (
								stocks[sym] &&
								Number.isFinite(newPrice)
							) {
								const stock = stocks[sym];

								stock.change =
									newPrice -
									stock.price;

								stock.price =
									newPrice;

								calculateMetrics(
									sym,
									newPrice
								);
							}
						}
					}
				} catch (err) {
					console.error(
						'Error processing Massive WebSocket message:',
						err
					);
				}
			};

			ws.onclose = () => {
				console.warn(
					'Massive WebSocket connection closed.'
				);

				if (!isMocking) {
					isConnected = false;

					console.log(
						'Reconnecting to Massive in 5 seconds...'
					);

					setTimeout(() => {
						if (!ws && !mockInterval) {
							connect();
						}
					}, 5000);
				}
			};

			ws.onerror = (err) => {
				console.error(
					'Massive WebSocket error:',
					err
				);
			};
		} catch (err) {
			console.error(
				'Failed to connect to Massive:',
				err
			);

			isConnected = false;
		}
	}

	function startStream() {
		if (!ws && !mockInterval) {
			connect();
		}
	}

	function stopStream() {
		if (ws) {
			ws.close();
			ws = null;
		}

		if (mockInterval) {
			clearInterval(mockInterval);
			mockInterval = null;
		}

		isConnected = false;
		isMocking = false;
	}

	return {
		get stocks() {
			return Object.values(stocks);
		},

		get isConnected() {
			return isConnected;
		},

		get isMocking() {
			return isMocking;
		},

		startStream,
		stopStream
	};
}

export const market = createMarketData();