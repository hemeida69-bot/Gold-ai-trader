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

Provider: **Finnhub** (https://finnhub.io/register — free tier: 60
requests/minute, no daily cap). Switched from Twelve Data because
Twelve Data's 8 requests/minute free-tier limit was too easy to exceed
with a multi-page app, even with caching.

1. Get a free key: https://finnhub.io/register (key appears on your dashboard right after signup).
2. Vercel → Project → Settings → Environment Variables → **replace** the existing `MARKET_DATA_API_KEY` value with your Finnhub key (same variable name, no new one needed).
3. Redeploy (env var changes don't auto-redeploy — trigger one manually or push a commit).

The frontend only ever calls your own `/api/market-data` endpoint — it
never sees this key.

Note: Finnhub has no native 4-hour candle resolution, so H4 candles are
built server-side by aggregating 60-minute candles into UTC-aligned
4-hour buckets (see `aggregateTo4h` in `api/market-data.js`) — a
deterministic aggregation, not invented data. DXY/US10Y are not reliably
available on Finnhub's free plan, so those two show "N/A" honestly
rather than guessing.

## Rate-limit note

Finnhub's free tier (60 requests/minute) gives much more headroom than
Twelve Data's (8/minute) did. `data.js` still caches every response in
`localStorage` with a short TTL (20s quote, 45s intraday, 60-120s daily/
macro) so repeat page visits within that window don't refetch at all —
belt and suspenders rather than strictly required now, but it also means
fewer redundant calls even at the higher limit.

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
