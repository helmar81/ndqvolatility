// src/routes/api/analyze/+server.js
import { json } from '@sveltejs/kit';
import { analyzeEntryWithJev } from '$lib/server/jev';

export async function POST() {
  try {
    // 1. Fetch live market context from Kraken public API
    const tickerRes = await fetch('https://api.kraken.com/0/public/Ticker?pair=XBTUSD');
    const tickerData = await tickerRes.json();
    
    if (tickerData.error && tickerData.error.length > 0) {
      throw new Error(`Kraken Ticker Error: ${tickerData.error.join(', ')}`);
    }

    const ticker = tickerData.result.XXBTZUSD || tickerData.result.XBTUSD;
    const currentPrice = parseFloat(ticker.c[0]);

    const marketContext = {
      price: currentPrice,
      high: parseFloat(ticker.h[1]),
      low: parseFloat(ticker.l[1]),
      volume: parseFloat(ticker.v[1])
    };

    // 2. Pass market context to Jev AI engine
    const analysis = await analyzeEntryWithJev(marketContext);

    return json({
      success: true,
      timestamp: new Date().toISOString(),
      marketContext,
      analysis
    });

  } catch (error) {
    console.error('API /api/analyze Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return json({ success: false, error: message }, { status: 500 });
  }
}