/**
 * Shared helpers for talking to /api/market-data. Both index.html
 * (dashboard) and analysis.html (narrative page) load this before
 * app.js / analysis-page.js.
 */
const MarketData = (() => {
  const TF_INTERVALS = { D1: 'daily', H4: '4h', H1: '1h', M15: '15min', M5: '5min' };

  async function fetchJSON(url) {
    try {
      const r = await fetch(url);
      const j = await r.json();
      if (!r.ok) return { error: j.error || 'Request failed' };
      return j;
    } catch (e) {
      return { error: 'Backend unreachable (is /api deployed?)' };
    }
  }

  async function fetchCandles(tfType) {
    if (tfType === 'daily') {
      const d = await fetchJSON('/api/market-data?type=daily');
      return d.candles || null;
    }
    const d = await fetchJSON(`/api/market-data?type=intraday&interval=${tfType}`);
    return d.candles || null;
  }

  /** Fetch D1/H4/H1/M15 together and run SMC.analyzeCandles on each. */
  async function fetchAndAnalyzeAll() {
    const [d1, h4, h1, m15] = await Promise.all([
      fetchCandles(TF_INTERVALS.D1),
      fetchCandles(TF_INTERVALS.H4),
      fetchCandles(TF_INTERVALS.H1),
      fetchCandles(TF_INTERVALS.M15)
    ]);
    if (!d1 || !h4 || !h1 || !m15) return null;
    return {
      D1: SMC.analyzeCandles(d1),
      H4: SMC.analyzeCandles(h4),
      H1: SMC.analyzeCandles(h1),
      M15: SMC.analyzeCandles(m15)
    };
  }

  return { TF_INTERVALS, fetchJSON, fetchCandles, fetchAndAnalyzeAll };
})();
