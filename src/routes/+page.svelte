<script>
	import { market } from '$lib/state/marketData.svelte.js';
	import { analyzeTicker } from '$lib/api/tradingAgents.js';
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

	let tradingAgentsTicker = $state('NVDA');
	let tradingAgentsDate = $state(new Date().toISOString().slice(0, 10));
	let tradingAgentsState = $state({ loading: false, error: '', result: null });

	/** @type {Record<string, { loading: boolean; error: string; analysis: {
	 * signal: 'LONG' | 'SHORT' | 'NEUTRAL';
	 * label: string;
	 * reasoning: string;
	 * confidence: number | null;
	 * criteria: Record<string, string>;
	} | null }>} */
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

	/** @param {SubmitEvent} event */
	async function runTradingAgentsAnalysis(event) {
		event.preventDefault();
		if (tradingAgentsState.loading) return;

		tradingAgentsState = {
			loading: true,
			error: '',
			result: tradingAgentsState.result
		};

		try {
			const result = await analyzeTicker({
				ticker: tradingAgentsTicker,
				date: tradingAgentsDate
			});
			if (result === null) {
				throw new Error('TradingAgents returned an empty analysis result.');
			}

			tradingAgentsState = { loading: false, error: '', result };
		} catch (error) {
			tradingAgentsState = {
				loading: false,
				error: error instanceof Error ? error.message : 'Unable to run TradingAgents analysis.',
				result: tradingAgentsState.result
			};
		}
	}

	/**
	 * @param {{ symbol: string; price: number; high: number; low: number; vwap: number; volatility: number; change: number; changePct: number }} stock
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

			if (!payload?.success || !['LONG', 'SHORT', 'NEUTRAL'].includes(payload.analysis?.signal)) {
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

	/**
	 * @param {unknown} decision
	 */
	function summarizeDecision(decision) {
		if (!decision) return 'No signal yet.';
		if (typeof decision === 'string') return decision;
		if (typeof decision === 'object') {
			if ('action' in decision && typeof decision.action === 'string') return decision.action;
			if ('signal' in decision && typeof decision.signal === 'string') return decision.signal;
			if ('summary' in decision && typeof decision.summary === 'string') return decision.summary;
			if ('trade' in decision && typeof decision.trade === 'string') return decision.trade;
			return JSON.stringify(decision, null, 2);
		}
		return String(decision);
	}

	/**
	 * @param {unknown} decision
	 */
	function summaryFallback(decision) {
		if (!decision) return 'Neutral';

		if (typeof decision === 'string') {
			const lower = decision.toLowerCase();
			if (lower.includes('buy') || lower.includes('long')) return 'Long';
			if (lower.includes('sell') || lower.includes('short')) return 'Short';
			if (lower.includes('hold') || lower.includes('neutral')) return 'Neutral';
			return 'Signal';
		}

		if (typeof decision === 'object') {
			if ('action' in decision && typeof decision.action === 'string') {
				const value = decision.action.toLowerCase();
				if (value.includes('buy') || value.includes('long')) return 'Long';
				if (value.includes('sell') || value.includes('short')) return 'Short';
				if (value.includes('hold') || value.includes('neutral')) return 'Neutral';
				return 'Signal';
			}

			if ('signal' in decision && typeof decision.signal === 'string') {
				const value = decision.signal.toLowerCase();
				if (value.includes('buy') || value.includes('long')) return 'Long';
				if (value.includes('sell') || value.includes('short')) return 'Short';
				if (value.includes('hold') || value.includes('neutral')) return 'Neutral';
				return 'Signal';
			}
		}

		return 'Signal';
	}

	/**
	 * @param {unknown} decision
	 */
	function getDecisionTone(decision) {
		const value = summarizeDecision(decision).toLowerCase();

		if (value.includes('buy') || value.includes('long')) return 'text-emerald-400';
		if (value.includes('sell') || value.includes('short')) return 'text-red-400';
		if (value.includes('hold') || value.includes('neutral')) return 'text-slate-300';
		return 'text-cyan-300';
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
					<h1 class="text-[1.7rem] font-bold tracking-tight text-white sm:text-3xl">
						Nasdaq Volatility Screener
					</h1>
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

		<section class="relative mb-6 overflow-hidden rounded-2xl border border-cyan-500/20 bg-slate-950/80 p-4 shadow-[0_0_24px_rgba(34,211,238,0.08)] sm:p-5">
			<div class="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.14),transparent_35%)]"></div>

			<div class="relative">
				<div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<div class="flex items-center gap-3">
						<div class="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-500/10">
							<Sparkles class="h-5 w-5 text-cyan-300" />
						</div>
						<div>
							<p class="text-[10px] uppercase tracking-[0.28em] text-slate-400">Signal engine</p>
							<h2 class="text-lg font-semibold text-white sm:text-xl">TradingAgents Analysis</h2>
						</div>
					</div>

					<div class="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/70 px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] text-slate-300">
						<span class="h-2 w-2 rounded-full bg-cyan-400"></span>
						External analysis service
					</div>
				</div>

				<form class="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end" onsubmit={runTradingAgentsAnalysis}>
					<label class="block">
						<span class="mb-2 block text-[10px] uppercase tracking-[0.2em] text-slate-400">Ticker</span>
						<select
							bind:value={tradingAgentsTicker}
							class="w-full rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-3 text-base text-white focus:border-cyan-400 focus:outline-none"
						>
							{#each Object.values(market.stocks) as stock (stock.symbol)}
								<option value={stock.symbol}>{stock.symbol}</option>
							{/each}
						</select>
					</label>

					<label class="block">
						<span class="mb-2 block text-[10px] uppercase tracking-[0.2em] text-slate-400">Date</span>
						<input
							type="date"
							bind:value={tradingAgentsDate}
							required
							class="w-full rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-3 text-base text-white focus:border-cyan-400 focus:outline-none"
						/>
					</label>

					<button
						type="submit"
						disabled={tradingAgentsState.loading || !tradingAgentsDate}
						class="flex items-center justify-center gap-2 rounded-xl bg-linear-to-r from-cyan-400 to-blue-500 px-4 py-3 font-semibold text-slate-950 shadow-[0_0_18px_rgba(34,211,238,0.25)] transition hover:brightness-110 disabled:cursor-wait disabled:opacity-70"
					>
						{#if tradingAgentsState.loading}
							<LoaderCircle class="h-4 w-4 animate-spin" />
							Analyzing…
						{:else}
							Analyze
						{/if}
					</button>
				</form>

				{#if tradingAgentsState.error}
					<div class="mt-4 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-950/30 p-3 text-sm text-red-300" role="alert">
						<CircleAlert class="mt-0.5 h-4 w-4 shrink-0" />
						<span>{tradingAgentsState.error}</span>
					</div>
				{/if}

				{#if tradingAgentsState.result !== null}
					<section class="mt-4 rounded-xl border border-slate-700/70 bg-slate-900/70 p-3 sm:p-4" aria-label="TradingAgents analysis result">
						<div class="mb-2 flex flex-wrap items-center justify-between gap-2">
							<h3 class="text-sm font-semibold text-white">
								{tradingAgentsTicker} analysis for {tradingAgentsDate}
							</h3>
							<span class="text-[10px] uppercase tracking-[0.15em] text-slate-400">TradingAgents</span>
						</div>
						<pre class="max-h-96 overflow-auto whitespace-pre-wrap wrap-break-word rounded-lg bg-slate-950/70 p-3 text-xs leading-5 text-slate-200">{typeof tradingAgentsState.result === 'string' ? tradingAgentsState.result : JSON.stringify(tradingAgentsState.result, null, 2)}</pre>
					</section>
				{/if}
			</div>
		</section>

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
						</div>
					</div>

					<div class="mt-4 grid grid-cols-2 gap-2.5 sm:gap-4">
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

					<div class="mt-4 flex flex-col gap-2 sm:flex-row">
						<button
							class="flex min-h-10 flex-1 items-center justify-between rounded-lg border border-slate-700/70 bg-slate-900/70 px-3 text-xs font-semibold text-cyan-300 transition-colors hover:border-cyan-500/50 hover:bg-cyan-950/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400"
							type="button"
							aria-label={`Open ${stock.symbol} live chart in a new window`}
							onclick={() => openStockChart(stock.symbol)}
						>
							<span>Open live chart</span>
							<span aria-hidden="true">↗</span>
						</button>

						<button
							class="flex min-h-10 flex-1 items-center justify-between rounded-lg border border-cyan-500/40 bg-cyan-950/20 px-3 text-xs font-semibold text-cyan-200 transition-colors hover:border-cyan-400/70 hover:bg-cyan-900/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 disabled:cursor-wait disabled:opacity-70"
							type="button"
							disabled={stockAnalyses[stock.symbol]?.loading || stock.price <= 0}
							onclick={() => runStockAnalysis(stock)}
						>
							<span class="flex items-center gap-2">
								{#if stockAnalyses[stock.symbol]?.loading}
									<LoaderCircle class="h-4 w-4 animate-spin" />
									Analyzing…
								{:else}
									<Sparkles class="h-4 w-4" />
									Analyze
								{/if}
							</span>
						</button>
					</div>

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
								<h3 class="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-300">Market signal</h3>
								<div class={`flex items-center gap-1.5 text-sm font-bold ${getDecisionTone(analysis.signal)}`}>
									<SignalIcon class="h-4 w-4" />
									{analysis.label || summaryFallback(analysis.signal)}
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

		<aside class="mt-6 rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-300 sm:p-4" aria-label="AI analysis and risk disclaimer">
			<div class="flex items-start gap-3">
				<span class="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-cyan-500/10 text-cyan-300">✦</span>
				<p class="leading-5">
					<strong class="font-semibold text-slate-100">Educational market analysis only — not financial advice.</strong>
					AI-generated BUY, SELL, and NEUTRAL signals may be inaccurate or outdated and do not guarantee future performance.
					Stock markets are volatile, and you may lose money. Always verify results independently and apply appropriate risk management.
				</p>
			</div>
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