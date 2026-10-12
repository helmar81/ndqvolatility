<script>
	import '../app.css';

	let { children } = $props();
</script>

<div class="min-h-screen bg-slate-900 text-slate-100 antialiased selection:bg-cyan-500/30">
	{@render children()}
</div>
