(() => {
  'use strict';

  // ---------------------------------------------------------------
  // TradingView chart (free widget — live chart, no API key needed)
  // ---------------------------------------------------------------
  let tvWidget = null;
  function mountChart(interval = '15') {
    document.getElementById('tv-chart').innerHTML = '';
    tvWidget = new TradingView.widget({
      autosize: true,
      symbol: 'OANDA:XAUUSD',
      interval,
      timezone: 'Etc/UTC',
      theme: 'dark',
      style: '1',
      locale: 'en',
      toolbar_bg: '#14161A',
      enable_publishing: false,
      hide_top_toolbar: false,
      hide_legend: false,
      save_image: false,
      container_id: 'tv-chart',
      backgroundColor: '#14161A',
      gridColor: 'rgba(255,255,255,0.05)'
    });
  }
  mountChart('15');

  document.getElementById('tf-group').addEventListener('click', (e) => {
    const btn = e.target.closest('.tf-btn');
    if (!btn) return;
    document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    mountChart(btn.dataset.tf);
  });

  // ---------------------------------------------------------------
  // Session + market status (pure calculation — always real, never fake)
  // ---------------------------------------------------------------
  function renderSessionAndStatus() {
    const now = new Date();
    const sessions = SMC.currentSession(now.getUTCHours());
    const status = SMC.marketStatus(now);
    document.getElementById('session').textContent = sessions.length ? sessions.join(' / ') : 'Off-session';
    const statusEl = document.getElementById('market-status');
    const dotEl = document.getElementById('market-dot');
    statusEl.textContent = status;
    dotEl.className = 'dot ' + (status === 'OPEN' ? 'open' : 'closed');
  }
  renderSessionAndStatus();
  setInterval(renderSessionAndStatus, 60 * 1000);

  // ---------------------------------------------------------------
  // Backend market data (quote + candles). Fails honestly if the
  // API key hasn't been configured yet — see api/market-data.js.
  // ---------------------------------------------------------------
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

  async function refreshTicker() {
    const quote = await fetchJSON('/api/market-data?type=quote');
    const priceEl = document.getElementById('price');
    const changeEl = document.getElementById('change');
    const noteEl = document.getElementById('data-source-note');

    if (quote.error) {
      priceEl.textContent = '— — —';
      priceEl.classList.add('is-stale');
      changeEl.textContent = '';
      noteEl.textContent = `Live data: not connected (${quote.error})`;
      return null;
    }

    priceEl.textContent = quote.price.toFixed(2);
    priceEl.classList.remove('is-stale');
    if (!isNaN(quote.change)) {
      changeEl.textContent = `${quote.change >= 0 ? '▲' : '▼'} ${Math.abs(quote.change).toFixed(2)}%`;
      changeEl.className = 'ticker__change ' + (quote.change >= 0 ? 'up' : 'down');
    }
    noteEl.textContent = `Live data: Twelve Data · ${quote.time}`;

    if (quote.dayHigh) document.getElementById('day-high').textContent = quote.dayHigh.toFixed(2);
    if (quote.dayLow) document.getElementById('day-low').textContent = quote.dayLow.toFixed(2);

    return quote;
  }

  async function refreshDailyLevels() {
    const daily = await fetchJSON('/api/market-data?type=daily');
    if (daily.error || !daily.candles) return null;
    const levels = SMC.dailyLevels(daily.candles);
    if (!levels) return null;
    document.getElementById('day-high').textContent = levels.dayHigh.toFixed(2);
    document.getElementById('day-low').textContent = levels.dayLow.toFixed(2);
    document.getElementById('pdh').textContent = levels.prevDayHigh.toFixed(2);
    document.getElementById('pdl').textContent = levels.prevDayLow.toFixed(2);
    return { daily, levels };
  }

  refreshTicker();
  refreshDailyLevels();
  setInterval(refreshTicker, 30 * 1000);

  // ---------------------------------------------------------------
  // ANALYZE GOLD NOW — runs the deterministic SMC engine across
  // D1 -> H4 -> H1 -> M15, with M5 as the execution timeframe.
  // ---------------------------------------------------------------
  const TF_INTERVALS = { D1: 'daily', H4: '4h', H1: '1h', M15: '15min', M5: '5min' };

  async function fetchCandles(tfType) {
    if (tfType === 'daily') {
      const d = await fetchJSON('/api/market-data?type=daily');
      return d.candles || null;
    }
    const d = await fetchJSON(`/api/market-data?type=intraday&interval=${tfType}`);
    return d.candles || null;
  }

  function analyzeTimeframe(candles) {
    const swings = SMC.findSwings(candles, 2);
    const { events, bias } = SMC.detectStructureEvents(swings);
    const sweeps = SMC.detectLiquiditySweeps(candles, swings);
    const { equalHighs, equalLows } = SMC.detectEqualLevels(swings);
    const fvgs = SMC.detectFVGs(candles);
    const displacements = SMC.detectDisplacement(candles);
    const orderBlocks = SMC.detectOrderBlocks(candles, displacements);
    const recentHigh = Math.max(...candles.slice(-50).map(c => c.high));
    const recentLow = Math.min(...candles.slice(-50).map(c => c.low));
    const currentPrice = candles[candles.length - 1].close;
    const pd = SMC.premiumDiscount(recentHigh, recentLow, currentPrice);
    return { swings, events, bias, sweeps, equalHighs, equalLows, fvgs, displacements, orderBlocks, pd, currentPrice };
  }

  function renderSignal(result) {
    const badge = document.getElementById('signal-badge');
    const body = document.getElementById('signal-body');
    badge.className = 'signal-badge ' + result.signal.toLowerCase();
    badge.textContent = result.signal === 'WAIT' ? 'WAIT / NO TRADE' : result.signal;

    let html = '';
    if (result.signal === 'BUY' || result.signal === 'SELL') {
      html += `<div class="trade-grid">
        <div class="trade-field"><div class="label">Entry Zone</div><div class="value">${result.entryZone.bottom.toFixed(2)} – ${result.entryZone.top.toFixed(2)}</div></div>
        <div class="trade-field"><div class="label">Invalidation</div><div class="value">${result.invalidation.toFixed(2)}</div></div>
        <div class="trade-field"><div class="label">Confidence</div><div class="value">${result.confidence}%</div></div>
        <div class="trade-field"><div class="label">Bias</div><div class="value">${result.signal === 'BUY' ? 'Bullish' : 'Bearish'}</div></div>
      </div>
      <div class="confidence-bar"><div class="confidence-bar__fill" style="width:${result.confidence}%"></div></div>`;
    } else {
      html += `<div class="confidence-bar"><div class="confidence-bar__fill" style="width:${result.confidence}%"></div></div>`;
    }
    html += `<ul class="reason-list">${result.reasons.map(r => `<li>${r}</li>`).join('')}</ul>`;
    body.innerHTML = html;
  }

  function renderNoData() {
    const badge = document.getElementById('signal-badge');
    const body = document.getElementById('signal-body');
    badge.className = 'signal-badge wait';
    badge.textContent = 'WAIT — LIVE DATA REQUIRED';
    body.innerHTML = `No confirmed market data is available yet, so no Entry/SL/TP is shown —
      the engine will not invent numbers. Add <code>MARKET_DATA_API_KEY</code> on the backend
      and redeploy to enable live analysis. See README.md.`;
  }

  document.getElementById('analyze-btn').addEventListener('click', async () => {
    const btn = document.getElementById('analyze-btn');
    btn.disabled = true;
    btn.textContent = 'Analyzing…';

    try {
      const [d1, h4, h1, m15] = await Promise.all([
        fetchCandles(TF_INTERVALS.D1),
        fetchCandles(TF_INTERVALS.H4),
        fetchCandles(TF_INTERVALS.H1),
        fetchCandles(TF_INTERVALS.M15)
      ]);

      if (!d1 || !h4 || !h1 || !m15) {
        renderNoData();
        return;
      }

      const structureByTF = {
        D1: analyzeTimeframe(d1),
        H4: analyzeTimeframe(h4),
        H1: analyzeTimeframe(h1),
        M15: analyzeTimeframe(m15)
      };

      const bias = SMC.htfBias(structureByTF);
      const exec = structureByTF.M15; // M5 execution data can replace M15 once available
      const result = SMC.generateSignal({
        bias,
        sweeps: exec.sweeps,
        displacements: exec.displacements,
        structureEvents: exec.events,
        fvgs: exec.fvgs,
        orderBlocks: exec.orderBlocks,
        pd: exec.pd,
        currentPrice: exec.currentPrice
      });

      renderSignal(result);
    } finally {
      btn.disabled = false;
      btn.textContent = '🧠 ANALYZE GOLD NOW';
    }
  });

  // ---------------------------------------------------------------
  // Risk calculator (deterministic math, works with zero market data)
  // ---------------------------------------------------------------
  function updateCalc() {
    const balance = parseFloat(document.getElementById('calc-balance').value) || 0;
    const riskPct = parseFloat(document.getElementById('calc-risk').value) || 0;
    const slDistance = parseFloat(document.getElementById('calc-sl').value) || 0;
    const riskAmount = balance * (riskPct / 100);
    const resultEl = document.getElementById('calc-result');

    if (slDistance <= 0) {
      resultEl.textContent = `Risk amount: $${riskAmount.toFixed(2)} · Enter a stop-loss distance to size the position`;
      return;
    }
    // For XAUUSD, 1 standard lot = 100 oz -> $1 move per pip-equivalent unit is 100 * priceMove.
    const lots = riskAmount / (slDistance * 100);
    resultEl.textContent = `Risk amount: $${riskAmount.toFixed(2)} · Position size: ${lots.toFixed(2)} lots`;
  }
  ['calc-balance', 'calc-risk', 'calc-sl'].forEach(id =>
    document.getElementById(id).addEventListener('input', updateCalc)
  );
  updateCalc();

})();
