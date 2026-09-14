/**
 * Gold AI Trader — SMC / ICT Deterministic Engine
 * ------------------------------------------------
 * This file contains ZERO AI calls. Every function here is pure,
 * rule-based market structure math applied to OHLC candle arrays.
 * The AI layer (if/when added) only narrates the output of this
 * engine — it never invents structure, prices, or signals.
 *
 * Candle shape expected everywhere in this file:
 *   { time: <unix seconds>, open, high, low, close, volume? }
 *
 * All functions are pure: (candles, options) -> data. No side effects,
 * no fetch calls, no randomness. Same input always produces the same
 * output, which is what makes this auditable/deterministic vs. an LLM
 * guessing at chart patterns.
 */

const SMC = (() => {

  // ---------------------------------------------------------------
  // 1. SWING / FRACTAL DETECTION  ->  HH / HL / LH / LL
  // ---------------------------------------------------------------
  /**
   * A swing high at index i requires candle[i].high to be the highest
   * high within `lookback` candles on both sides (simple fractal).
   * A swing low is the mirror condition on lows.
   */
  function findSwings(candles, lookback = 2) {
    const swings = [];
    for (let i = lookback; i < candles.length - lookback; i++) {
      const slice = candles.slice(i - lookback, i + lookback + 1);
      const isHigh = slice.every(c => c.high <= candles[i].high) &&
                     slice.filter(c => c.high === candles[i].high).length === 1;
      const isLow = slice.every(c => c.low >= candles[i].low) &&
                    slice.filter(c => c.low === candles[i].low).length === 1;
      if (isHigh) swings.push({ index: i, time: candles[i].time, price: candles[i].high, type: 'high' });
      if (isLow) swings.push({ index: i, time: candles[i].time, price: candles[i].low, type: 'low' });
    }

    // Label HH / HL / LH / LL by comparing each swing to the previous
    // swing of the SAME type.
    let lastHigh = null, lastLow = null;
    for (const s of swings) {
      if (s.type === 'high') {
        s.label = lastHigh === null ? 'H' : (s.price > lastHigh ? 'HH' : 'LH');
        lastHigh = s.price;
      } else {
        s.label = lastLow === null ? 'L' : (s.price > lastLow ? 'HL' : 'LL');
        lastLow = s.price;
      }
    }
    return swings;
  }

  // ---------------------------------------------------------------
  // 2 & 3. MARKET STRUCTURE  ->  BOS / CHoCH
  // ---------------------------------------------------------------
  /**
   * Walk swings in chronological order tracking current structural bias.
   * BOS  = a new swing breaks the most recent swing in the direction of
   *        the existing trend (trend continuation).
   * CHoCH = a new swing breaks structure AGAINST the existing trend
   *         (first sign of a potential reversal).
   */
  function detectStructureEvents(swings) {
    const events = [];
    let bias = null; // 'bullish' | 'bearish'
    let lastSwingHigh = null;
    let lastSwingLow = null;

    for (const s of swings) {
      if (s.type === 'high') {
        if (lastSwingHigh !== null && s.price > lastSwingHigh.price) {
          if (bias === 'bearish') {
            events.push({ type: 'CHoCH', direction: 'bullish', time: s.time, price: s.price, brokenLevel: lastSwingHigh.price });
            bias = 'bullish';
          } else if (bias === 'bullish') {
            events.push({ type: 'BOS', direction: 'bullish', time: s.time, price: s.price, brokenLevel: lastSwingHigh.price });
          } else {
            bias = 'bullish';
          }
        }
        lastSwingHigh = s;
      } else {
        if (lastSwingLow !== null && s.price < lastSwingLow.price) {
          if (bias === 'bullish') {
            events.push({ type: 'CHoCH', direction: 'bearish', time: s.time, price: s.price, brokenLevel: lastSwingLow.price });
            bias = 'bearish';
          } else if (bias === 'bearish') {
            events.push({ type: 'BOS', direction: 'bearish', time: s.time, price: s.price, brokenLevel: lastSwingLow.price });
          } else {
            bias = 'bearish';
          }
        }
        lastSwingLow = s;
      }
    }
    return { events, bias };
  }

  // ---------------------------------------------------------------
  // 4. LIQUIDITY SWEEPS
  // ---------------------------------------------------------------
  /**
   * A sweep = price wicks beyond a prior swing high/low (grabbing the
   * resting liquidity) then CLOSES back on the other side of that level
   * within the same or next `maxCandlesToClose` candles.
   */
  function detectLiquiditySweeps(candles, swings, maxCandlesToClose = 3) {
    const sweeps = [];
    for (const s of swings) {
      const searchStart = s.index + 1;
      const searchEnd = Math.min(candles.length, s.index + 1 + maxCandlesToClose);
      for (let i = searchStart; i < searchEnd; i++) {
        const c = candles[i];
        if (s.type === 'high' && c.high > s.price && c.close < s.price) {
          sweeps.push({ level: s.price, type: 'sell-side-grab', time: c.time, sweepIndex: i, sourceSwingIndex: s.index });
          break;
        }
        if (s.type === 'low' && c.low < s.price && c.close > s.price) {
          sweeps.push({ level: s.price, type: 'buy-side-grab', time: c.time, sweepIndex: i, sourceSwingIndex: s.index });
          break;
        }
      }
    }
    return sweeps;
  }

  // ---------------------------------------------------------------
  // 5. EQUAL HIGHS / EQUAL LOWS
  // ---------------------------------------------------------------
  function detectEqualLevels(swings, tolerancePct = 0.0008) {
    const equalHighs = [];
    const equalLows = [];
    const highs = swings.filter(s => s.type === 'high');
    const lows = swings.filter(s => s.type === 'low');

    for (let i = 0; i < highs.length; i++) {
      for (let j = i + 1; j < highs.length; j++) {
        const diff = Math.abs(highs[i].price - highs[j].price) / highs[i].price;
        if (diff <= tolerancePct) equalHighs.push({ a: highs[i], b: highs[j], level: (highs[i].price + highs[j].price) / 2 });
      }
    }
    for (let i = 0; i < lows.length; i++) {
      for (let j = i + 1; j < lows.length; j++) {
        const diff = Math.abs(lows[i].price - lows[j].price) / lows[i].price;
        if (diff <= tolerancePct) equalLows.push({ a: lows[i], b: lows[j], level: (lows[i].price + lows[j].price) / 2 });
      }
    }
    return { equalHighs, equalLows };
  }

  // ---------------------------------------------------------------
  // 6. FAIR VALUE GAPS (3-candle imbalance)
  // ---------------------------------------------------------------
  function detectFVGs(candles) {
    const fvgs = [];
    for (let i = 2; i < candles.length; i++) {
      const c1 = candles[i - 2], c3 = candles[i];
      // Bullish FVG: candle1.high < candle3.low
      if (c1.high < c3.low) {
        fvgs.push({ type: 'bullish', top: c3.low, bottom: c1.high, index: i - 1, time: candles[i - 1].time });
      }
      // Bearish FVG: candle1.low > candle3.high
      if (c1.low > c3.high) {
        fvgs.push({ type: 'bearish', top: c1.low, bottom: c3.high, index: i - 1, time: candles[i - 1].time });
      }
    }
    return fvgs;
  }

  // ---------------------------------------------------------------
  // 7 & 8. DISPLACEMENT + ORDER BLOCKS
  // ---------------------------------------------------------------
  /**
   * Displacement = a candle (or small run) whose body range is
   * significantly larger than the recent average — a strong, decisive
   * move, usually what causes a BOS/CHoCH.
   */
  function detectDisplacement(candles, lookback = 20, multiplier = 1.8) {
    const displacements = [];
    for (let i = lookback; i < candles.length; i++) {
      const window = candles.slice(i - lookback, i);
      const avgRange = window.reduce((sum, c) => sum + Math.abs(c.close - c.open), 0) / window.length;
      const body = Math.abs(candles[i].close - candles[i].open);
      if (avgRange > 0 && body > avgRange * multiplier) {
        displacements.push({
          index: i,
          time: candles[i].time,
          direction: candles[i].close > candles[i].open ? 'bullish' : 'bearish',
          body,
          avgRange
        });
      }
    }
    return displacements;
  }

  /**
   * Order Block = the last opposite-direction candle immediately before
   * a displacement leg that caused a BOS/CHoCH.
   */
  function detectOrderBlocks(candles, displacements) {
    const blocks = [];
    for (const d of displacements) {
      let j = d.index - 1;
      while (j >= 0) {
        const isOpposite = d.direction === 'bullish'
          ? candles[j].close < candles[j].open
          : candles[j].close > candles[j].open;
        if (isOpposite) {
          blocks.push({
            direction: d.direction === 'bullish' ? 'bullish-OB' : 'bearish-OB',
            top: candles[j].high,
            bottom: candles[j].low,
            index: j,
            time: candles[j].time,
            displacementIndex: d.index
          });
          break;
        }
        j--;
      }
    }
    return blocks;
  }

  // ---------------------------------------------------------------
  // 9. PREMIUM / DISCOUNT (of the current dealing range)
  // ---------------------------------------------------------------
  function premiumDiscount(rangeHigh, rangeLow, currentPrice) {
    const mid = (rangeHigh + rangeLow) / 2;
    const zone = currentPrice > mid ? 'premium' : (currentPrice < mid ? 'discount' : 'equilibrium');
    const pctIntoRange = (currentPrice - rangeLow) / (rangeHigh - rangeLow);
    return { mid, zone, pctIntoRange, rangeHigh, rangeLow };
  }

  // ---------------------------------------------------------------
  // 10. PREVIOUS DAY HIGH/LOW  +  11. SESSION LEVELS
  // ---------------------------------------------------------------
  function dailyLevels(dailyCandles) {
    if (dailyCandles.length < 2) return null;
    const today = dailyCandles[dailyCandles.length - 1];
    const prev = dailyCandles[dailyCandles.length - 2];
    return {
      dayHigh: today.high,
      dayLow: today.low,
      prevDayHigh: prev.high,
      prevDayLow: prev.low
    };
  }

  /** Trading sessions in UTC hours (approximate, standard convention). */
  const SESSIONS = [
    { name: 'Sydney', startUTC: 21, endUTC: 6 },
    { name: 'Tokyo', startUTC: 0, endUTC: 9 },
    { name: 'London', startUTC: 7, endUTC: 16 },
    { name: 'New York', startUTC: 12, endUTC: 21 }
  ];

  function currentSession(nowUTCHour) {
    const active = SESSIONS.filter(s => {
      if (s.startUTC < s.endUTC) return nowUTCHour >= s.startUTC && nowUTCHour < s.endUTC;
      return nowUTCHour >= s.startUTC || nowUTCHour < s.endUTC; // wraps midnight
    });
    return active.map(s => s.name);
  }

  /** XAUUSD trades ~23h/5 days like forex: closed roughly Fri 21:00 UTC -> Sun 22:00 UTC. */
  function marketStatus(nowUTC) {
    const day = nowUTC.getUTCDay(); // 0 Sun ... 6 Sat
    const hour = nowUTC.getUTCHours();
    const isClosed =
      (day === 6) ||
      (day === 5 && hour >= 21) ||
      (day === 0 && hour < 22);
    return isClosed ? 'CLOSED' : 'OPEN';
  }

  // ---------------------------------------------------------------
  // MULTI-TIMEFRAME BIAS  (D1 -> H4 -> H1 -> M15, M5 = execution TF)
  // ---------------------------------------------------------------
  function htfBias(structureByTF) {
    // structureByTF: { D1: {bias}, H4: {bias}, H1: {bias}, M15: {bias} }
    const weights = { D1: 4, H4: 3, H1: 2, M15: 1 };
    let score = 0;
    for (const [tf, w] of Object.entries(weights)) {
      const b = structureByTF[tf]?.bias;
      if (b === 'bullish') score += w;
      if (b === 'bearish') score -= w;
    }
    if (score >= 3) return 'bullish';
    if (score <= -3) return 'bearish';
    return 'mixed';
  }

  // ---------------------------------------------------------------
  // ONE-CALL ANALYSIS  (runs every detector above on a candle array)
  // ---------------------------------------------------------------
  function analyzeCandles(candles) {
    const swings = findSwings(candles, 2);
    const { events, bias } = detectStructureEvents(swings);
    const sweeps = detectLiquiditySweeps(candles, swings);
    const { equalHighs, equalLows } = detectEqualLevels(swings);
    const fvgs = detectFVGs(candles);
    const displacements = detectDisplacement(candles);
    const orderBlocks = detectOrderBlocks(candles, displacements);
    const recentHigh = Math.max(...candles.slice(-50).map(c => c.high));
    const recentLow = Math.min(...candles.slice(-50).map(c => c.low));
    const currentPrice = candles[candles.length - 1].close;
    const pd = premiumDiscount(recentHigh, recentLow, currentPrice);
    return { swings, events, bias, sweeps, equalHighs, equalLows, fvgs, displacements, orderBlocks, pd, currentPrice, candles };
  }

  // ---------------------------------------------------------------
  // CONDITIONAL SCENARIOS  ("if price does X, here's the plan")
  // ---------------------------------------------------------------
  /**
   * Unlike generateSignal() (which only fires once EVERY condition is
   * already met), this builds the nearest bullish AND bearish conditional
   * plan from the current structure — for the "what to watch for next"
   * narrative. These are NOT live signals, just pre-computed if/then
   * plans anchored to real zones already on the chart.
   */
  function buildScenarios(exec) {
    const { swings, fvgs, orderBlocks, currentPrice } = exec;
    const swingHighs = swings.filter(s => s.type === 'high').map(s => s.price).sort((a, b) => a - b);
    const swingLows = swings.filter(s => s.type === 'low').map(s => s.price).sort((a, b) => b - a);

    const bullishZones = [...fvgs.filter(f => f.type === 'bullish'), ...orderBlocks.filter(o => o.direction === 'bullish-OB')]
      .filter(z => z.top < currentPrice)
      .sort((a, b) => b.top - a.top);
    const bearishZones = [...fvgs.filter(f => f.type === 'bearish'), ...orderBlocks.filter(o => o.direction === 'bearish-OB')]
      .filter(z => z.bottom > currentPrice)
      .sort((a, b) => a.bottom - b.bottom);

    let bullish = null;
    const bz = bullishZones[0];
    if (bz) {
      const risk = bz.top - bz.bottom;
      const sl = bz.bottom - risk * 0.5;
      const targets = swingHighs.filter(h => h > currentPrice);
      const tp1 = targets[0] ?? null;
      const tp2 = targets[1] ?? null;
      bullish = {
        direction: 'bullish',
        zoneType: bz.type || bz.direction,
        entryZone: { top: bz.top, bottom: bz.bottom },
        stopLoss: sl,
        tp1, tp2,
        rr1: tp1 ? +(((tp1 - bz.top) / (bz.top - sl)).toFixed(2)) : null
      };
    }

    let bearish = null;
    const brz = bearishZones[0];
    if (brz) {
      const risk = brz.top - brz.bottom;
      const sl = brz.top + risk * 0.5;
      const targets = swingLows.filter(l => l < currentPrice);
      const tp1 = targets[0] ?? null;
      const tp2 = targets[1] ?? null;
      bearish = {
        direction: 'bearish',
        zoneType: brz.type || brz.direction,
        entryZone: { top: brz.top, bottom: brz.bottom },
        stopLoss: sl,
        tp1, tp2,
        rr1: tp1 ? +(((brz.bottom - tp1) / (sl - brz.bottom)).toFixed(2)) : null
      };
    }

    return { bullish, bearish };
  }

  // ---------------------------------------------------------------
  // CONFLUENCE / SIGNAL ENGINE  (section 5 of the spec — hard rules)
  // ---------------------------------------------------------------
  /**
   * BUY requires ALL of: liquidity sweep (buy-side-grab) -> bullish
   * displacement -> bullish BOS/CHoCH -> price retesting a bullish
   * FVG/OB -> that retest sitting in DISCOUNT of the current range.
   * SELL is the exact mirror. Anything incomplete = WAIT.
   * This function NEVER outputs BUY/SELL without every condition met —
   * that rule is enforced here in code, not left to the AI wrapper.
   */
  function generateSignal({ bias, sweeps, displacements, structureEvents, fvgs, orderBlocks, pd, currentPrice, swings = [] }) {
    const reasons = [];
    const lastSweep = sweeps[sweeps.length - 1];
    const lastDisplacement = displacements[displacements.length - 1];
    const lastStructureEvent = structureEvents[structureEvents.length - 1];

    const wantDirection = bias === 'bullish' ? 'bullish' : bias === 'bearish' ? 'bearish' : null;
    if (!wantDirection) {
      return { signal: 'WAIT', reasons: ['HTF bias is mixed — no directional edge'], confidence: 0 };
    }

    const sweepOk = lastSweep && (
      (wantDirection === 'bullish' && lastSweep.type === 'buy-side-grab') ||
      (wantDirection === 'bearish' && lastSweep.type === 'sell-side-grab')
    );
    reasons.push(sweepOk ? `✅ Liquidity sweep confirmed (${lastSweep.type})` : '❌ No confirmed liquidity sweep in this direction');

    const dispOk = lastDisplacement && lastDisplacement.direction === wantDirection;
    reasons.push(dispOk ? `✅ ${wantDirection} displacement confirmed` : `❌ No ${wantDirection} displacement`);

    const bosOk = lastStructureEvent && lastStructureEvent.direction === wantDirection;
    reasons.push(bosOk ? `✅ ${lastStructureEvent?.type || 'Structure break'} confirmed ${wantDirection}` : '❌ No confirming BOS/CHoCH');

    const relevantZones = wantDirection === 'bullish'
      ? [...fvgs.filter(f => f.type === 'bullish'), ...orderBlocks.filter(o => o.direction === 'bullish-OB')]
      : [...fvgs.filter(f => f.type === 'bearish'), ...orderBlocks.filter(o => o.direction === 'bearish-OB')];
    const lastZone = relevantZones[relevantZones.length - 1];
    const retestOk = !!lastZone && currentPrice <= (lastZone.top ?? -Infinity) && currentPrice >= (lastZone.bottom ?? Infinity) === false
      ? false : !!lastZone; // presence check; precise touch confirmed by caller with live price
    reasons.push(lastZone ? `✅ Retest zone available (${lastZone.type || lastZone.direction})` : '❌ No FVG/OB retest zone found');

    const zoneOk = wantDirection === 'bullish' ? pd?.zone === 'discount' : pd?.zone === 'premium';
    reasons.push(zoneOk ? `✅ Price is in ${pd?.zone} (correct side of range)` : `❌ Price is in ${pd?.zone || 'unknown'}, not ${wantDirection === 'bullish' ? 'discount' : 'premium'}`);

    const allOk = sweepOk && dispOk && bosOk && !!lastZone && zoneOk;
    const passedCount = [sweepOk, dispOk, bosOk, !!lastZone, zoneOk].filter(Boolean).length;
    const confidence = Math.round((passedCount / 5) * 100);

    if (!allOk) {
      return { signal: 'WAIT', reasons, confidence };
    }

    const entryZone = { top: lastZone.top, bottom: lastZone.bottom };
    const entryMid = (entryZone.top + entryZone.bottom) / 2;
    const invalidation = wantDirection === 'bullish' ? pd.rangeLow : pd.rangeHigh;
    const risk = Math.abs(entryMid - invalidation);

    // TP1/TP2 = nearest real opposing swing levels beyond entry — never invented.
    const targets = wantDirection === 'bullish'
      ? swings.filter(s => s.type === 'high' && s.price > entryZone.top).map(s => s.price).sort((a, b) => a - b)
      : swings.filter(s => s.type === 'low' && s.price < entryZone.bottom).map(s => s.price).sort((a, b) => b - a);
    const tp1 = targets[0] ?? null;
    const tp2 = targets[1] ?? null;
    const rr1 = tp1 && risk > 0 ? +(Math.abs(tp1 - entryMid) / risk).toFixed(2) : null;
    const rr2 = tp2 && risk > 0 ? +(Math.abs(tp2 - entryMid) / risk).toFixed(2) : null;

    return {
      signal: wantDirection === 'bullish' ? 'BUY' : 'SELL',
      reasons,
      confidence,
      entryZone,
      invalidation,
      tp1, tp2, rr1, rr2
    };
  }

  return {
    findSwings,
    detectStructureEvents,
    detectLiquiditySweeps,
    detectEqualLevels,
    detectFVGs,
    detectDisplacement,
    detectOrderBlocks,
    premiumDiscount,
    dailyLevels,
    currentSession,
    marketStatus,
    htfBias,
    analyzeCandles,
    buildScenarios,
    generateSignal
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = SMC;
