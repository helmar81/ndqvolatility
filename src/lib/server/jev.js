// src/lib/server/jev.js
import { env } from '$env/dynamic/private';



// Access variables safely:
const apiKey = env.KRAKEN_API_KEY || '';
const apiSecret = env.KRAKEN_API_SECRET || '';

/**
 * Analyzes BTC/USD market context using TypeSafe AI Jev
 * @param {{ price: number; high: number; low: number; volume?: number }} marketContext
 * @returns {Promise<{ signal: 'LONG' | 'SHORT' | 'NEUTRAL'; confidence: number; reasoning: string; stopLoss: number; takeProfit: number }>}
 */
export async function analyzeEntryWithJev(marketContext) {
  const apiKey = env.JEV_API_KEY || '';

  if (!apiKey) {
    // Mock response when JEV_API_KEY is not configured in .env
    return {
      signal: 'LONG',
      confidence: 0.85,
      reasoning: 'Price holding above 24h average volume range.',
      stopLoss: marketContext.price * 0.98,
      takeProfit: marketContext.price * 1.05
    };
  }

  const prompt = `Analyze market conditions for BTC/USD:
- Current Price: $${marketContext.price}
- High: $${marketContext.high}
- Low: $${marketContext.low}`;

  const response = await fetch('https://api.typesafe.ai/v1/jev/analyze', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ prompt })
  });

  if (!response.ok) {
    throw new Error(`Jev API request failed: ${response.statusText}`);
  }

  const result = await response.json();
  return result.data;
}