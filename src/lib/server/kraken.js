// src/lib/server/kraken.js
import crypto from 'crypto';

const { KRAKEN_API_KEY, KRAKEN_API_SECRET } = process.env;

const KRAKEN_BASE_URL = 'https://api.kraken.com';

/**
 * Generates Kraken API Signature (HMAC-SHA512)
 * @param {string} path - Kraken API endpoint path (e.g., '/0/private/Balance')
 * @param {Record<string, any>} requestData - Object containing nonce and request parameters
 * @param {string} secret - Base64 encoded Kraken API Secret
 * @returns {string} Base64 encoded HMAC-SHA512 signature
 */
function getKrakenSignature(path, requestData, secret) {
  const message = new URLSearchParams(requestData).toString();
  const secretBuffer = Buffer.from(secret, 'base64');
  
  const hash = crypto.createHash('sha256');
  hash.update(requestData.nonce + message);
  const hashDigest = hash.digest();

  const hmac = crypto.createHmac('sha512', secretBuffer);
  hmac.update(path);
  hmac.update(hashDigest);

  return hmac.digest('base64');
}

/**
 * Sends authenticated POST requests to Kraken Private API
 * @param {string} endpoint - Private API endpoint name (e.g., 'Balance', 'AddOrder')
 * @param {Record<string, any>} [params={}] - Additional payload parameters
 * @returns {Promise<any>} Response result from Kraken
 */
export async function krakenPrivateRequest(endpoint, params = {}) {
  const apiKey = KRAKEN_API_KEY || '';
  const apiSecret = KRAKEN_API_SECRET || '';

  if (!apiKey || !apiSecret) {
    throw new Error('Kraken API keys are missing. Please check your .env file.');
  }

  const path = `/0/private/${endpoint}`;
  const url = `${KRAKEN_BASE_URL}${path}`;

  // Nonce must strictly increase with every call
  const nonce = Date.now().toString();
  const bodyData = { nonce, ...params };

  const signature = getKrakenSignature(path, bodyData, apiSecret);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'API-Key': apiKey,
      'API-Sign': signature,
      'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8'
    },
    body: new URLSearchParams(bodyData).toString()
  });

  const data = await response.json();

  if (data.error && data.error.length > 0) {
    throw new Error(`Kraken API Error: ${data.error.join(', ')}`);
  }

  return data.result;
}