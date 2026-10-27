export function createMarketData() {
	/**
	 * @type {Record<string, {
	 *   symbol: string;
	 *   krakenSymbol?: string;
	 *   price: number;
	 *   history: number[];
	 *   volatility: number;
	 *   bias: string;
	 *   change: number;
	 *   changePct: number;
	 *   vwap: number;
	 *   high: number;
	 *   low: number;
	 *   quoteStatus?: 'loading' | 'available' | 'unavailable';
	 * }>}
	 */
	let stocks = $state({
		NVDA: {
			symbol: 'NVDA',
			krakenSymbol: 'NVDAx/USD',
			price: 226.50,
			history: [226.50],
			volatility: 0,
			bias: 'NEUTRAL',
			change: 0,
			changePct: 0,
			vwap: 226.50,
			high: 0,
			low: 0
		},
		MU: {
			symbol: 'MU',
			krakenSymbol: 'MUx/USD',
			price: 112.40,
			history: [112.40],
			volatility: 0,
			bias: 'NEUTRAL',
			change: 0,
			changePct: 0,
			vwap: 112.40,
			high: 0,
			low: 0
		},
		GOOGL: {
			symbol: 'GOOGL',
			krakenSymbol: 'GOOGLx/USD',
			price: 182.20,
			history: [182.20],
			volatility: 0,
			bias: 'NEUTRAL',
			change: 0,
			changePct: 0,
			vwap: 182.20,
			high: 0,
			low: 0
		},
		META: {
			symbol: 'META',
			krakenSymbol: 'METAx/USD',
			price: 610.30,
			history: [610.30],
			volatility: 0,
			bias: 'NEUTRAL',
			change: 0,
			changePct: 0,
			vwap: 610.30,
			high: 0,
			low: 0
		},

		MRNA: {
			symbol: 'MRNA',
			krakenSymbol: 'MRNAx/USD',
			price: 150.25,
			history: [150.25],
			volatility: 0,
			bias: 'NEUTRAL',
			change: 0,
			changePct: 0,
			vwap: 211.30,
			high: 0,
			low: 0
		},

		HUT: {
			symbol: 'HUT',
			price: 0,
			history: [],
			volatility: 0,
			bias: 'NEUTRAL',
			change: 0,
			changePct: 0,
			vwap: 0,
			high: 0,
			low: 0,
			quoteStatus: 'loading'
		}
	});

	let isConnected = $state(false);
	let isMocking = $state(false);

	/**
	 * @type {WebSocket | null}
	 */
	let ws = null;

	/**
	 * Map Kraken symbols to local symbols
	 */
	/** @type {Record<string, string>} */
	const symbolMap = {
		'NVDAx/USD': 'NVDA',
		'MUx/USD': 'MU',
		'GOOGLx/USD': 'GOOGL',
		'METAx/USD': 'META',
		'MRNAx/USD': 'MRNA'
	};

	const KRAKEN_WS_URL = 'wss://ws.kraken.com/v2';
	/** @type {ReturnType<typeof setTimeout> | null} */
	let reconnectTimer = null;
	/** @type {ReturnType<typeof setInterval> | null} */
	let hutQuoteTimer = null;
	let shouldReconnect = true;

	/**
	 * Calculate volatility, VWAP, and execution bias.
	 *
	 * @param {string} symbol
	 * @param {number} newPrice
	 * @param {number} [exchangeVwap]
	 */
	function calculateMetrics(symbol, newPrice, exchangeVwap) {
		const stock = stocks[symbol];

		if (!stock || !Number.isFinite(newPrice)) {
			return;
		}

		stock.history.push(newPrice);

		if (stock.history.length > 50) {
			stock.history.shift();
		}

		const vwap = (exchangeVwap && Number.isFinite(exchangeVwap))
			? exchangeVwap
			: (stock.history.reduce((a, b) => a + b, 0) / stock.history.length);

		stock.vwap = vwap;

		// Calculate volatility as standard deviation around the VWAP
		const variance =
			stock.history.reduce(
				(acc, val) => acc + Math.pow(val - vwap, 2),
				0
			) / stock.history.length;

		stock.volatility = Math.sqrt(variance);

		const threshold = newPrice * 0.0005; // 0.05% threshold

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

	/** Fetches HUT's Nasdaq quote independently of the Kraken WebSocket feed. */
	async function refreshHutQuote() {
		try {
			const response = await fetch('/api/hut-quote', {
				signal: AbortSignal.timeout(15_000)
			});
			if (!response.ok) {
				throw new Error(`HUT quote request failed with status ${response.status}.`);
			}

			const payload = await response.json();
			const quote = payload?.data?.primaryData;
			const price = Number(quote?.lastSalePrice?.replace(/[$,]/g, ''));
			if (!Number.isFinite(price) || price <= 0) {
				throw new Error('Nasdaq returned an invalid HUT price.');
			}

			const stock = stocks.HUT;
			const change = Number(quote.netChange);
			const changePct = Number(quote.percentageChange?.replace('%', ''));
			stock.price = price;
			stock.change = Number.isFinite(change) ? change : 0;
			stock.changePct = Number.isFinite(changePct) ? changePct : 0;
			stock.quoteStatus = 'available';
			calculateMetrics('HUT', price);
		} catch (error) {
			console.error('Unable to refresh HUT quote:', error);
			stocks.HUT.quoteStatus = 'unavailable';
		}
	}

	/**
	 * Connect to Kraken WebSocket v2 and subscribe to real-time tickers.
	 */
	function connect() {
		if (ws) {
			try {
				ws.close();
			} catch {
				// Ignore close errors during reconnect.
			}
			ws = null;
		}

		console.log('Connecting to Kraken WebSocket v2...');

		try {
			ws = new WebSocket(KRAKEN_WS_URL);

			ws.onopen = () => {
				console.log('Kraken WebSocket connected. Subscribing to real-time ticker channel...');
				isConnected = true;
				isMocking = false;

				const subscriptionMessage = {
					method: 'subscribe',
					params: {
						channel: 'ticker',
						symbol: Object.keys(symbolMap)
					}
				};

				ws?.send(JSON.stringify(subscriptionMessage));
			};

			ws.onmessage = (event) => {
				try {
					const msg = JSON.parse(event.data);

					// Heartbeat or status messages
					if (msg.channel === 'heartbeat') {
						return;
					}

					if (msg.channel === 'status') {
						console.log('Kraken status:', msg);
						return;
					}

					// Subscription response
					if (msg.method === 'subscribe') {
						if (msg.success) {
							console.log('Subscribed to Kraken symbol:', msg.result?.symbol);
						} else {
							console.error('Subscription error for', msg.symbol, msg.error);
						}
						return;
					}

					// Ticker snapshots and real-time updates
					if (msg.channel === 'ticker' && Array.isArray(msg.data)) {
						for (const item of msg.data) {
							const localSym = symbolMap[item.symbol];
							if (localSym && stocks[localSym]) {
								const stock = stocks[localSym];

								if (typeof item.last === 'number' && Number.isFinite(item.last)) {
									stock.change = typeof item.change === 'number' ? item.change : (item.last - stock.price);
									stock.changePct = typeof item.change_pct === 'number' ? item.change_pct : 0;
									stock.price = item.last;

									if (typeof item.vwap === 'number' && Number.isFinite(item.vwap)) {
										stock.vwap = item.vwap;
									}
									if (typeof item.high === 'number') stock.high = item.high;
									if (typeof item.low === 'number') stock.low = item.low;

									calculateMetrics(localSym, item.last, stock.vwap);
								}
							}
						}
					}
				} catch (err) {
					console.error('Error parsing Kraken message:', err);
				}
			};

			ws.onclose = () => {
				console.warn('Kraken WebSocket closed.');
				isConnected = false;

				if (shouldReconnect) {
					if (reconnectTimer) clearTimeout(reconnectTimer);
					reconnectTimer = setTimeout(() => {
						connect();
					}, 3000);
				}
			};

			ws.onerror = (err) => {
				console.error('Kraken WebSocket error:', err);
			};
		} catch (err) {
			console.error('Failed to create WebSocket:', err);
			isConnected = false;
		}
	}

	function startStream() {
		shouldReconnect = true;
		connect();
		void refreshHutQuote();
		if (!hutQuoteTimer) {
			hutQuoteTimer = setInterval(() => {
				void refreshHutQuote();
			}, 60_000);
		}
	}

	function stopStream() {
		shouldReconnect = false;
		if (hutQuoteTimer) {
			clearInterval(hutQuoteTimer);
			hutQuoteTimer = null;
		}
		if (reconnectTimer) {
			clearTimeout(reconnectTimer);
			reconnectTimer = null;
		}
		if (ws) {
			ws.close();
			ws = null;
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