export async function analyzeTicker({
  ticker,
  date,
  analysts = 'market,news,fundamentals',
  outputLanguage = 'English'
}) {
  const baseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

  const response = await fetch(`${baseUrl}/api/analyze`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      ticker,
      date,
      analysts,
      output_language: outputLanguage
    })
  });

  if (!response.ok) {
    let message = 'TradingAgents request failed';
    try {
      const data = await response.json();
      message = data.detail || data.error || message;
    } catch {
      // ignore JSON parse failures and fall back to the default message
    }
    throw new Error(message);
  }

  return response.json();
}
