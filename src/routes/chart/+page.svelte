<script>
	import { onDestroy, onMount, tick } from 'svelte';
	import { replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Activity, ArrowLeft, RefreshCw } from '@lucide/svelte';

	/** @typedef {{time: number, open: number, high: number, low: number, close: number, volume: number}} Candle */

	/** @type {Record<string, string>} */
	const stocks = {
		NVDA: 'NVIDIA Corporation',
		MU: 'Micron Technology, Inc.',
		GOOGL: 'Alphabet Inc.',
		META: 'Meta Platforms, Inc.',
		MRNA: 'Moderna, Inc.',
		HUT: 'Hut 8 Corp.'
	};
	const timeframes = ['1m', '5m', '15m', '1h', '4h'];
	const numberFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
	const volumeFormat = new Intl.NumberFormat('en-US', {
		notation: 'compact',
		maximumFractionDigits: 1
	});
	const newYorkTime = new Intl.DateTimeFormat('en-US', {
		timeZone: 'America/New_York',
		hour: 'numeric',
		minute: '2-digit',
		hour12: true
	});
	const newYorkDate = new Intl.DateTimeFormat('en-US', {
		timeZone: 'America/New_York',
		month: 'short',
		day: 'numeric'
	});
	const newYorkDateTime = new Intl.DateTimeFormat('en-US', {
		timeZone: 'America/New_York',
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
		hour12: true
	});

	let symbol = $state('');
	let timeframe = $state('1m');
	let candles = $state(/** @type {Candle[]} */ ([]));
	let currency = $state('USD');
	let fetchedAt = $state('');
	let status = $state('loading');
	let error = $state('');
	let isRefreshing = $state(false);
	/** @type {number | undefined} */
	let intervalId;
	/** @type {AbortController | undefined} */
	let activeController;
	/** @type {HTMLDivElement | undefined} */
	let chartScroller = $state.raw(/** @type {HTMLDivElement | undefined} */ (undefined));
	let requestInFlight = false;
	let scrollToLatest = true;

	const latest = $derived(candles.at(-1));
	const watchlistIndex = $derived(Object.keys(stocks).indexOf(symbol) + 1);
	const positiveMove = $derived(
		candles.length > 1 && latest != null && latest.close >= candles[0].open
	);
	const chart = $derived.by(() => {
		if (!candles.length) return null;
		const height = 470;
		const left = 12;
		const right = 104;
		const top = 22;
		const priceBottom = 288;
		const volumeTop = 342;
		const volumeBottom = 426;
		const plotWidth = Math.max(988, candles.length * 5.5);
		const width = left + plotWidth + right;
		const highs = candles.map((candle) => candle.high);
		const lows = candles.map((candle) => candle.low);
		const rawMin = Math.min(...lows);
		const rawMax = Math.max(...highs);
		const padding = (rawMax - rawMin || rawMax * 0.001) * 0.08;
		const min = rawMin - padding;
		const max = rawMax + padding;
		/** @param {number} price */
		const priceY = (price) => priceBottom - ((price - min) / (max - min)) * (priceBottom - top);
		const slotWidth = plotWidth / candles.length;
		const candleWidth = Math.max(1.2, Math.min(10, slotWidth * 0.64));
		const maxVolume = Math.max(0, ...candles.map((candle) => candle.volume));
		return {
			width,
			height,
			left,
			right,
			top,
			priceBottom,
			volumeTop,
			volumeBottom,
			plotWidth,
			min,
			max,
			slotWidth,
			candleWidth,
			maxVolume,
			priceY,
			yTicks: Array.from({ length: 5 }, (_, index) => {
				const value = max - ((max - min) * index) / 4;
				return { value, y: priceY(value) };
			}),
			volumeTicks: [1, 0.5, 0].map((fraction) => ({
				value: maxVolume * fraction,
				y: volumeBottom - fraction * (volumeBottom - volumeTop)
			})),
			hasVolume: maxVolume > 0,
			timeTicks: Array.from({ length: Math.min(5, candles.length) }, (_, index) => {
				const tickCount = Math.min(5, candles.length);
				const candleIndex =
					tickCount === 1 ? 0 : Math.round((index * (candles.length - 1)) / (tickCount - 1));
				return { candleIndex, candle: candles[candleIndex] };
			}),
			candlePoints: candles.map((candle, index) => ({
				...candle,
				x: left + (index + 0.5) * slotWidth,
				openY: priceY(candle.open),
				closeY: priceY(candle.close),
				highY: priceY(candle.high),
				lowY: priceY(candle.low),
				volumeHeight: maxVolume > 0 ? (candle.volume / maxVolume) * (volumeBottom - volumeTop) : 0,
				up: candle.close >= candle.open
			}))
		};
	});

	/** @param {number | undefined} value */
	function formatPrice(value) {
		if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
		return new Intl.NumberFormat('en-US', {
			style: 'currency',
			currency,
			minimumFractionDigits: 2,
			maximumFractionDigits: value < 1 ? 4 : 2
		}).format(value);
	}

	/** @param {number} value */
	function formatAxisPrice(value) {
		return numberFormat.format(value);
	}

	/** @param {number} seconds */
	function formatTime(seconds) {
		return newYorkTime.format(new Date(seconds * 1000));
	}

	/** @param {number} seconds */
	function formatAxisTime(seconds) {
		return timeframe === '1m' ? formatTime(seconds) : newYorkDate.format(new Date(seconds * 1000));
	}

	/** @param {number} seconds */
	function formatFullTime(seconds) {
		return newYorkDateTime.format(new Date(seconds * 1000)) + ' ET';
	}

	async function loadCandles() {
		if (!symbol || requestInFlight) return;
		requestInFlight = true;
		const requestSymbol = symbol;
		const requestTimeframe = timeframe;
		const wasFollowingLatest =
			scrollToLatest ||
			(!!chartScroller &&
				chartScroller.scrollWidth - chartScroller.clientWidth - chartScroller.scrollLeft < 32);
		const controller = new AbortController();
		activeController = controller;
		isRefreshing = true;
		if (!candles.length) status = 'loading';
		error = '';
		try {
			const query = new URLSearchParams({ symbol: requestSymbol, timeframe: requestTimeframe });
			const response = await fetch(`/api/stock-chart?${query}`, {
				headers: { Accept: 'application/json' },
				signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)])
			});
			const payload = await response.json();
			if (!response.ok)
				throw new Error(payload?.error || `Chart request failed (${response.status}).`);
			if (!Array.isArray(payload?.candles))
				throw new Error('The chart provider returned an invalid response.');
			if (requestSymbol !== symbol || requestTimeframe !== timeframe) return;

			const receivedCandles = /** @type {Candle[]} */ (payload.candles);
			candles = receivedCandles.filter(
				(candle) =>
					Number.isFinite(candle.time) &&
					[candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite)
			);
			currency = typeof payload.currency === 'string' ? payload.currency : 'USD';
			fetchedAt = payload.fetchedAt || new Date().toISOString();
			status = candles.length ? 'ready' : 'empty';
			if (wasFollowingLatest) {
				await tick();
				if (chartScroller) {
					chartScroller.scrollTo({ left: chartScroller.scrollWidth, behavior: 'instant' });
				}
				scrollToLatest = false;
			}
		} catch (cause) {
			if (requestSymbol === symbol && requestTimeframe === timeframe) {
				error = cause instanceof Error ? cause.message : 'Unable to load this chart.';
				status = candles.length ? 'ready' : 'error';
			}
		} finally {
			requestInFlight = false;
			isRefreshing = false;
			if (activeController === controller) activeController = undefined;
			if (symbol && (requestSymbol !== symbol || requestTimeframe !== timeframe)) {
				void loadCandles();
			}
		}
	}

	/** @param {string} value */
	function chooseTimeframe(value) {
		if (!timeframes.includes(value) || value === timeframe) return;
		timeframe = value;
		scrollToLatest = true;
		const params = new URLSearchParams({ symbol, timeframe });
		replaceState(resolve(`/chart?${params}`, {}), {});
		void loadCandles();
	}

	function retry() {
		void loadCandles();
	}

	onMount(() => {
		const params = new URLSearchParams(window.location.search);
		const requestedSymbol = params.get('symbol') || '';
		const requestedTimeframe = params.get('timeframe') || '1m';
		if (!Object.hasOwn(stocks, requestedSymbol)) {
			status = 'invalid';
			error = requestedSymbol
				? 'That symbol is not in the supported screener list.'
				: 'Choose a stock from the screener to open its live chart.';
			return;
		}
		symbol = requestedSymbol;
		timeframe = timeframes.includes(requestedTimeframe) ? requestedTimeframe : '1m';
		if (requestedTimeframe !== timeframe) {
			replaceState(resolve(`/chart?${new URLSearchParams({ symbol, timeframe })}`, {}), {});
		}
		void loadCandles();
		intervalId = window.setInterval(() => void loadCandles(), 20_000);
	});

	onDestroy(() => {
		if (intervalId) window.clearInterval(intervalId);
		activeController?.abort();
	});
</script>

<svelte:head>
	<title>{symbol ? `${symbol} Live Chart` : 'Live Stock Chart'} | Nasdaq Volatility Screener</title>
	<meta
		name="description"
		content="Live intraday candlestick and volume chart for Nasdaq screener stocks."
	/>
</svelte:head>

<main class="chart-page min-h-screen px-3 pt-4 pb-10 sm:px-6 sm:pt-7">
	<div class="mx-auto max-w-[1440px]">
		<header
			class="mb-6 flex items-center justify-between gap-3 border-b border-slate-800 pb-4 sm:mb-8 sm:pb-5"
		>
			<a
				class="back-link"
				href={resolve('/', {})}
				aria-label="Return to the Nasdaq Volatility Screener"
			>
				<ArrowLeft size={17} aria-hidden="true" />
				<span>Screener</span>
			</a>
			<div
				class="flex items-center gap-2 text-[10px] font-semibold tracking-[0.2em] text-slate-500 uppercase sm:text-xs"
			>
				<Activity size={15} class="text-cyan-400" aria-hidden="true" />
				<span>Market instrument</span>
			</div>
		</header>

		{#if status === 'invalid'}
			<section class="message-panel" aria-live="polite">
				<span class="eyebrow">Chart unavailable</span>
				<h1>Choose a supported stock</h1>
				<p>{error}</p>
				<a class="primary-link" href={resolve('/', {})}>Return to screener</a>
			</section>
		{:else}
			<div class="instrument-head">
				<div class="instrument-identity">
					<span class="eyebrow"
						>VOLATILITY WATCH · {String(watchlistIndex).padStart(2, '0')} / 06</span
					>
					<h1>{symbol || 'Loading chart'}</h1>
					<p>{stocks[symbol] || 'Intraday price and volume'}</p>
				</div>
				<div class="latest-price" aria-live="polite">
					<span class="eyebrow">Latest close</span>
					<strong
						class:up-text={positiveMove}
						class:down-text={!positiveMove && candles.length > 1}
					>
						{formatPrice(latest?.close)}
					</strong>
					{#if latest}
						<span class="latest-time">{formatFullTime(latest.time)}</span>
					{/if}
				</div>
			</div>

			<section class="chart-panel" aria-label={`${symbol || 'Stock'} price chart`}>
				<div class="chart-toolbar">
					<div>
						<h2>Price action <span>/ OHLCV</span></h2>
						<p>New York market time · {timeframe} candles</p>
					</div>
					<div class="chart-status">
						{#if status === 'loading' && !candles.length}
							<span class="status-dot loading-dot"></span>
							<span>Loading feed</span>
						{:else if error}
							<span class="status-dot error-dot"></span>
							<span>Refresh issue</span>
						{:else if status === 'ready'}
							<span class="status-dot live-dot"></span>
							<span>Live · 20s refresh</span>
						{:else}
							<span class="status-dot error-dot"></span>
							<span>No data</span>
						{/if}
						<button
							class="refresh-button"
							onclick={retry}
							disabled={isRefreshing || status === 'invalid'}
							aria-label="Refresh chart data"
						>
							<span class:spin={isRefreshing}><RefreshCw size={15} aria-hidden="true" /></span>
							<span class="sr-only">Refresh now</span>
						</button>
					</div>
				</div>

				<nav class="timeframe-nav" aria-label="Chart timeframe">
					{#each timeframes as option (option)}
						<button
							class:active={timeframe === option}
							aria-pressed={timeframe === option}
							onclick={() => chooseTimeframe(option)}>{option}</button
						>
					{/each}
				</nav>

				{#if error}
					<div class="chart-alert" role="status">
						<span>{error}</span>
						{#if candles.length}
							<span
								>Showing last successful update{fetchedAt
									? ` from ${new Date(fetchedAt).toLocaleTimeString()}`
									: ''}.</span
							>
						{:else}
							<button onclick={retry}>Try again</button>
						{/if}
					</div>
				{/if}

				{#if status === 'loading' && !candles.length}
					<div class="chart-state" aria-live="polite">
						<span class="loading-line"></span>
						<strong>Loading {symbol} candles</strong>
						<span>Fetching intraday price and volume history…</span>
					</div>
				{:else if status === 'empty'}
					<div class="chart-state" aria-live="polite">
						<strong>No candles available</strong>
						<span>This symbol has no data for the selected time window. Try another interval.</span>
					</div>
				{:else if chart && latest}
					<div class="chart-area">
						<div class="ohlc-strip" aria-label="Latest candle values">
							<span>O <strong>{formatPrice(latest.open)}</strong></span>
							<span>H <strong>{formatPrice(latest.high)}</strong></span>
							<span>L <strong>{formatPrice(latest.low)}</strong></span>
							<span
								>C <strong
									class:up-text={latest.close >= latest.open}
									class:down-text={latest.close < latest.open}>{formatPrice(latest.close)}</strong
								></span
							>
							<span class:volume-pending={latest.volume === 0}>
								VOL
								<strong
									>{latest.volume === 0
										? '0 · no trade reported'
										: volumeFormat.format(latest.volume)}</strong
								>
							</span>
						</div>
						{#if latest.volume === 0 && chart.hasVolume}
							<p class="volume-note" role="status">
								Latest candle reports no volume; earlier session activity remains plotted.
							</p>
						{:else if !chart.hasVolume}
							<p class="volume-note volume-unavailable" role="status">
								Volume is unavailable for this interval from the provider.
							</p>
						{/if}
						<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
						<div
							class="chart-scroller"
							bind:this={chartScroller}
							role="region"
							aria-label="Scrollable price and volume chart. Scroll horizontally to explore candles."
							tabindex="0"
						>
							<svg
								class="market-chart"
								viewBox={`0 0 ${chart.width} ${chart.height}`}
								style={`width: ${chart.width}px; height: ${chart.height}px`}
								preserveAspectRatio="none"
								role="img"
								aria-label={`${symbol} ${timeframe} candlestick chart with ${candles.length} candles and volume`}
							>
								{#each chart.yTicks as tick (tick.value)}
									<line
										class="grid-line"
										x1={chart.left}
										x2={chart.width - chart.right}
										y1={tick.y}
										y2={tick.y}
									/>
									<text class="axis-label" x={chart.width - chart.right + 12} y={tick.y + 4}
										>{formatAxisPrice(tick.value)}</text
									>
								{/each}
								<line
									class="divider-line"
									x1={chart.left}
									x2={chart.width - chart.right}
									y1={chart.volumeTop - 12}
									y2={chart.volumeTop - 12}
								/>
								<text class="volume-label" x={chart.left} y={chart.volumeTop - 19}>VOLUME</text>
								<rect
									class="volume-band"
									x={chart.left}
									y={chart.volumeTop}
									width={chart.plotWidth}
									height={chart.volumeBottom - chart.volumeTop}
								/>
								{#if chart.hasVolume}
									{#each chart.volumeTicks as tick (tick.value)}
										<line
											class="volume-grid-line"
											x1={chart.left}
											x2={chart.width - chart.right}
											y1={tick.y}
											y2={tick.y}
										/>
										<text
											class="volume-axis-label"
											x={chart.width - chart.right + 11}
											y={tick.y - 3}
										>
											{volumeFormat.format(tick.value)}
										</text>
									{/each}
								{:else}
									<text
										class="volume-empty-label"
										x={chart.left + chart.plotWidth / 2}
										y={chart.volumeTop + (chart.volumeBottom - chart.volumeTop) / 2 + 4}
										text-anchor="middle"
									>
										NO VOLUME REPORTED FOR THIS INTERVAL
									</text>
								{/if}
								{#each chart.candlePoints as candle, index (candle.time)}
									<line
										x1={candle.x}
										x2={candle.x}
										y1={candle.highY}
										y2={candle.lowY}
										class:up-stroke={candle.up}
										class:down-stroke={!candle.up}
										stroke-width="1.35"
									/>
									<rect
										x={candle.x - chart.candleWidth / 2}
										y={Math.min(candle.openY, candle.closeY)}
										width={chart.candleWidth}
										height={Math.max(1, Math.abs(candle.closeY - candle.openY))}
										class:up-fill={candle.up}
										class:down-fill={!candle.up}
									/>
									{#if candle.volume > 0}
										<rect
											x={candle.x - chart.candleWidth / 2}
											y={chart.volumeBottom - candle.volumeHeight}
											width={chart.candleWidth}
											height={Math.max(candle.volumeHeight, 1)}
											class:volume-up={candle.up}
											class:volume-down={!candle.up}
										/>
									{/if}
									{#if index === chart.candlePoints.length - 1}
										<line
											class="last-price-line"
											x1={chart.left}
											x2={chart.width - chart.right}
											y1={candle.closeY}
											y2={candle.closeY}
										/>
										<rect
											class="last-price-tag"
											x={chart.width - chart.right + 5}
											y={candle.closeY - 10}
											width={chart.right - 7}
											height="20"
											rx="2"
										/>
										<text
											class="last-price-text"
											x={chart.width - chart.right + 10}
											y={candle.closeY + 4}>{formatAxisPrice(candle.close)}</text
										>
									{/if}
								{/each}
								{#each chart.timeTicks as tick (tick.candleIndex)}
									<text
										class="axis-label time-label"
										x={chart.left + (tick.candleIndex + 0.5) * chart.slotWidth}
										y={chart.height - 13}
										text-anchor="middle"
									>
										{formatAxisTime(tick.candle.time)}
									</text>
								{/each}
							</svg>
						</div>
					</div>
				{/if}

				<div class="chart-footer">
					<span>Price and volume · Source: Yahoo Finance</span>
					<span
						>{fetchedAt
							? `Updated ${new Date(fetchedAt).toLocaleTimeString()}`
							: 'Waiting for first update'}</span
					>
				</div>
			</section>

			<footer class="disclaimer">
				<span>Yahoo Finance chart data is provided through an unofficial endpoint.</span>
				<span
					>Intraday history windows vary by interval; updates refresh every 20 seconds while this
					page is open.</span
				>
			</footer>
		{/if}
	</div>
</main>

<style>
	.chart-page {
		background: radial-gradient(ellipse at 82% 0%, rgb(8 145 178 / 9%), transparent 34rem), #080f1b;
		color: #e2e8f0;
		font-variant-numeric: tabular-nums;
	}

	.back-link,
	.primary-link {
		display: inline-flex;
		align-items: center;
		gap: 0.55rem;
		color: #a5b4c5;
		font-size: 0.875rem;
		font-weight: 600;
		text-decoration: none;
		transition:
			color 160ms ease,
			background 160ms ease;
	}

	.back-link:hover,
	.back-link:focus-visible {
		color: #67e8f9;
	}

	.back-link:focus-visible,
	.primary-link:focus-visible,
	button:focus-visible {
		outline: 2px solid #22d3ee;
		outline-offset: 3px;
	}

	.instrument-head {
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		gap: 1rem;
		margin-bottom: 1.5rem;
	}

	.eyebrow {
		display: block;
		color: #8293a9;
		font-size: 0.65rem;
		font-weight: 700;
		letter-spacing: 0.16em;
		text-transform: uppercase;
	}

	.instrument-identity h1 {
		margin: 0.35rem 0 0;
		color: #f8fafc;
		font-size: clamp(2.1rem, 5vw, 3.25rem);
		font-weight: 750;
		letter-spacing: -0.055em;
		line-height: 1;
	}

	.instrument-identity p {
		margin: 0.45rem 0 0;
		color: #91a0b4;
		font-size: 0.9rem;
	}

	.latest-price {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
	}

	.latest-price strong {
		margin-top: 0.15rem;
		color: #f8fafc;
		font-size: clamp(1.5rem, 4vw, 2.2rem);
		font-weight: 700;
		letter-spacing: -0.04em;
	}

	.latest-time {
		margin-top: 0.2rem;
		color: #8293a9;
		font-size: 0.72rem;
	}

	.up-text {
		color: #4ade80 !important;
	}

	.down-text {
		color: #fb7185 !important;
	}

	.chart-panel {
		overflow: hidden;
		border: 1px solid #223044;
		background: linear-gradient(145deg, rgb(15 25 41 / 98%), rgb(9 16 28 / 98%));
		box-shadow: 0 24px 72px rgb(0 0 0 / 22%);
	}

	.chart-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 1.15rem 1.3rem 1rem;
	}

	.chart-toolbar h2 {
		margin: 0;
		color: #e7edf5;
		font-size: 0.95rem;
		font-weight: 650;
		letter-spacing: -0.01em;
	}

	.chart-toolbar h2 span {
		color: #63748b;
		font-weight: 500;
	}

	.chart-toolbar p {
		margin: 0.32rem 0 0;
		color: #73839a;
		font-size: 0.72rem;
	}

	.chart-status {
		display: flex;
		align-items: center;
		gap: 0.48rem;
		color: #93a2b6;
		font-size: 0.72rem;
		white-space: nowrap;
	}

	.status-dot {
		width: 0.45rem;
		height: 0.45rem;
		border-radius: 50%;
	}

	.live-dot {
		background: #4ade80;
		box-shadow: 0 0 10px rgb(74 222 128 / 44%);
	}

	.error-dot {
		background: #fb7185;
	}

	.loading-dot {
		background: #22d3ee;
		animation: pulse 1.4s ease-in-out infinite;
	}

	.refresh-button {
		display: grid;
		width: 2rem;
		height: 2rem;
		place-items: center;
		margin-left: 0.25rem;
		border: 1px solid #29384d;
		background: #111d2e;
		color: #9fb0c4;
		cursor: pointer;
		transition:
			border-color 150ms ease,
			color 150ms ease;
	}

	.refresh-button:hover:not(:disabled) {
		border-color: #22d3ee;
		color: #67e8f9;
	}

	.refresh-button:disabled {
		cursor: wait;
		opacity: 0.7;
	}

	.spin {
		animation: spin 1s linear infinite;
	}

	.timeframe-nav {
		display: flex;
		gap: 0.25rem;
		padding: 0 1.3rem 0.85rem;
	}

	.timeframe-nav button {
		min-width: 2.75rem;
		padding: 0.4rem 0.68rem;
		border: 1px solid transparent;
		background: transparent;
		color: #8493a7;
		font: inherit;
		font-size: 0.75rem;
		font-weight: 650;
		cursor: pointer;
		transition:
			background 140ms ease,
			border-color 140ms ease,
			color 140ms ease;
	}

	.timeframe-nav button:hover {
		color: #d8e5f1;
	}

	.timeframe-nav button.active {
		border-color: rgb(34 211 238 / 32%);
		background: rgb(8 145 178 / 16%);
		color: #67e8f9;
	}

	.chart-area {
		padding: 0 0.6rem;
	}

	.ohlc-strip {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem 1.1rem;
		padding: 0.72rem 0.7rem 0.25rem;
		color: #73839a;
		font-size: 0.68rem;
	}

	.ohlc-strip strong {
		margin-left: 0.2rem;
		color: #e2e8f0;
		font-weight: 600;
	}

	.volume-pending strong {
		color: #fbbf24;
	}

	.volume-note {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		margin: 0.15rem 0.7rem 0.45rem;
		color: #b9c7d7;
		font-size: 0.74rem;
		line-height: 1.45;
	}

	.volume-note::before {
		width: 0.4rem;
		height: 0.4rem;
		flex: none;
		background: #fbbf24;
		content: '';
	}

	.volume-unavailable {
		color: #fca5a5;
	}

	.volume-unavailable::before {
		background: #fb7185;
	}

	.chart-scroller {
		overflow-x: auto;
		overflow-y: hidden;
		overscroll-behavior-inline: contain;
		scrollbar-color: #315064 #101a29;
		scrollbar-width: thin;
		touch-action: pan-x pan-y;
	}

	.chart-scroller:focus-visible {
		outline: 2px solid #22d3ee;
		outline-offset: -2px;
	}

	.market-chart {
		display: block;
		max-width: none;
	}

	.grid-line {
		stroke: #233146;
		stroke-width: 1;
		stroke-dasharray: 2 5;
	}

	.divider-line {
		stroke: #2a394d;
		stroke-width: 1;
	}

	.axis-label,
	.volume-label {
		fill: #a7b5c7;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 13px;
	}

	.volume-label {
		fill: #c0cfdd;
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 1.4px;
	}

	.volume-band {
		fill: #0e1a29;
	}

	.volume-grid-line {
		stroke: #26384a;
		stroke-width: 1;
		stroke-dasharray: 2 5;
	}

	.volume-axis-label {
		fill: #9bacbe;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 11px;
	}

	.volume-empty-label {
		fill: #9bacbe;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 1px;
	}

	.volume-up {
		fill: #4ade80;
		opacity: 0.68;
	}

	.volume-down {
		fill: #fb7185;
		opacity: 0.68;
	}

	.up-stroke {
		stroke: #4ade80;
	}

	.down-stroke {
		stroke: #fb7185;
	}

	.up-fill {
		fill: #4ade80;
	}

	.down-fill {
		fill: #fb7185;
	}

	.last-price-line {
		stroke: #22d3ee;
		stroke-width: 1;
		stroke-dasharray: 4 4;
		opacity: 0.75;
	}

	.last-price-tag {
		fill: #0e7490;
	}

	.last-price-text {
		fill: white;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 12px;
		font-weight: 700;
	}

	.chart-footer {
		display: flex;
		justify-content: space-between;
		gap: 0.6rem;
		padding: 0.75rem 1.3rem;
		border-top: 1px solid #1e2a3b;
		color: #6f7f94;
		font-size: 0.67rem;
	}

	.chart-alert {
		display: flex;
		justify-content: space-between;
		gap: 0.75rem;
		margin: 0 1.3rem 0.65rem;
		padding: 0.7rem 0.8rem;
		border-left: 2px solid #f87171;
		background: rgb(127 29 29 / 17%);
		color: #fca5a5;
		font-size: 0.75rem;
	}

	.chart-alert button {
		flex: none;
		border: 0;
		background: transparent;
		color: #67e8f9;
		font: inherit;
		font-weight: 700;
		cursor: pointer;
	}

	.chart-state {
		display: flex;
		min-height: 320px;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.65rem;
		padding: 2rem;
		text-align: center;
	}

	.chart-state strong {
		color: #dce7f2;
		font-size: 0.95rem;
	}

	.chart-state > span:not(.loading-line) {
		max-width: 27rem;
		color: #8191a7;
		font-size: 0.8rem;
	}

	.loading-line {
		width: 2rem;
		height: 2rem;
		border: 2px solid #26364a;
		border-top-color: #22d3ee;
		border-radius: 50%;
		animation: spin 0.85s linear infinite;
	}

	.disclaimer {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		margin-top: 1.1rem;
		color: #718197;
		font-size: 0.68rem;
		line-height: 1.6;
	}

	.message-panel {
		max-width: 42rem;
		margin: 10vh auto 0;
		padding: clamp(1.5rem, 5vw, 3rem);
		border: 1px solid #223044;
		background: #0e1929;
	}

	.message-panel h1 {
		margin: 0.6rem 0;
		color: #f8fafc;
		font-size: 1.65rem;
		letter-spacing: -0.04em;
	}

	.message-panel p {
		margin-bottom: 1.4rem;
		color: #94a3b8;
		font-size: 0.9rem;
	}

	.primary-link {
		padding: 0.65rem 0.9rem;
		background: #0e7490;
		color: #ecfeff;
	}

	.primary-link:hover {
		background: #0891b2;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@keyframes pulse {
		50% {
			opacity: 0.45;
		}
	}

	@media (max-width: 640px) {
		.instrument-head {
			align-items: flex-start;
		}

		.latest-price {
			padding-top: 0.25rem;
		}

		.chart-toolbar {
			padding: 1rem 0.85rem 0.8rem;
		}

		.timeframe-nav {
			padding: 0 0.85rem 0.7rem;
		}

		.timeframe-nav button {
			min-width: 2.45rem;
			padding: 0.38rem 0.55rem;
		}

		.ohlc-strip {
			gap: 0.35rem 0.7rem;
			padding-inline: 0.35rem;
			font-size: 0.69rem;
		}

		.volume-note {
			align-items: flex-start;
			margin-inline: 0.35rem;
			font-size: 0.72rem;
		}

		.chart-footer,
		.disclaimer {
			flex-direction: column;
			gap: 0.25rem;
		}

		.chart-footer {
			padding-inline: 0.85rem;
		}

		.chart-alert {
			flex-direction: column;
			margin-inline: 0.85rem;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		* {
			animation-duration: 0.01ms !important;
			animation-iteration-count: 1 !important;
			scroll-behavior: auto !important;
		}
	}
</style>
