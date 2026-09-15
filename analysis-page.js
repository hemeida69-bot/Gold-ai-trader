(() => {
  'use strict';

  // ---------------------------------------------------------------
  // Narrative builders — plain-language sentences assembled from
  // structured engine output only. No invented facts, no AI call.
  // ---------------------------------------------------------------
  function describeStructureEvent(tfLabel, exec) {
    const last = exec.events[exec.events.length - 1];
    if (!last) return `${tfLabel}: no clear BOS/CHoCH in the visible window.`;
    return `${tfLabel}: last structure break was a ${last.direction} ${last.type} at ${last.price.toFixed(2)}.`;
  }

  function describeSweep(tfLabel, exec) {
    const last = exec.sweeps[exec.sweeps.length - 1];
    if (!last) return null;
    const kind = last.type === 'buy-side-grab' ? 'swept sell-side liquidity below a low and reclaimed it' : 'swept buy-side liquidity above a high and rejected it';
    return `${tfLabel}: price ${kind} (level ${last.level.toFixed(2)}).`;
  }

  function buildHappenedList(structureByTF) {
    const items = [];
    for (const [tf, exec] of Object.entries(structureByTF)) {
      items.push(describeStructureEvent(tf, exec));
      const sweep = describeSweep(tf, exec);
      if (sweep) items.push(sweep);
    }
    return items;
  }

  function buildExpectedList(bias, exec, scenarios, newsRisk) {
    const items = [];
    if (newsRisk.high) {
      items.push(`⚠️ ${newsRisk.event.name} is in ${newsRisk.minutesUntil} minutes — treat any setup as lower quality until the event has passed and price has reacted.`);
    }
    if (bias === 'mixed') {
      items.push('Higher-timeframe bias is mixed right now — D1/H4/H1/M15 are not aligned, so no directional edge is favored yet. Wait for alignment before looking for M5 entries.');
    } else {
      items.push(`Higher-timeframe bias leans ${bias}. M5 (execution timeframe) is being watched for a liquidity sweep in that direction, followed by displacement and a break of structure, before any entry zone is considered valid.`);
    }
    if (bias === 'bullish' && scenarios.bullish) {
      items.push(`Nearest bullish zone to watch: ${scenarios.bullish.entryZone.bottom.toFixed(2)}–${scenarios.bullish.entryZone.top.toFixed(2)} (${scenarios.bullish.zoneType}).`);
    }
    if (bias === 'bearish' && scenarios.bearish) {
      items.push(`Nearest bearish zone to watch: ${scenarios.bearish.entryZone.bottom.toFixed(2)}–${scenarios.bearish.entryZone.top.toFixed(2)} (${scenarios.bearish.zoneType}).`);
    }
    items.push(`Current position in range: ${exec.pd.zone} (${(exec.pd.pctIntoRange * 100).toFixed(0)}% into the recent range).`);
    return items;
  }

  function renderTFBiasChips(structureByTF) {
    const row = document.getElementById('tf-bias-row');
    row.innerHTML = Object.entries(structureByTF).map(([tf, exec]) => {
      const b = exec.bias || 'neutral';
      return `<span class="tf-bias-chip ${b}">${tf}: ${b}</span>`;
    }).join('');
  }

  function renderLiquidity(liq) {
    const el = document.getElementById('liquidity-body');
    el.innerHTML = `
      <div class="liquidity-row"><span>Nearest buy-side liquidity</span><span class="val">${liq.nearestBuySide ? `${liq.nearestBuySide.price.toFixed(2)} (${liq.nearestBuySide.label}, +${liq.nearestBuySide.distance.toFixed(2)})` : '—'}</span></div>
      <div class="liquidity-row"><span>Nearest sell-side liquidity</span><span class="val">${liq.nearestSellSide ? `${liq.nearestSellSide.price.toFixed(2)} (${liq.nearestSellSide.label}, -${liq.nearestSellSide.distance.toFixed(2)})` : '—'}</span></div>
      <div class="liquidity-row"><span>Last sweep</span><span class="val">${liq.lastSweep ? `${liq.lastSweep.description} @ ${liq.lastSweep.level.toFixed(2)}` : 'None recent'}</span></div>`;
  }

  function renderScenarioCard(el, scenario, direction) {
    if (!scenario) {
      el.innerHTML = `<h3>${direction === 'bullish' ? '🟢 Bullish scenario' : '🔴 Bearish scenario'}</h3><div class="scenario-empty">No qualifying ${direction} zone found right now.</div>`;
      return;
    }
    el.innerHTML = `
      <h3>${direction === 'bullish' ? '🟢 If price reaches the buy zone' : '🔴 If price reaches the sell zone'}</h3>
      <div class="scenario-condition">Zone type: ${scenario.zoneType} — where price would need to react for a ${direction} entry to make sense, not a live signal.</div>
      <div class="mini-grid">
        <div class="mini-field"><div class="label">Entry</div><div class="value">${scenario.entryZone.bottom.toFixed(2)}–${scenario.entryZone.top.toFixed(2)}</div></div>
        <div class="mini-field"><div class="label">SL</div><div class="value">${scenario.stopLoss.toFixed(2)}</div></div>
        <div class="mini-field"><div class="label">TP1${scenario.rr1 ? ` (${scenario.rr1}R)` : ''}</div><div class="value">${scenario.tp1 ? scenario.tp1.toFixed(2) : '—'}</div></div>
        <div class="mini-field"><div class="label">TP2</div><div class="value">${scenario.tp2 ? scenario.tp2.toFixed(2) : '—'}</div></div>
      </div>`;
  }

  function renderSignalCard(result) {
    const badge = document.getElementById('signal-badge');
    const body = document.getElementById('signal-body');
    badge.className = 'signal-badge ' + result.signal.toLowerCase();
    badge.textContent = result.signal === 'WAIT' ? (result.waitState === 'WAIT_FOR_BUY' ? 'WAIT FOR BUY' : result.waitState === 'WAIT_FOR_SELL' ? 'WAIT FOR SELL' : 'WAIT / NO TRADE') : (result.signal === 'AVOID' ? 'AVOID — HIGH IMPACT NEWS' : result.signal);

    let html = `<div style="margin-bottom:8px; font-size:12.5px; color:var(--text-dim);">Setup Score: <strong style="color:var(--text)">${result.setupScore}/100</strong> · Grade: <strong style="color:var(--text)">${result.grade}</strong></div>`;
    if (result.signal === 'BUY' || result.signal === 'SELL') {
      html += `<div class="trade-grid">
        <div class="trade-field"><div class="label">Entry Zone</div><div class="value">${result.entryZone.bottom.toFixed(2)} – ${result.entryZone.top.toFixed(2)}</div></div>
        <div class="trade-field"><div class="label">Invalidation (SL)</div><div class="value">${result.invalidation.toFixed(2)}</div></div>
        <div class="trade-field"><div class="label">TP1${result.rr1 ? ` (${result.rr1}R)` : ''}</div><div class="value">${result.tp1 ? result.tp1.toFixed(2) : '—'}</div></div>
        <div class="trade-field"><div class="label">TP2${result.rr2 ? ` (${result.rr2}R)` : ''}</div><div class="value">${result.tp2 ? result.tp2.toFixed(2) : '—'}</div></div>
        <div class="trade-field"><div class="label">Confidence</div><div class="value">${result.confidence}%</div></div>
      </div>
      <div class="trigger-line">Trigger: ${result.trigger}</div>
      <div class="invalidation-line">Invalidation: ${result.invalidationText}</div>
      <div class="confidence-bar" style="margin-top:10px;"><div class="confidence-bar__fill" style="width:${result.confidence}%"></div></div>`;
    } else {
      html += `<div class="confidence-bar"><div class="confidence-bar__fill" style="width:${result.confidence}%"></div></div>`;
    }
    html += `<ul class="reason-list">${result.reasons.map(r => `<li>${r}</li>`).join('')}</ul>`;
    body.innerHTML = html;
  }

  async function renderMacro() {
    const [dxy, us10y] = await Promise.all([MarketData.fetchDXY(), MarketData.fetchUS10Y()]);
    document.getElementById('dxy-value').textContent = (dxy && dxy.available) ? dxy.price.toFixed(2) : 'N/A';
    document.getElementById('us10y-value').textContent = (us10y && us10y.available) ? us10y.price.toFixed(2) : 'N/A';
    const risk = MarketData.getNewsRisk();
    const box = document.getElementById('news-risk-body');
    if (!risk.configured) box.innerHTML = `<div class="news-risk-banner low">No high-impact event configured — set one in Settings.</div>`;
    else if (risk.high) box.innerHTML = `<div class="news-risk-banner high">⚠️ HIGH IMPACT NEWS — ${risk.event.name} in ${risk.minutesUntil} min</div>`;
    else box.innerHTML = `<div class="news-risk-banner low">Next high-impact event: ${risk.event.name}</div>`;
    return risk;
  }
  renderMacro();

  // ---------------------------------------------------------------
  // Main analysis run
  // ---------------------------------------------------------------
  let lastResult = null;

  async function runAnalysis({ silent = false } = {}) {
    const btn = document.getElementById('analyze-btn');
    if (!silent) { btn.disabled = true; btn.textContent = 'ANALYZING GOLD…'; }

    try {
      const structureByTF = await MarketData.fetchAndAnalyzeAll();
      if (!structureByTF) {
        document.getElementById('signal-badge').className = 'signal-badge wait';
        document.getElementById('signal-badge').textContent = 'WAIT — LIVE DATA REQUIRED';
        document.getElementById('signal-body').textContent = 'No confirmed market data available right now (check MARKET_DATA_API_KEY / provider rate limit).';
        return null;
      }

      const bias = SMC.htfBias({ D1: structureByTF.D1, H4: structureByTF.H4, H1: structureByTF.H1, M15: structureByTF.M15 });
      const exec = structureByTF.M5;
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
      const daily = MarketData.dailyLevelsFrom(structureByTF);
      const liq = SMC.liquiditySummary(exec, daily);

      renderSignalCard(result);
      document.getElementById('narrative-happened').innerHTML = buildHappenedList(structureByTF).map(t => `<li>${t}</li>`).join('');
      document.getElementById('narrative-expected').innerHTML = buildExpectedList(bias, exec, scenarios, news).map(t => `<li>${t}</li>`).join('');
      renderTFBiasChips(structureByTF);
      renderLiquidity(liq);
      renderScenarioCard(document.querySelector('.scenario-card.bullish'), scenarios.bullish, 'bullish');
      renderScenarioCard(document.querySelector('.scenario-card.bearish'), scenarios.bearish, 'bearish');
      Layout.setStatusBar({ lastUpdateText: 'just now' });

      lastResult = result;
      return result;
    } finally {
      if (!silent) { btn.disabled = false; btn.textContent = '🧠 RUN LIVE ANALYSIS'; }
    }
  }

  document.getElementById('analyze-btn').addEventListener('click', () => runAnalysis());
  runAnalysis();

  // ---------------------------------------------------------------
  // Setup alerts — Notification API (see README for the closed-app
  // background-push limitation and what a real fix would need).
  // ---------------------------------------------------------------
  const ALERT_KEY = 'goldAiTrader.alertsEnabled';
  const LAST_SIGNAL_KEY = 'goldAiTrader.lastAlertedSignal';
  let alertInterval = null;

  function setAlertUI(enabled) {
    const btn = document.getElementById('alert-toggle-btn');
    const status = document.getElementById('alert-status');
    btn.classList.toggle('active', enabled);
    btn.textContent = enabled ? 'Disable' : 'Enable';
    status.textContent = enabled ? 'On · checking every 3 min while this page is open' : 'Off';
  }

  function startAlertPolling() {
    if (alertInterval) return;
    alertInterval = setInterval(async () => {
      const result = await runAnalysis({ silent: true });
      if (!result) return;
      if (result.signal === 'BUY' || result.signal === 'SELL') {
        const signature = `${result.signal}:${result.entryZone.top.toFixed(2)}:${result.entryZone.bottom.toFixed(2)}`;
        if (localStorage.getItem(LAST_SIGNAL_KEY) !== signature && Notification.permission === 'granted') {
          new Notification(`Gold AI Trader — ${result.signal} setup (${result.grade})`, {
            body: `Entry ${result.entryZone.bottom.toFixed(2)}–${result.entryZone.top.toFixed(2)} · SL ${result.invalidation.toFixed(2)} · Score ${result.setupScore}/100`,
            icon: 'icons/icon-192.png'
          });
          localStorage.setItem(LAST_SIGNAL_KEY, signature);
        }
      }
    }, 3 * 60 * 1000);
  }

  document.getElementById('alert-toggle-btn').addEventListener('click', async () => {
    const currentlyEnabled = localStorage.getItem(ALERT_KEY) === 'true';
    if (currentlyEnabled) {
      localStorage.setItem(ALERT_KEY, 'false');
      if (alertInterval) { clearInterval(alertInterval); alertInterval = null; }
      setAlertUI(false);
      return;
    }
    if (!('Notification' in window)) {
      document.getElementById('alert-status').textContent = 'Notifications are not supported in this browser.';
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      document.getElementById('alert-status').textContent = 'Notification permission was not granted.';
      return;
    }
    localStorage.setItem(ALERT_KEY, 'true');
    setAlertUI(true);
    startAlertPolling();
  });

  if (localStorage.getItem(ALERT_KEY) === 'true' && 'Notification' in window && Notification.permission === 'granted') {
    setAlertUI(true);
    startAlertPolling();
  }

})();
