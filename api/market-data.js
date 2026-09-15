/**
 * /api/market-data
 * -----------------
 * Deployed as a Vercel serverless function. This is the ONLY place the
 * market-data API key is referenced — it lives in an environment
 * variable on the server (Vercel dashboard -> Settings -> Environment
 * Variables), NEVER in any file shipped to the browser.
 *
 * Provider: Twelve Data (https://twelvedata.com) — chosen instead of
 * Alpha Vantage because Alpha Vantage's free tier no longer reliably
 * serves XAU/USD (CURRENCY_EXCHANGE_RATE is premium-only, and FX_DAILY/
 * FX_INTRADAY frequently reject the XAU pair outright). Twelve Data's
 * free tier explicitly supports XAU/USD as a standard symbol.
 *
 * Set:   MARKET_DATA_API_KEY = <your Twelve Data API key>
 * Get a free key at: https://twelvedata.com/pricing  (free plan: 800
 * requests/day, 8/min — plenty for personal use)
 *
 * Frontend calls (unchanged contract — swapping providers again later
 * only means editing this file, never the frontend):
 *   GET /api/market-data?type=quote
 *   GET /api/market-data?type=intraday&interval=5min   (5min|15min|1h|4h)
 *   GET /api/market-data?type=daily
 */

const BASE = 'https://api.twelvedata.com';
const SYMBOL = 'XAU/USD';

// Best-effort macro symbols on Twelve Data's free tier. Coverage for
// indices/yields varies by plan — if a symbol below isn't available on
// your key, this endpoint returns an honest error instead of a fake
// number; adjust the symbol strings here once you've confirmed what
// your Twelve Data plan actually supports.
const MACRO_SYMBOLS = { dxy: 'DXY', us10y: 'US10Y' };

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
    if (type === 'dxy' || type === 'us10y') {
      const symbol = MACRO_SYMBOLS[type];
      const url = `${BASE}/quote?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`;
      const upstream = await fetch(url);
      const q = await upstream.json();

      if (q.status === 'error' || q.code) {
        return res.status(200).json({
          error: `${symbol} not available from the current provider/plan.`,
          detail: q.message || q,
          available: false
        });
      }

      return res.status(200).json({
        symbol,
        price: parseFloat(q.close),
        change: parseFloat(q.percent_change),
        time: q.datetime,
        available: true
      });
    }

    if (type === 'quote') {
      const url = `${BASE}/quote?symbol=${encodeURIComponent(SYMBOL)}&apikey=${apiKey}`;
      const upstream = await fetch(url);
      const q = await upstream.json();

      if (q.status === 'error' || q.code) {
        return res.status(q.code === 429 ? 429 : 502).json({ error: 'Market data provider error.', detail: q.message || q });
      }

      return res.status(200).json({
        symbol: 'XAUUSD',
        price: parseFloat(q.close),
        dayHigh: parseFloat(q.high),
        dayLow: parseFloat(q.low),
        previousClose: parseFloat(q.previous_close),
        change: parseFloat(q.percent_change),
        time: q.datetime
      });
    }

    if (type === 'intraday' || type === 'daily') {
      const tdInterval = type === 'daily' ? '1day' : interval; // e.g. 5min | 15min | 1h | 4h
      const outputsize = type === 'daily' ? 5 : 200;
      const url = `${BASE}/time_series?symbol=${encodeURIComponent(SYMBOL)}&interval=${tdInterval}&outputsize=${outputsize}&apikey=${apiKey}`;
      const upstream = await fetch(url);
      const data = await upstream.json();

      if (data.status === 'error' || !data.values) {
        return res.status(data.code === 429 ? 429 : 502).json({ error: 'Market data provider error.', detail: data.message || data });
      }

      const candles = data.values
        .map(v => ({
          time: Math.floor(new Date(v.datetime.replace(' ', 'T') + 'Z').getTime() / 1000),
          open: parseFloat(v.open),
          high: parseFloat(v.high),
          low: parseFloat(v.low),
          close: parseFloat(v.close)
        }))
        .sort((a, b) => a.time - b.time); // Twelve Data returns newest-first — flip to chronological

      return res.status(200).json({ symbol: 'XAUUSD', interval: tdInterval, candles });
    }

    return res.status(400).json({ error: 'Unknown type. Use quote | intraday | daily | dxy | us10y.' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to reach market data provider.', detail: String(err) });
  }
};
