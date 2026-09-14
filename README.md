# Gold AI Trader — MVP (Phase 1)

A dark, professional XAUUSD dashboard: live chart, deterministic SMC/ICT
market-structure engine, and an **ANALYZE GOLD NOW** button that returns
BUY / SELL / WAIT with Entry / SL / Confidence — never fabricated numbers.

## What's actually working right now (no setup required)

- Dashboard UI (dark, mobile-first, iPad-optimized)
- Live TradingView chart for XAUUSD with 1m/5m/15m/1H/4H/1D switching
- Session detector (Sydney/Tokyo/London/New York) and market OPEN/CLOSED status — pure UTC-time math, always accurate
- Risk / position-size calculator (0.25% / 0.5% / 1%)
- Full deterministic SMC/ICT engine (`smc-engine.js`): swing/fractal detection,
  HH/HL/LH/LL, BOS, CHoCH, liquidity sweeps, equal highs/lows, FVG, order
  blocks, displacement, premium/discount, multi-timeframe bias
- Installable as a PWA ("Add to Home Screen" on iPad → opens full-screen, no browser chrome)

## What needs one thing from you: a market-data API key

The engine and the header stats (live price, daily high/low, prev day
high/low, BUY/SELL/WAIT) need real OHLC candles. Until a key is configured,
the app **honestly shows "WAIT — LIVE DATA REQUIRED"** instead of guessing —
this is by design (see spec section 7), not a bug.

### Where the key goes (never in the frontend)

Provider: **Twelve Data** (https://twelvedata.com). Alpha Vantage was the
original choice but its free tier no longer reliably serves XAU/USD
(`CURRENCY_EXCHANGE_RATE` is premium-only, and its FX endpoints frequently
reject the XAU pair outright) — Twelve Data's free plan explicitly
supports `XAU/USD` as a standard symbol.

1. Get a free key: https://twelvedata.com/pricing → free plan (800
   requests/day, 8/min — plenty for personal use)
2. Deploy this project to Vercel (or any host that runs the `api/` serverless function)
3. In the hosting dashboard → **Environment Variables**, add:
   ```
   MARKET_DATA_API_KEY = <your Twelve Data key>
   ```
4. Redeploy — adding/changing an environment variable does **not**
   trigger a redeploy by itself in Vercel; you must trigger one manually
   (Deployments → ⋯ → Redeploy) or push a new commit.

The frontend never sees this key — it only calls your own
`/api/market-data` endpoint, which reads the key server-side
(`api/market-data.js`). Want a different provider later (Polygon.io,
etc.)? Swap the fetch logic inside that one file — the frontend contract
(`?type=quote|intraday|daily`) stays identical.

## Architecture (matches the spec)

```
LIVE MARKET DATA  (Alpha Vantage, key server-side only)
        ↓
api/market-data.js   (serverless — normalizes candles, never leaks the key)
        ↓
smc-engine.js         (deterministic SMC/ICT math — zero AI, zero randomness)
        ↓
STRUCTURED MARKET STATE (swings, BOS/CHoCH, sweeps, FVG, OB, premium/discount)
        ↓
generateSignal()       (hard confluence rules — BUY/SELL only if ALL conditions pass)
        ↓
BUY / SELL / WAIT + Entry / Invalidation / Confidence
        ↓
app.js renders it to the dashboard
```

The AI layer is intentionally **not wired in yet** — the spec is explicit
that math and structure detection must not depend on an LLM. If/when you
want an AI layer to *narrate* the structured output in plain language, it
should sit strictly after `generateSignal()` and only describe what the
engine already decided — never recompute levels itself.

## Deploying

```bash
# from inside gold-ai-trader/
npm install -g vercel   # one-time
vercel                  # deploy — follow the prompts
vercel env add MARKET_DATA_API_KEY   # paste your Alpha Vantage key when asked
vercel --prod
```

Any static host + serverless-function host works the same way (Netlify,
Cloudflare Pages + Workers, etc.) — just keep the `api/` handler running
server-side with the same env var name, or adjust `app.js`'s fetch URLs.

## Adding to iPad Home Screen

1. Open the deployed URL in Safari on iPad
2. Share button → **Add to Home Screen**
3. It launches full-screen, no Safari UI, with the app icon generated in `icons/`

## Roadmap (not built yet — by design, per the phased spec)

- Wire M5 as the true execution timeframe once intraday rate limits allow it
- News/macro panel: DXY, US10Y, CPI, NFP, FOMC, Fed speeches
- Alerts (entry zone, sweep, BOS, FVG retest, BUY/SELL setup)
- Trading Journal — **note:** you already have a separate Notion-backed /
  React-artifact journal project in progress; the plan is to point this
  app's "log this trade" action at that existing journal rather than
  building a second, competing one
- On-chart structure drawing (HH/HL/LH/LL labels, BOS/CHoCH markers, FVG/OB
  boxes) — currently the engine computes all of this, it's just not yet
  drawn on top of the TradingView widget (TradingView's free widget doesn't
  expose a drawing API; this needs either their paid Charting Library or a
  self-hosted chart like Lightweight Charts to overlay engine output directly)
