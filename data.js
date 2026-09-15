/**
 * Shared helpers for talking to /api/market-data. Every page loads this
 * before smc-engine.js's consumers (app.js / analysis-page.js / etc).
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

  /** Fetch D1/H4/H1/M15/M5 together and run SMC.analyzeCandles on each.
   *  M5 is the execution timeframe (spec requirement); D1/H4/H1/M15
   *  feed the higher-timeframe bias vote. */
  async function fetchAndAnalyzeAll() {
    const [d1, h4, h1, m15, m5] = await Promise.all([
      fetchCandles(TF_INTERVALS.D1),
      fetchCandles(TF_INTERVALS.H4),
      fetchCandles(TF_INTERVALS.H1),
      fetchCandles(TF_INTERVALS.M15),
      fetchCandles(TF_INTERVALS.M5)
    ]);
    if (!d1 || !h4 || !h1 || !m15 || !m5) return null;
    return {
      D1: SMC.analyzeCandles(d1),
      H4: SMC.analyzeCandles(h4),
      H1: SMC.analyzeCandles(h1),
      M15: SMC.analyzeCandles(m15),
      M5: SMC.analyzeCandles(m5)
    };
  }

  async function fetchDXY() {
    return fetchJSON('/api/market-data?type=dxy');
  }

  async function fetchUS10Y() {
    return fetchJSON('/api/market-data?type=us10y');
  }

  // ---------------------------------------------------------------
  // News risk — MANUAL input, not fabricated. There is no free,
  // reliable economic-calendar API wired in yet (a real one is a
  // one-file addition to api/market-data.js later, same pattern as
  // the price/candle endpoints). Until then, the user tells the app
  // when the next high-impact event is via Settings, and the app
  // honestly computes time-to-event from that — it never invents an
  // event or a "Gold Impact" verdict on its own.
  // ---------------------------------------------------------------
  const NEWS_EVENT_KEY = 'goldAiTrader.nextHighImpactEvent'; // {name, time} ISO
  const NEWS_WINDOW_KEY = 'goldAiTrader.newsWarningMinutes';

  function getNewsRisk() {
    const raw = localStorage.getItem(NEWS_EVENT_KEY);
    const windowMin = parseInt(localStorage.getItem(NEWS_WINDOW_KEY) || '60', 10);
    if (!raw) return { configured: false, high: false, event: null, minutesUntil: null };
    try {
      const event = JSON.parse(raw);
      const minutesUntil = Math.round((new Date(event.time).getTime() - Date.now()) / 60000);
      const high = minutesUntil >= 0 && minutesUntil <= windowMin;
      return { configured: true, high, event, minutesUntil };
    } catch (e) {
      return { configured: false, high: false, event: null, minutesUntil: null };
    }
  }

  function setNextHighImpactEvent(name, isoTime) {
    localStorage.setItem(NEWS_EVENT_KEY, JSON.stringify({ name, time: isoTime }));
  }

  function clearNextHighImpactEvent() {
    localStorage.removeItem(NEWS_EVENT_KEY);
  }

  function setNewsWarningMinutes(min) {
    localStorage.setItem(NEWS_WINDOW_KEY, String(min));
  }

  return {
    TF_INTERVALS, fetchJSON, fetchCandles, fetchAndAnalyzeAll, fetchDXY, fetchUS10Y,
    getNewsRisk, setNextHighImpactEvent, clearNextHighImpactEvent, setNewsWarningMinutes
  };
})();
