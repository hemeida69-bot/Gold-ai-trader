/**
 * /api/market-data
 * -----------------
 * Deployed as a Vercel serverless function. This is the ONLY place the
 * market-data API key is referenced — it lives in an environment
 * variable on the server (Vercel dashboard -> Settings -> Environment
 * Variables), NEVER in any file shipped to the browser.
 *
 * Provider: Finnhub (https://finnhub.io) — switched from Twelve Data
 * because Twelve Data's free tier (8 requests/minute) was too easy to
 * exceed with a multi-page, multi-timeframe app. Finnhub's free tier
 * allows 60 requests/minute.
 *
 * Set:   MARKET_DATA_API_KEY = <your Finnhub API key>
 * Get a free key at: https://finnhub.io/register
 *
 * Finnhub has no native 4-hour candle resolution (only 1/5/15/30/60/D/
 * W/M), so H4 candles are built here by aggregating 60-minute candles
 * into 4-hour buckets aligned to UTC — a deterministic, honest
 * aggregation, not invented data.
 *
 * Frontend calls (unchanged contract — swapping providers again later
 * only means editing this file, never the frontend):
 *   GET /api/market-data?type=quote
 *   GET /api/market-data?type=intraday&interval=5min   (5min|15min|1h|4h)
 *   GET /api/market-data?type=daily
 *   GET /api/market-data?type=dxy | us10y
 */

const BASE = 'https://finnhub.io/api/v1';
const SYMBOL = 'OANDA:XAU_USD';

// Finnhub resolution codes per our interval names.
const RESOLUTION = { '1min': '1', '5min': '5', '15min': '15', '30min': '30', '1h': '60', 'daily': 'D' };

async function fetchCandles(symbol, resolution, fromSec, toSec, apiKey) {
  const url = `${BASE}/forex/candle?symbol=${encodeURIComponent(symbol)}&resolution=${resolution}&from=${fromSec}&to=${toSec}&token=${apiKey}`;
  const upstream = await fetch(url);
  const data = await upstream.json();
  if (data.s !== 'ok' || !Array.isArray(data.t)) {
    return { error: true, detail: data };
  }
  const candles = data.t.map((t, i) => ({
    time: t,
    open: data.o[i],
    high: data.h[i],
    low: data.l[i],
    close: data.c[i]
  })).sort((a, b) => a.time - b.time);
  return { error: false, candles };
}

/** Bucket 60-minute candles into 4-hour candles, UTC-aligned. */
function aggregateTo4h(hourlyCandles) {
  const buckets = new Map();
  for (const c of hourlyCandles) {
    const bucketStart = Math.floor(c.time / (4 * 3600)) * (4 * 3600);
    if (!buckets.has(bucketStart)) buckets.set(bucketStart, []);
    buckets.get(bucketStart).push(c);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([bucketStart, group]) => ({
      time: bucketStart,
      open: group[0].open,
      close: group[group.length - 1].close,
      high: Math.max(...group.map(c => c.high)),
      low: Math.min(...group.map(c => c.low))
    }));
}

module.exports = async (req, res) => {
  const apiKey = process.env.MARKET_DATA_API_KEY;

  if (!apiKey) {
    return res.status(503).json({
      error: 'MARKET_DATA_API_KEY is not configured on the server.',
      hint: 'Add it in your hosting provider\'s environment variables, then redeploy.'
    });
  }

  const { type = 'quote', interval = '5min' } = req.query;
  const now = Math.floor(Date.now() / 1000);

  try {
    if (type === 'dxy' || type === 'us10y') {
      // Finnhub's free tier does not reliably expose dollar-index or
      // treasury-yield quotes — return an honest "unavailable" instead
      // of guessing at a symbol that silently fails.
      return res.status(200).json({
        error: `${type.toUpperCase()} is not available on the current Finnhub plan.`,
        available: false
      });
    }

    if (type === 'quote') {
      // Live price = last 1-minute candle close. Day high/low/previous
      // close come from the daily series so they match what the rest
      // of the app already reads.
      const [oneMin, daily] = await Promise.all([
        fetchCandles(SYMBOL, RESOLUTION['1min'], now - 3600, now, apiKey),
        fetchCandles(SYMBOL, RESOLUTION.daily, now - 10 * 86400, now, apiKey)
      ]);
      if (oneMin.error || !oneMin.candles.length) {
        return res.status(502).json({ error: 'Market data provider error.', detail: oneMin.detail || 'No recent 1-minute candle.' });
      }
      if (daily.error || daily.candles.length < 2) {
        return res.status(502).json({ error: 'Market data provider error.', detail: daily.detail || 'Not enough daily candles.' });
      }
      const price = oneMin.candles[oneMin.candles.length - 1].close;
      const today = daily.candles[daily.candles.length - 1];
      const prev = daily.candles[daily.candles.length - 2];
      const change = prev.close ? ((price - prev.close) / prev.close) * 100 : null;

      return res.status(200).json({
        symbol: 'XAUUSD',
        price,
        dayHigh: today.high,
        dayLow: today.low,
        previousClose: prev.close,
        change,
        time: new Date(oneMin.candles[oneMin.candles.length - 1].time * 1000).toISOString()
      });
    }

    if (type === 'daily') {
      const result = await fetchCandles(SYMBOL, RESOLUTION.daily, now - 90 * 86400, now, apiKey);
      if (result.error) return res.status(502).json({ error: 'Market data provider error.', detail: result.detail });
      return res.status(200).json({ symbol: 'XAUUSD', interval: '1day', candles: result.candles });
    }

    if (type === 'intraday') {
      if (interval === '4h') {
        // No native 4h resolution — aggregate from 60-minute candles.
        const hourly = await fetchCandles(SYMBOL, RESOLUTION['1h'], now - 20 * 86400, now, apiKey);
        if (hourly.error) return res.status(502).json({ error: 'Market data provider error.', detail: hourly.detail });
        return res.status(200).json({ symbol: 'XAUUSD', interval: '4h', candles: aggregateTo4h(hourly.candles) });
      }
      const resolution = RESOLUTION[interval];
      if (!resolution) return res.status(400).json({ error: `Unknown interval "${interval}".` });
      const lookbackDays = { '1min': 0.2, '5min': 1, '15min': 3, '30min': 6, '1h': 12 }[interval] || 3;
      const result = await fetchCandles(SYMBOL, resolution, now - lookbackDays * 86400, now, apiKey);
      if (result.error) return res.status(502).json({ error: 'Market data provider error.', detail: result.detail });
      return res.status(200).json({ symbol: 'XAUUSD', interval, candles: result.candles });
    }

    return res.status(400).json({ error: 'Unknown type. Use quote | intraday | daily | dxy | us10y.' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to reach market data provider.', detail: String(err) });
  }
};
