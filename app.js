(() => {
  'use strict';

  // ---------------------------------------------------------------
  // TradingView chart (small, capped height on the dashboard)
  // ---------------------------------------------------------------
  function mountChart(interval = '15') {
    const el = document.getElementById('tv-chart');
    if (!el) return;
    el.innerHTML = '';
    new TradingView.widget({
      autosize: true,
      symbol: 'OANDA:XAUUSD',
      interval,
      timezone: 'Etc/UTC',
      theme: 'dark',
      style: '1',
      locale: 'en',
      toolbar_bg: '#14161A',
      enable_publishing: false,
      hide_top_toolbar: true,
      hide_legend: true,
      save_image: false,
      container_id: 'tv-chart',
      backgroundColor: '#14161A',
      gridColor: 'rgba(255,255,255,0.05)'
    });
  }
  mountChart('15');

  document.getElementById('tf-group')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.tf-btn');
    if (!btn) return;
    document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    mountChart(btn.dataset.tf);
  });

  // ---------------------------------------------------------------
  // Session + market status
  // ---------------------------------------------------------------
  function renderSessionAndStatus() {
    const now = new Date();
    const sessions = SMC.currentSession(now.getUTCHours());
    const status = SMC.marketStatus(now);
    const sessionText = sessions.length ? sessions.join(' / ') : 'Off-session';
    const el = document.getElementById('session');
    if (el) el.textContent = sessionText;
    Layout.setStatusBar({ sessionText });
  }
  renderSessionAndStatus();
  setInterval(renderSessionAndStatus, 60 * 1000);

  // ---------------------------------------------------------------
  // Ticker + overview strip
  // ---------------------------------------------------------------
  async function refreshTicker() {
    const quote = await MarketData.fetchJSON('/api/market-data?type=quote');
    const priceEl = document.getElementById('price');
    const changeEl = document.getElementById('change');
    const noteEl = document.getElementById('data-source-note');

    if (quote.error) {
      priceEl.textContent = '— — —';
      priceEl.classList.add('is-stale');
      changeEl.textContent = '';
      noteEl.textContent = `Live data: not connected (${quote.error})`;
      Layout.setStatusBar({ apiOk: false });
      return null;
    }

    priceEl.textContent = quote.price.toFixed(2);
    priceEl.classList.remove('is-stale');
    if (!isNaN(quote.change)) {
      changeEl.textContent = `${quote.change >= 0 ? '▲' : '▼'} ${Math.abs(quote.change).toFixed(2)}%`;
      changeEl.className = 'ticker__change ' + (quote.change >= 0 ? 'up' : 'down');
    }
    noteEl.textContent = `Live · Twelve Data · ${quote.time}`;
    if (quote.dayHigh) document.getElementById('day-high').textContent = quote.dayHigh.toFixed(2);
    if (quote.dayLow) document.getElementById('day-low').textContent = quote.dayLow.toFixed(2);
    Layout.setStatusBar({ apiOk: true, lastUpdateText: 'just now' });
    return quote;
  }

  async function refreshDailyLevels() {
    const daily = await MarketData.fetchJSON('/api/market-data?type=daily');
    if (daily.error || !daily.candles) return null;
    const levels = SMC.dailyLevels(daily.candles);
    if (!levels) return null;
    document.getElementById('pdh').textContent = levels.prevDayHigh.toFixed(2);
    document.getElementById('pdl').textContent = levels.prevDayLow.toFixed(2);
    return levels;
  }

  refreshTicker();
  refreshDailyLevels();
  setInterval(refreshTicker, 30 * 1000);

  // ---------------------------------------------------------------
  // Macro strip (DXY / US10Y) — best-effort, honest if unavailable
  // ---------------------------------------------------------------
  async function refreshMacroStrip() {
    const [dxy, us10y] = await Promise.all([MarketData.fetchDXY(), MarketData.fetchUS10Y()]);
    const dxyEl = document.getElementById('dxy-value');
    const us10yEl = document.getElementById('us10y-value');
    if (dxyEl) dxyEl.textContent = (dxy && dxy.available) ? dxy.price.toFixed(2) : 'N/A';
    if (us10yEl) us10yEl.textContent = (us10y && us10y.available) ? us10y.price.toFixed(2) : 'N/A';

    const risk = MarketData.getNewsRisk();
    const box = document.getElementById('news-risk-mini');
    if (box) {
      if (!risk.configured) {
        box.innerHTML = `<div class="news-risk-banner low">No event configured — set one in Settings</div>`;
      } else if (risk.high) {
        box.innerHTML = `<div class="news-risk-banner high">⚠️ ${risk.event.name} in ${risk.minutesUntil} min</div>`;
      } else {
        box.innerHTML = `<div class="news-risk-banner low">Next: ${risk.event.name}</div>`;
      }
    }
    return risk;
  }
  refreshMacroStrip();

  // ---------------------------------------------------------------
  // ANALYZE GOLD NOW — full pipeline, renders Decision Center
  // ---------------------------------------------------------------
  function renderCurrentAction(result) {
    const box = document.getElementById('current-action');
    const sub = document.getElementById('current-action-sub');
    let cls = 'wait', label = '⚪ WAIT';
    if (result.signal === 'AVOID') { cls = 'avoid'; label = '⚠️ AVOID — HIGH IMPACT NEWS'; }
    else if (result.signal === 'BUY') { cls = 'buy'; label = '🟢 BUY'; }
    else if (result.signal === 'SELL') { cls = 'sell'; label = '🔴 SELL'; }
    else if (result.waitState === 'WAIT_FOR_BUY') { cls = 'wait-buy'; label = '🟡 WAIT FOR BUY'; }
    else if (result.waitState === 'WAIT_FOR_SELL') { cls = 'wait-sell'; label = '🟡 WAIT FOR SELL'; }

    box.className = 'current-action ' + cls;
    box.innerHTML = `${label}<div class="sub" id="current-action-sub"></div>`;
    document.getElementById('current-action-sub').textContent =
      result.signal === 'BUY' || result.signal === 'SELL'
        ? `Setup Score ${result.setupScore}/100 · Confidence ${result.confidence}%`
        : (result.reasons && result.reasons.find(r => r.startsWith('❌')) || result.reasons?.[0] || '');
  }

  function renderSetupCard(elId, gradeElId, result, direction) {
    const el = document.getElementById(elId);
    if (gradeElId) {
      const g = document.getElementById(gradeElId);
      g.className = 'setup-score-badge grade-' + (result.grade || 'NOTRADE').replace('+', 'plus');
      g.textContent = `${result.grade || '—'} · ${result.setupScore ?? 0}/100`;
    }
    if (result.signal === 'BUY' || result.signal === 'SELL') {
      el.innerHTML = `
        <div class="mini-grid">
          <div class="mini-field"><div class="label">Entry</div><div class="value">${result.entryZone.bottom.toFixed(2)}–${result.entryZone.top.toFixed(2)}</div></div>
          <div class="mini-field"><div class="label">SL</div><div class="value">${result.invalidation.toFixed(2)}</div></div>
          <div class="mini-field"><div class="label">TP1${result.rr1 ? ` (${result.rr1}R)` : ''}</div><div class="value">${result.tp1 ? result.tp1.toFixed(2) : '—'}</div></div>
          <div class="mini-field"><div class="label">TP2</div><div class="value">${result.tp2 ? result.tp2.toFixed(2) : '—'}</div></div>
        </div>
        <div class="trigger-line">Trigger: ${result.trigger}</div>
        <div class="invalidation-line">Invalidation: ${result.invalidationText}</div>`;
    } else {
      el.innerHTML = `<div class="empty-state">${result.signal === 'AVOID' ? 'High-impact news nearby — no new entries.' : 'WAIT — NO A+ SETUP'}</div>
        <ul class="reason-list">${(result.reasons || []).slice(0, 3).map(r => `<li>${r}</li>`).join('')}</ul>`;
    }
  }

  function renderAlternative(scenarios, primaryDirection) {
    const el = document.getElementById('alt-setup-body');
    const altDirection = primaryDirection === 'bullish' ? 'bearish' : 'bullish';
    const alt = scenarios[altDirection];
    if (!alt) {
      el.innerHTML = `<div class="empty-state">No valid opposite scenario right now.</div>`;
      return;
    }
    el.innerHTML = `
      <div class="empty-state" style="margin-bottom:6px;">${altDirection === 'bullish' ? 'BUY' : 'SELL'} only if price reaches this zone and confirms:</div>
      <div class="mini-grid">
        <div class="mini-field"><div class="label">Entry</div><div class="value">${alt.entryZone.bottom.toFixed(2)}–${alt.entryZone.top.toFixed(2)}</div></div>
        <div class="mini-field"><div class="label">SL</div><div class="value">${alt.stopLoss.toFixed(2)}</div></div>
        <div class="mini-field"><div class="label">TP1${alt.rr1 ? ` (${alt.rr1}R)` : ''}</div><div class="value">${alt.tp1 ? alt.tp1.toFixed(2) : '—'}</div></div>
        <div class="mini-field"><div class="label">TP2</div><div class="value">${alt.tp2 ? alt.tp2.toFixed(2) : '—'}</div></div>
      </div>`;
  }

  function renderStructureMiniTable(structureByTF) {
    const tbody = document.querySelector('#structure-mini-table tbody');
    const rows = Object.entries(structureByTF).map(([tf, exec]) => {
      const last = exec.events[exec.events.length - 1];
      const bos = last?.type === 'BOS' ? '✓' : '—';
      const choch = last?.type === 'CHoCH' ? '✓' : '—';
      return `<tr><td>${tf}</td><td><span class="bias-tag ${exec.bias || 'neutral'}">${exec.bias || 'neutral'}</span></td><td>${bos}</td><td>${choch}</td></tr>`;
    });
    tbody.innerHTML = rows.join('');
  }

  function renderLiquidityMini(liq) {
    const el = document.getElementById('liquidity-mini-body');
    el.innerHTML = `
      <div class="liquidity-row"><span>Nearest buy-side</span><span class="val">${liq.nearestBuySide ? liq.nearestBuySide.price.toFixed(2) + ' (+' + liq.nearestBuySide.distance.toFixed(2) + ')' : '—'}</span></div>
      <div class="liquidity-row"><span>Nearest sell-side</span><span class="val">${liq.nearestSellSide ? liq.nearestSellSide.price.toFixed(2) + ' (-' + liq.nearestSellSide.distance.toFixed(2) + ')' : '—'}</span></div>
      <div class="liquidity-row"><span>Last sweep</span><span class="val">${liq.lastSweep ? liq.lastSweep.description : 'None recent'}</span></div>`;
  }

  async function runAnalysis() {
    const btn = document.getElementById('analyze-btn');
    btn.disabled = true;
    btn.textContent = 'ANALYZING GOLD…';

    try {
      const structureByTF = await MarketData.fetchAndAnalyzeAll();
      if (!structureByTF) {
        document.getElementById('current-action').className = 'current-action wait';
        document.getElementById('current-action').innerHTML = '⚪ WAIT<div class="sub">LIVE DATA UNAVAILABLE — check API key / rate limit</div>';
        return;
      }

      const bias = SMC.htfBias({ D1: structureByTF.D1, H4: structureByTF.H4, H1: structureByTF.H1, M15: structureByTF.M15 });
      const exec = structureByTF.M5; // execution timeframe per spec
      const news = MarketData.getNewsRisk();

      const result = SMC.generateSignal({
        bias,
        sweeps: exec.sweeps,
        displacements: exec.displacements,
        structureEvents: exec.events,
        fvgs: exec.fvgs,
        orderBlocks: exec.orderBlocks,
        pd: exec.pd,
        currentPrice: exec.currentPrice,
        swings: exec.swings,
        newsRiskHigh: news.high
      });

      const scenarios = SMC.buildScenarios(exec);
      const daily = await MarketData.fetchJSON('/api/market-data?type=daily').then(d => d.candles ? SMC.dailyLevels(d.candles) : null);
      const liq = SMC.liquiditySummary(exec, daily);

      renderCurrentAction(result);
      renderSetupCard('primary-setup-body', 'primary-grade', result, bias);
      renderAlternative(scenarios, bias === 'bearish' ? 'bearish' : 'bullish');
      renderStructureMiniTable(structureByTF);
      renderLiquidityMini(liq);
      Layout.setStatusBar({ lastUpdateText: 'just now' });
    } finally {
      btn.disabled = false;
      btn.textContent = '🧠 ANALYZE GOLD NOW';
    }
  }

  document.getElementById('analyze-btn').addEventListener('click', runAnalysis);

  // Auto-analysis on open (spec section 14/51), then quiet re-checks.
  runAnalysis();
  setInterval(runAnalysis, 3 * 60 * 1000);

})();
