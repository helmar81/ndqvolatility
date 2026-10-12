import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit(),
		SvelteKitPWA({
			srcDir: './src',
			mode: 'development',
			strategies: 'generateSW',
			manifest: {
				short_name: 'Volatility',
				name: 'Nasdaq Volatility Screener',
				start_url: '/',
				display: 'standalone',
				theme_color: '#0f172a',
				background_color: '#0f172a',
				icons: [
					{
						src: '/assets/icon-192.png',
						sizes: '192x192',
						type: 'image/png'
					},
					{
						src: '/assets/icon-512.png',
						sizes: '512x512',
						type: 'image/png'
					}
				]
			}
		})
	]
});
