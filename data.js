/**
 * Shared helpers for talking to /api/market-data. Every page loads this
 * before smc-engine.js's consumers (app.js / analysis-page.js / etc).
 *
 * Includes a small localStorage-backed cache: every page here is a full
 * reload (not an SPA), so an in-memory cache alone wouldn't survive
 * navigation between pages. Twelve Data's free tier is only 8 requests/
 * minute, and without caching, simply clicking through Dashboard →
 * Liquidity → Structure → Setups → AI Analysis fires a fresh 5-timeframe
 * fetch on every single page load — that alone blows the limit. Caching
 * with a short TTL means "just looked this up 20-90 seconds ago" reuses
 * that answer instead of re-hitting the provider.
 */
const MarketData = (() => {
  const TF_INTERVALS = { D1: 'daily', H4: '4h', H1: '1h', M15: '15min', M5: '5min' };

  const CACHE_PREFIX = 'mdCache:';
  const CACHE_TTL_MS = { quote: 20000, intraday: 45000, daily: 120000, dxy: 60000, us10y: 60000 };

  function cacheGet(url, type) {
    try {
      const raw = localStorage.getItem(CACHE_PREFIX + url);
      if (!raw) return null;
      const { t, data } = JSON.parse(raw);
      const ttl = CACHE_TTL_MS[type] || 30000;
      if (Date.now() - t > ttl) return null;
      return data;
    } catch (e) { return null; }
  }

  function cacheSet(url, data) {
    try { localStorage.setItem(CACHE_PREFIX + url, JSON.stringify({ t: Date.now(), data })); } catch (e) { /* storage full/unavailable — skip caching silently */ }
  }

  async function fetchJSON(url, { skipCache = false } = {}) {
    const typeMatch = url.match(/[?&]type=([a-z]+)/i);
    const type = typeMatch ? typeMatch[1] : null;

    if (!skipCache && type) {
      const cached = cacheGet(url, type);
      if (cached) return cached;
    }

    try {
      const r = await fetch(url);
      const j = await r.json();
      if (!r.ok) return { error: j.error || 'Request failed' };
      if (type) cacheSet(url, j);
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
   *  feed the higher-timeframe bias vote. D1's candles double as the
   *  "daily" series for dailyLevels()/liquidity — no separate fetch. */
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

  /** Daily high/low/prev-day levels reusing D1 candles already fetched
   *  by fetchAndAnalyzeAll() — avoids a redundant extra API call. */
  function dailyLevelsFrom(structureByTF) {
    if (!structureByTF?.D1?.candles) return null;
    return SMC.dailyLevels(structureByTF.D1.candles);
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
    TF_INTERVALS, fetchJSON, fetchCandles, fetchAndAnalyzeAll, dailyLevelsFrom, fetchDXY, fetchUS10Y,
    getNewsRisk, setNextHighImpactEvent, clearNextHighImpactEvent, setNewsWarningMinutes
  };
})();
