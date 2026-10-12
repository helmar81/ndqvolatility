<script>
	import { market } from '$lib/state/marketData.svelte.js';
	import { onMount, onDestroy } from 'svelte';
	import { Activity, TrendingUp, TrendingDown, Minus, ShieldAlert } from '@lucide/svelte';

	const year = new Date().getFullYear();

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
</script>

<div class="container mx-auto p-4 max-w-6xl">
	<header class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between py-6 mb-8 border-b border-slate-800">
		<div class="flex items-center gap-3">
			<Activity class="w-8 h-8 text-cyan-400" />
			<div>
				<h1 class="text-3xl font-bold tracking-tight text-white">Nasdaq Volatility Screener</h1>
				<p class="text-xs text-slate-500 mt-1">
					{#if 'statusMessage' in market}
						{market.statusMessage}
					{:else}
						Kraken API
					{/if}
				</p>
			</div>
		</div>

		<div class="flex items-center gap-2">
			<span class="relative flex h-3 w-3">
				{#if market.isConnected}
					<span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
					<span class="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
				{:else}
					<span class="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
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
		<div class="mb-6 rounded-lg border border-red-500/30 bg-red-950/30 p-4 text-sm text-red-300">
			<div class="font-semibold mb-1">Market data warning</div>
			<div>{market.error}</div>
		</div>
	{/if}

	<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
		{#each market.stocks as stock (stock.symbol)}
			<div class="glass rounded-xl p-6 relative overflow-hidden group hover:border-slate-600 transition-all duration-300">
				<div class="flex justify-between items-start mb-4">
					<div>
						<h2 class="text-2xl font-bold text-white">{stock.symbol}</h2>
						<p class="text-sm text-slate-400 font-mono">
							VWAP: ${stock.vwap.toFixed(2)}
						</p>
					</div>

					<div class="flex flex-col items-end">
						<span class={`text-3xl font-bold font-mono transition-colors duration-200 ${getPriceClass(stock)}`}>
							{stock.price > 0 ? `$${stock.price.toFixed(2)}` : '—'}
						</span>

						<span class={`text-sm font-semibold flex items-center gap-1 ${stock.change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
							{#if stock.change > 0}
								<TrendingUp class="w-3 h-3" />
							{:else if stock.change < 0}
								<TrendingDown class="w-3 h-3" />
							{:else}
								<Minus class="w-3 h-3" />
							{/if}
							{stock.change === 0 ? '0.00' : Math.abs(stock.change).toFixed(2)}
						</span>
					</div>
				</div>

				<div class="grid grid-cols-2 gap-4 mt-6">
					<div class="bg-slate-900/50 rounded-lg p-3 border border-slate-700/50">
						<div class="text-xs text-slate-400 mb-1 flex justify-between">
							Volatility (σ)
							{#if stock.price > 0 && stock.volatility > stock.price * 0.001}
								<ShieldAlert class="w-3 h-3 text-yellow-400" />
							{/if}
						</div>
						<div class="text-lg font-semibold font-mono text-cyan-300">
							{stock.volatility.toFixed(4)}
						</div>
					</div>

					<div class="bg-slate-900/50 rounded-lg p-3 border border-slate-700/50">
						<div class="text-xs text-slate-400 mb-1">Execution Bias</div>
						{#if stock.bias}
							{@const Icon = getBiasIcon(stock.bias)}
							<div class={`text-lg font-bold flex items-center gap-2 ${getBiasColor(stock.bias)}`}>
								<Icon class="w-5 h-5" />
								{stock.bias}
							</div>
						{/if}
					</div>
				</div>

				<div class="absolute -inset-px bg-linear-to-r from-cyan-500 to-blue-500 rounded-xl opacity-0 group-hover:opacity-10 transition-opacity duration-300 pointer-events-none"></div>
			</div>
		{/each}


	</div>


<p>
        &copy; {year} | Built by
        <a
            href="https://uspekhi.web.app"
            target="_blank"
            rel="noopener"
            aria-label="USPEKHI Web Development"
            class="font-semibold text-gray-700 hover:text-[#3b82f6] transition-colors dark:text-gray-300 dark:hover:text-[#3b82f6]"
        >
            USPEKHI
        </a>
    </p>

</div>
