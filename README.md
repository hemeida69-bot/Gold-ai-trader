# Gold AI Trader — Professional XAUUSD SMC/ICT Terminal

A multi-page, sidebar-navigated trading terminal for XAUUSD: a Decision
Center dashboard, full AI Analysis, Liquidity Map, Market Structure,
Trade Setups (primary + alternative, with a 0–100 Setup Score), a full
Chart page, News & Macro, FED, Risk Calculator, and a local Trade Journal.

## Architecture

```
LIVE XAUUSD DATA (Twelve Data, key server-side only)
        ↓
api/market-data.js   (serverless — quote/candles/dxy/us10y, never leaks the key)
        ↓
MULTI-TIMEFRAME DATA  (D1, H4, H1, M15, M5 — M5 is execution)
        ↓
smc-engine.js   (deterministic SMC/ICT math — zero AI, zero randomness)
        ↓
MARKET STRUCTURE → LIQUIDITY ENGINE → SETUP/CONFLUENCE ENGINE
        ↓
generateSignal() / buildScenarios() / liquiditySummary() / scoreSetup()
        ↓
TRADE SCENARIOS (primary + alternative) + Setup Score (A+/A/B/C/NO_TRADE)
        ↓
Pages render the structured output in plain language — nothing is
invented; every number traces back to a real candle.
```

The AI layer never computes prices — every Entry/SL/TP/RR/score number
comes from `smc-engine.js` running on real candles. If narrated AI
explanations are added later, they only describe this structured output.

## Pages (sidebar navigation)

| Page | File | What it shows |
|---|---|---|
| Dashboard | `index.html` | Decision Center — current action, primary + alternative setup, structure mini-table, liquidity summary, macro strip, small chart (~20% height) |
| AI Analysis | `analysis.html` | Full narrative: what happened, timeframe bias, what's expected, liquidity, key zones, macro, setup alerts |
| Liquidity | `liquidity.html` | Buy-side / sell-side liquidity pools, nearest levels, last sweep |
| Market Structure | `structure.html` | Bias/BOS/CHoCH table for every timeframe with a one-line explanation each |
| Trade Setups | `setups.html` | Primary setup (score/grade/entry/SL/TP/trigger/invalidation) + alternative scenario |
| Chart | `chart.html` | Full-size TradingView widget, all timeframes |
| News & Macro | `news.html` | DXY, US10Y, next high-impact event (manual input, see below) |
| FED | `fed.html` | Fed rate/FOMC/bias context (manual input) and general Gold-impact notes |
| Risk Calculator | `risk.html` | Position sizing, RR, potential profit |
| Trade Journal | `journal.html` | Local trade log (this device only) |
| Settings | `settings.html` | News event, Fed context, default timeframe/risk/min-RR, auto-refresh toggle |

## What's real vs. manual right now

- **Price, candles, structure, liquidity, FVG/OB, signals, Setup Score** — fully live and computed from real Twelve Data candles. Nothing fabricated; if data isn't available the app says so instead of guessing.
- **DXY / US10Y** — best-effort via Twelve Data's `/quote` endpoint. Coverage for indices/yields varies by plan; if your key doesn't support a symbol, the page honestly shows "N/A" rather than a fake number. Check `api/market-data.js` (`MACRO_SYMBOLS`) if you want to try a different symbol string or provider.
- **Next high-impact news event / Fed context** — manually entered in Settings, not pulled from a live calendar. There's no free, reliable economic-calendar API to wire in without a new signup; this keeps the "no fabricated data" rule intact while still letting News Risk and the Setup Score account for it honestly. A live calendar feed is a reasonable next step if you want it.
- **On-chart drawing of BOS/CHoCH/FVG/OB/Entry/SL/TP** — not implemented. TradingView's free widget doesn't expose a drawing API; doing this properly needs either TradingView's paid Charting Library or a self-hosted chart (e.g. Lightweight Charts) rendering the engine's own output. Flagged as a future step.
- **Setup Alerts** — real browser notifications, but only fire while the page/app is open (see the alert panel on `analysis.html` for the background-push limitation and what it would take to fix).

## Where the API key goes (never in the frontend)

Provider: **Twelve Data** (https://twelvedata.com/pricing — free plan: 800
requests/day, 8/min).

1. Get a free key from Twelve Data.
2. Vercel → Project → Settings → Environment Variables → add `MARKET_DATA_API_KEY`.
3. Redeploy (env var changes don't auto-redeploy — trigger one manually or push a commit).

The frontend only ever calls your own `/api/market-data` endpoint.

## Rate-limit note

A full "Analyze" run now fetches 5 timeframes (D1/H4/H1/M15/M5) instead of
4. Combined with the 30-second price ticker poll and any auto-refresh,
stay mindful of Twelve Data's 8 requests/minute free-tier cap — the app
surfaces a clear rate-limit error rather than silently failing if you hit it.

## Deploying

```bash
npm install -g vercel
vercel
vercel env add MARKET_DATA_API_KEY
vercel --prod
```

## Adding to iPad Home Screen

Open the deployed URL in Safari → Share → **Add to Home Screen**. The
sidebar becomes a fixed column on screens ≥1024px wide (iPad landscape)
and a slide-out drawer below that (iPad portrait / iPhone).

## Still to build (flagged honestly, not hidden)

- Live economic calendar + Fed data feed (needs a provider decision)
- On-chart SMC overlays (needs a charting-library decision)
- Background push notifications when the app is fully closed (needs VAPID + persistent storage + an external scheduler like cron-job.org, since Vercel Hobby's built-in Cron only runs once/day)
