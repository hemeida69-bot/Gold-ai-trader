(() => {
  'use strict';

  // ---------------------------------------------------------------
  // Session + market status (shared with dashboard)
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

  async function refreshTicker() {
    const quote = await MarketData.fetchJSON('/api/market-data?type=quote');
    const priceEl = document.getElementById('price');
    const changeEl = document.getElementById('change');
    if (quote.error) {
      priceEl.textContent = '— — —';
      priceEl.classList.add('is-stale');
      changeEl.textContent = '';
      return;
    }
    priceEl.textContent = quote.price.toFixed(2);
    priceEl.classList.remove('is-stale');
    if (!isNaN(quote.change)) {
      changeEl.textContent = `${quote.change >= 0 ? '▲' : '▼'} ${Math.abs(quote.change).toFixed(2)}%`;
      changeEl.className = 'ticker__change ' + (quote.change >= 0 ? 'up' : 'down');
    }
  }
  refreshTicker();
  setInterval(refreshTicker, 30 * 1000);

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

  function buildExpectedList(bias, exec, scenarios) {
    const items = [];
    if (bias === 'mixed') {
      items.push('Higher-timeframe bias is mixed right now — D1/H4/H1/M15 are not aligned, so no directional edge is favored yet. Wait for alignment before looking for entries.');
    } else {
      items.push(`Higher-timeframe bias leans ${bias}. The execution timeframe (M15) is being watched for a liquidity sweep in that direction, followed by displacement and a break of structure, before any entry zone is considered valid.`);
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

  function renderScenarioCard(el, scenario, direction) {
    if (!scenario) {
      el.innerHTML = `<h3>${direction === 'bullish' ? '🟢 Bullish scenario' : '🔴 Bearish scenario'}</h3><div class="scenario-empty">No qualifying ${direction} zone found below/above current price right now.</div>`;
      return;
    }
    el.innerHTML = `
      <h3>${direction === 'bullish' ? '🟢 If price reaches the buy zone' : '🔴 If price reaches the sell zone'}</h3>
      <div class="scenario-condition">Zone type: ${scenario.zoneType} — this is where price would need to react for a ${direction} entry to make sense, not a live signal.</div>
      <div class="trade-grid">
        <div class="trade-field"><div class="label">Entry Zone</div><div class="value">${scenario.entryZone.bottom.toFixed(2)} – ${scenario.entryZone.top.toFixed(2)}</div></div>
        <div class="trade-field"><div class="label">Stop Loss</div><div class="value">${scenario.stopLoss.toFixed(2)}</div></div>
        <div class="trade-field"><div class="label">TP1${scenario.rr1 ? ` (${scenario.rr1}R)` : ''}</div><div class="value">${scenario.tp1 ? scenario.tp1.toFixed(2) : '—'}</div></div>
        <div class="trade-field"><div class="label">TP2</div><div class="value">${scenario.tp2 ? scenario.tp2.toFixed(2) : '—'}</div></div>
      </div>`;
  }

  function renderSignalCard(result) {
    const badge = document.getElementById('signal-badge');
    const body = document.getElementById('signal-body');
    badge.className = 'signal-badge ' + result.signal.toLowerCase();
    badge.textContent = result.signal === 'WAIT' ? 'WAIT / NO TRADE' : result.signal;

    let html = '';
    if (result.signal === 'BUY' || result.signal === 'SELL') {
      html += `<div class="trade-grid">
        <div class="trade-field"><div class="label">Entry Zone</div><div class="value">${result.entryZone.bottom.toFixed(2)} – ${result.entryZone.top.toFixed(2)}</div></div>
        <div class="trade-field"><div class="label">Invalidation (SL)</div><div class="value">${result.invalidation.toFixed(2)}</div></div>
        <div class="trade-field"><div class="label">TP1${result.rr1 ? ` (${result.rr1}R)` : ''}</div><div class="value">${result.tp1 ? result.tp1.toFixed(2) : '—'}</div></div>
        <div class="trade-field"><div class="label">TP2${result.rr2 ? ` (${result.rr2}R)` : ''}</div><div class="value">${result.tp2 ? result.tp2.toFixed(2) : '—'}</div></div>
        <div class="trade-field"><div class="label">Confidence</div><div class="value">${result.confidence}%</div></div>
      </div><div class="confidence-bar"><div class="confidence-bar__fill" style="width:${result.confidence}%"></div></div>`;
    } else {
      html += `<div class="confidence-bar"><div class="confidence-bar__fill" style="width:${result.confidence}%"></div></div>`;
    }
    html += `<ul class="reason-list">${result.reasons.map(r => `<li>${r}</li>`).join('')}</ul>`;
    body.innerHTML = html;
  }

  // ---------------------------------------------------------------
  // Main analysis run
  // ---------------------------------------------------------------
  let lastResult = null;

  async function runAnalysis({ silent = false } = {}) {
    const btn = document.getElementById('analyze-btn');
    if (!silent) { btn.disabled = true; btn.textContent = 'Analyzing…'; }

    try {
      const structureByTF = await MarketData.fetchAndAnalyzeAll();
      if (!structureByTF) {
        document.getElementById('signal-badge').className = 'signal-badge wait';
        document.getElementById('signal-badge').textContent = 'WAIT — LIVE DATA REQUIRED';
        document.getElementById('signal-body').textContent = 'No confirmed market data available right now (check MARKET_DATA_API_KEY / provider rate limit).';
        return null;
      }

      const bias = SMC.htfBias(structureByTF);
      const exec = structureByTF.M15;
      const result = SMC.generateSignal({
        bias,
        sweeps: exec.sweeps,
        displacements: exec.displacements,
        structureEvents: exec.events,
        fvgs: exec.fvgs,
        orderBlocks: exec.orderBlocks,
        pd: exec.pd,
        currentPrice: exec.currentPrice,
        swings: exec.swings
      });
      const scenarios = SMC.buildScenarios(exec);

      renderSignalCard(result);
      document.getElementById('narrative-happened').innerHTML = buildHappenedList(structureByTF).map(t => `<li>${t}</li>`).join('');
      document.getElementById('narrative-expected').innerHTML = buildExpectedList(bias, exec, scenarios).map(t => `<li>${t}</li>`).join('');
      renderTFBiasChips(structureByTF);
      renderScenarioCard(document.querySelector('.scenario-card.bullish'), scenarios.bullish, 'bullish');
      renderScenarioCard(document.querySelector('.scenario-card.bearish'), scenarios.bearish, 'bearish');
      document.getElementById('last-checked').textContent = `Last checked: ${new Date().toLocaleTimeString()}`;

      lastResult = result;
      return result;
    } finally {
      if (!silent) { btn.disabled = false; btn.textContent = '🧠 RUN LIVE ANALYSIS'; }
    }
  }

  document.getElementById('analyze-btn').addEventListener('click', () => runAnalysis());

  // ---------------------------------------------------------------
  // Setup alerts — Notification API, works while this page/app is
  // open (foreground or briefly backgrounded). Polls every 3 minutes.
  // For alerts when the app is fully closed, real background push
  // needs a small server-side piece (VAPID + subscription storage +
  // an external scheduler) — not wired up here; ask to add it.
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
          new Notification(`Gold AI Trader — ${result.signal} setup`, {
            body: `Entry ${result.entryZone.bottom.toFixed(2)}–${result.entryZone.top.toFixed(2)} · SL ${result.invalidation.toFixed(2)} · Confidence ${result.confidence}%`,
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

  // Restore alert state on load
  if (localStorage.getItem(ALERT_KEY) === 'true' && 'Notification' in window && Notification.permission === 'granted') {
    setAlertUI(true);
    startAlertPolling();
  }

})();
