/**
 * /api/market-data
 * -----------------
 * Deployed as a Vercel serverless function. This is the ONLY place the
 * market-data API key is referenced — it lives in an environment
 * variable on the server (Vercel dashboard -> Settings -> Environment
 * Variables), NEVER in any file shipped to the browser.
 *
 * Set:   MARKET_DATA_API_KEY = <your Alpha Vantage API key>
 * Get a free key at: https://www.alphavantage.co/support/#api-key
 *
 * Frontend calls:
 *   GET /api/market-data?type=quote
 *   GET /api/market-data?type=intraday&interval=5min
 *   GET /api/market-data?type=daily
 *
 * Swap ALPHA_VANTAGE_BASE / the fetch logic below for a different
 * provider (Twelve Data, Polygon, etc.) without touching the frontend —
 * the frontend only ever talks to this same-origin endpoint.
 */

const ALPHA_VANTAGE_BASE = 'https://www.alphavantage.co/query';
const FROM_SYMBOL = 'XAU';
const TO_SYMBOL = 'USD';

module.exports = async (req, res) => {
  const apiKey = process.env.MARKET_DATA_API_KEY;

  if (!apiKey) {
    // Explicit, honest failure — matches the app's "never fake data" rule.
    return res.status(503).json({
      error: 'MARKET_DATA_API_KEY is not configured on the server.',
      hint: 'Add it in your hosting provider\'s environment variables, then redeploy.'
    });
  }

  const { type = 'quote', interval = '5min' } = req.query;

  try {
    let url;
    if (type === 'quote') {
      url = `${ALPHA_VANTAGE_BASE}?function=CURRENCY_EXCHANGE_RATE&from_currency=${FROM_SYMBOL}&to_currency=${TO_SYMBOL}&apikey=${apiKey}`;
    } else if (type === 'intraday') {
      url = `${ALPHA_VANTAGE_BASE}?function=FX_INTRADAY&from_symbol=${FROM_SYMBOL}&to_symbol=${TO_SYMBOL}&interval=${interval}&outputsize=full&apikey=${apiKey}`;
    } else if (type === 'daily') {
      url = `${ALPHA_VANTAGE_BASE}?function=FX_DAILY&from_symbol=${FROM_SYMBOL}&to_symbol=${TO_SYMBOL}&outputsize=compact&apikey=${apiKey}`;
    } else {
      return res.status(400).json({ error: 'Unknown type. Use quote | intraday | daily.' });
    }

    const upstream = await fetch(url);
    const data = await upstream.json();

    if (data.Note || data.Information) {
      // Alpha Vantage rate-limit / plan message — surface it plainly.
      return res.status(429).json({ error: 'Market data provider rate limit or plan restriction.', detail: data.Note || data.Information });
    }

    // Normalize into a shape the frontend engine expects.
    if (type === 'quote') {
      const q = data['Realtime Currency Exchange Rate'];
      if (!q) return res.status(502).json({ error: 'Unexpected provider response.', raw: data });
      return res.status(200).json({
        symbol: 'XAUUSD',
        price: parseFloat(q['5. Exchange Rate']),
        time: q['6. Last Refreshed'],
        timezone: q['7. Time Zone']
      });
    }

    const seriesKey = Object.keys(data).find(k => k.toLowerCase().includes('time series'));
    if (!seriesKey) return res.status(502).json({ error: 'Unexpected provider response.', raw: data });

    const series = data[seriesKey];
    const candles = Object.entries(series)
      .map(([time, ohlc]) => ({
        time: Math.floor(new Date(time + 'Z').getTime() / 1000),
        open: parseFloat(ohlc['1. open']),
        high: parseFloat(ohlc['2. high']),
        low: parseFloat(ohlc['3. low']),
        close: parseFloat(ohlc['4. close'])
      }))
      .sort((a, b) => a.time - b.time);

    return res.status(200).json({ symbol: 'XAUUSD', interval: type === 'daily' ? '1day' : interval, candles });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to reach market data provider.', detail: String(err) });
  }
};
