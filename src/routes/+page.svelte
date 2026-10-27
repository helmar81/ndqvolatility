<script>
	import { market } from '$lib/state/marketData.svelte.js';
	import { onMount, onDestroy } from 'svelte';
	import {
		Activity,
		TrendingUp,
		TrendingDown,
		Minus,
		ShieldAlert,
		Sparkles,
		LoaderCircle,
		CircleAlert
	} from '@lucide/svelte';

	const year = new Date().getFullYear();

	/** @type {Record<string, { loading: boolean; error: string; analysis: {
	 * signal: 'LONG' | 'SHORT' | 'NEUTRAL';
	 * label: string;
	 * reasoning: string;
	 * confidence: number | null;
	 * criteria: Record<string, string>;
	 * } | null }>} */
	let stockAnalyses = $state({});

	onMount(() => {
		market.startStream();
	});

	onDestroy(() => {
		market.stopStream();
	});

	/**
	 * @param {{ symbol?: string; price?: number; history?: number[]; volatility?: number; bias?: string; change: any; vwap?: number; }} stock
	 */
	function getPriceClass(stock) {
		if (stock.change > 0) return 'tick-up';
		if (stock.change < 0) return 'tick-down';
		return '';
	}

	/**
	 * @param {string} bias
	 */
	function getBiasIcon(bias) {
		if (bias === 'LONG') return TrendingUp;
		if (bias === 'SHORT') return TrendingDown;
		return Minus;
	}

	/**
	 * @param {string} bias
	 */
	function getBiasColor(bias) {
		if (bias === 'LONG') return 'text-green-400';
		if (bias === 'SHORT') return 'text-red-400';
		return 'text-slate-400';
	}

	/**
	 * Opens a chart URL containing only an allowlisted symbol, without sharing opener state.
	 *
	 * @param {string} symbol
	 */
	function openStockChart(symbol) {
		const url = `/chart?${new URLSearchParams({ symbol, timeframe: '1m' })}`;
		window.open(
			url,
			`nasdaq-chart-${symbol}`,
			'popup=yes,width=1180,height=820,resizable=yes,scrollbars=yes,noopener,noreferrer'
		);
	}

	/**
	 * @param {typeof market.stocks[number]} stock
	 */
	async function runStockAnalysis(stock) {
		if (stockAnalyses[stock.symbol]?.loading) return;

		stockAnalyses[stock.symbol] = {
			loading: true,
			error: '',
			analysis: stockAnalyses[stock.symbol]?.analysis || null
		};

		try {
			const response = await fetch('/api/analyze', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					symbol: stock.symbol,
					price: stock.price,
					high: stock.high > 0 ? stock.high : undefined,
					low: stock.low > 0 ? stock.low : undefined,
					vwap: stock.vwap > 0 ? stock.vwap : undefined,
					volatility: stock.volatility,
					change: stock.change,
					changePct: stock.changePct
				})
			});
			const payload = await response.json();
			if (!response.ok) {
				throw new Error(payload?.error || `Stock analysis failed (HTTP ${response.status}).`);
			}
			if (
				!payload?.success ||
				!['LONG', 'SHORT', 'NEUTRAL'].includes(payload.analysis?.signal)
			) {
				throw new Error('The analysis service returned an invalid result.');
			}

			stockAnalyses[stock.symbol] = {
				loading: false,
				error: '',
				analysis: payload.analysis
			};
		} catch (error) {
			stockAnalyses[stock.symbol] = {
				loading: false,
				error: error instanceof Error ? error.message : 'Unable to analyze this stock.',
				analysis: stockAnalyses[stock.symbol]?.analysis || null
			};
		}
	}
</script>

<div class="mx-auto max-w-6xl px-3 pb-6 pt-3 sm:px-4 lg:px-6">
	<main>
	<header class="mb-5 flex flex-col gap-2 border-b border-slate-800 py-4 sm:mb-8 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-6">
		<div class="flex min-w-0 items-center gap-3">
			<div class="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/10 ring-1 ring-cyan-400/30 sm:h-11 sm:w-11">
				<Activity class="h-5 w-5 text-cyan-400 sm:h-6 sm:w-6" />
			</div>
			<div class="min-w-0">
				<h1 class="text-[1.7rem] font-bold tracking-tight text-white sm:text-3xl">Nasdaq Volatility Screener</h1>
				<p class="mt-1 text-[10px] text-slate-500 sm:text-xs">
					{#if 'statusMessage' in market}
						{market.statusMessage}
					{:else}
						My favorite stocks — live Nasdaq quotes, volatility, and AI analysis.
					

					{/if}
				</p>
			</div>
		</div>

		<div class="flex items-center gap-2 self-start sm:self-auto">
			<span class="relative flex h-3 w-3">
				{#if market.isConnected}
					<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75"></span>
					<span class="relative inline-flex h-3 w-3 rounded-full bg-green-500"></span>
				{:else}
					<span class="relative inline-flex h-3 w-3 rounded-full bg-red-500"></span>
				{/if}
			</span>

			<span class="text-sm font-medium text-slate-300">
				{#if market.isMocking}
					MOCK
				{:else if market.isConnected}
					{#if 'connectionMode' in market}
						{market.connectionMode}
					{:else}
						ONLINE
					{/if}
				{:else}
					OFFLINE
				{/if}
			</span>
		</div>
	</header>

	{#if 'error' in market && market.error}
		<div class="mb-5 rounded-xl border border-red-500/30 bg-red-950/30 p-3 text-sm text-red-300 sm:p-4">
			<div class="mb-1 font-semibold">Market data warning</div>
			<div>{market.error}</div>
		</div>
	{/if}

	<div class="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6">
		{#each market.stocks as stock (stock.symbol)}
			{@const stockAnalysis = stockAnalyses[stock.symbol]}
			<div class="glass group relative overflow-hidden rounded-xl p-3.5 transition-all duration-300 hover:border-slate-600 sm:p-6">
				<div class="mb-4 flex items-start justify-between gap-3">
					<div class="min-w-0">
						<h2 class="text-2xl font-bold leading-none text-white sm:text-[2rem]">{stock.symbol}</h2>
						<p class="mt-1 text-[11px] font-mono text-slate-400 sm:text-sm">
							VWAP: ${stock.vwap.toFixed(2)}
						</p>
					</div>

					<div class="ml-auto flex flex-col items-end text-right">
						<span class={`text-2xl font-bold font-mono transition-colors duration-200 sm:text-3xl ${getPriceClass(stock)}`}>
							{stock.price > 0 ? `$${stock.price.toFixed(2)}` : '—'}
						</span>

						<span class={`mt-1 flex items-center gap-1 text-sm font-semibold ${stock.change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
							{#if stock.change > 0}
								<TrendingUp class="h-3 w-3" />
							{:else if stock.change < 0}
								<TrendingDown class="h-3 w-3" />
							{:else}
								<Minus class="h-3 w-3" />
							{/if}
							{stock.change === 0 ? '0.00' : Math.abs(stock.change).toFixed(2)}
						</span>
						{#if stock.quoteStatus === 'loading' || stock.quoteStatus === 'unavailable'}
							<span class="mt-1 text-xs text-slate-400">
								{stock.quoteStatus === 'loading' ? 'Loading Nasdaq quote…' : 'Nasdaq quote unavailable'}
							</span>
						{/if}
					</div>
				</div>

				<div class="compact-metrics mt-4 grid grid-cols-2 gap-2.5 sm:gap-4">
					<div class="rounded-lg border border-slate-700/50 bg-slate-900/50 p-2.5 sm:p-3">
						<div class="mb-1 flex items-center justify-between gap-2 text-[11px] leading-4 text-slate-400 sm:text-xs">
							<span>Volatility (σ)</span>
							{#if stock.price > 0 && stock.volatility > stock.price * 0.001}
								<ShieldAlert class="h-3 w-3 shrink-0 text-yellow-400" />
							{/if}
						</div>
						<div class="text-sm font-semibold font-mono text-cyan-300 sm:text-lg">
							{stock.volatility.toFixed(4)}
						</div>
					</div>

					<div class="rounded-lg border border-slate-700/50 bg-slate-900/50 p-2.5 sm:p-3">
						<div class="mb-1 text-[11px] leading-4 text-slate-400 sm:text-xs">Execution Bias</div>
						{#if stock.bias}
							{@const Icon = getBiasIcon(stock.bias)}
							<div class={`flex items-center gap-2 text-sm font-bold sm:text-lg ${getBiasColor(stock.bias)}`}>
								<Icon class="h-4 w-4 sm:h-5 sm:w-5" />
								{stock.bias}
							</div>
						{/if}
					</div>
				</div>

				<button
					class="mt-4 flex min-h-10 w-full items-center justify-between border border-slate-700/70 bg-slate-900/70 px-3 text-xs font-semibold text-cyan-300 transition-colors hover:border-cyan-500/50 hover:bg-cyan-950/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400"
					type="button"
					aria-label={`Open ${stock.symbol} live chart in a new window`}
					onclick={() => openStockChart(stock.symbol)}
				>
					<span>Open live chart</span>
					<span aria-hidden="true">↗</span>
				</button>

				<button
					class="mt-2 flex min-h-10 w-full items-center justify-between border border-cyan-500/40 bg-cyan-950/20 px-3 text-xs font-semibold text-cyan-200 transition-colors hover:border-cyan-400/70 hover:bg-cyan-900/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 disabled:cursor-wait disabled:opacity-70"
					type="button"
					disabled={stockAnalyses[stock.symbol]?.loading || stock.price <= 0}
					onclick={() => runStockAnalysis(stock)}
				>
					<span class="flex items-center gap-2">
						{#if stockAnalyses[stock.symbol]?.loading}
							<LoaderCircle class="h-4 w-4 animate-spin" />
							Analyzing {stock.symbol}…
						{:else}
							<Sparkles class="h-4 w-4" />
							Run stock analysis
						{/if}
					</span>
					{#if stock.price <= 0}
						<span class="text-[10px] text-slate-400">Waiting for price</span>
					{/if}
				</button>

				{#if stockAnalyses[stock.symbol]?.error}
					<div class="mt-3 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-950/30 p-3 text-xs text-red-300" role="alert">
						<CircleAlert class="mt-0.5 h-4 w-4 shrink-0" />
						<span>{stockAnalyses[stock.symbol].error}</span>
					</div>
				{/if}

				{#if stockAnalysis?.analysis}
					{@const analysis = stockAnalysis.analysis}
					{@const SignalIcon = getBiasIcon(analysis.signal)}
					<section class="mt-3 rounded-lg border border-slate-700/70 bg-slate-900/70 p-3" aria-label={`${stock.symbol} market analysis`}>
						<div class="flex items-center justify-between gap-2">
							<h3 class="text-xs font-semibold uppercase tracking-wide text-slate-300">Market signal</h3>
							<div class={`flex items-center gap-1.5 text-sm font-bold ${getBiasColor(analysis.signal)}`}>
								<SignalIcon class="h-4 w-4" />
								{analysis.label}
							</div>
						</div>
						{#if analysis.reasoning}
							<p class="mt-2 text-xs leading-5 text-slate-300">{analysis.reasoning}</p>
						{/if}
						{#if analysis.confidence !== null}
							<p class="mt-2 text-[11px] text-slate-400">
								Confidence: {Math.round(analysis.confidence * 100)}%
							</p>
						{/if}
						<div class="mt-3 grid grid-cols-3 gap-1.5">
							{#each Object.entries(analysis.criteria) as [signal, label] (signal)}
								<div class={`rounded-md border px-2 py-1.5 text-center text-[10px] ${
									analysis.signal === signal
										? `${getBiasColor(signal)} border-current bg-slate-800 font-bold`
										: 'border-slate-700 text-slate-500'
								}`}>
									<div>{signal}</div>
									<div class="mt-0.5">{label}</div>
								</div>
							{/each}
						</div>
					</section>
				{/if}

				<div class="pointer-events-none absolute -inset-px rounded-xl bg-linear-to-r from-cyan-500/30 to-blue-500/20 opacity-0 transition-opacity duration-300 group-hover:opacity-100"></div>
			</div>
		{/each}
	</div>

<aside class="ai-disclosure" aria-label="AI analysis and risk disclaimer">
  <span class="disclosure-icon" aria-hidden="true">✦</span>
  <p>
    <strong>Educational market analysis only — not financial advice.</strong>
    AI-generated BUY, SELL, and NEUTRAL signals may be inaccurate or
    outdated and do not guarantee future performance. Stock markets are
    volatile, and you may lose money. Always verify results independently
    and apply appropriate risk management.
  </p>
</aside>

	</main>

	<footer class="mt-8 border-t border-slate-800/80 pt-4 text-center text-[18px] text-slate-400 sm:text-sm">
		&copy; {year} | Built by
		<a
			href="https://uspekhi.web.app"
			target="_blank"
			rel="noopener"
			aria-label="USPEKHI Web Development"
			class="font-semibold text-slate-200 transition-colors hover:text-cyan-300"
		>
			USPEKHI
		</a>
	</footer>
</div>
