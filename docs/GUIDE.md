# Guide

This guide complements the project `README.md` with a bit more detail on configuration, running, and common operational questions.

## What this repo does (and does not do)

- **Does**: poll a target address’ open Polymarket positions; optionally place matching BUY/SELL orders to copy the target.
- **Does not**: implement mempool monitoring, frontrunning, MongoDB persistence, Docker deployment, or ESLint scripts (not present in this repository).

## Installation

Prereqs:

- Node.js **18+**

Install:

```bash
npm install
```

## Configuration

Create `.env` from the template:

```bash
cp .env.example .env
```

### Required variables

| Variable | Required | Notes |
|---|---:|---|
| `TARGET_ADDRESS` | yes | Address to monitor |
| `COPY_TRADING_ENABLED` | yes | `false` = monitor only |
| `PRIVATE_KEY` | only if trading | Must be a real key (placeholder is rejected) |

### Recommended safety defaults

- Keep `DRY_RUN=true` until you’ve verified behavior and logs.
- Start with a low `POSITION_SIZE_MULTIPLIER` (e.g. `0.25`).
- Use `MAX_TRADE_SIZE` and `MAX_POSITION_SIZE` to cap risk.

## Running

Development:

```bash
npm run dev
```

Production:

```bash
npm run build
npm start
```

## Troubleshooting

### “Please set TARGET_ADDRESS”

- Ensure `.env` exists and contains `TARGET_ADDRESS=0x...`.
- Ensure you’re running from the repo root (so dotenv can load `.env`).

### “Invalid PRIVATE_KEY in .env”

- Copy trading is enabled and the key is missing/placeholder/invalid.
- Fix by setting a real `PRIVATE_KEY` value, or set `COPY_TRADING_ENABLED=false` to run monitor-only.

### No positions detected

- Confirm the target address actually has open positions.
- Increase `POLL_INTERVAL` if you’re hitting rate limits.

## Internals (where to look)

- **Entry point**: `src/index.ts`
- **Polling monitor**: `src/monitors/account-monitor.ts`
- **Copy trading logic**: `src/trading/copy-trading-monitor.ts`
- **Order execution**: `src/trading/trade-executor.ts`
- **HTTP API calls**: `src/clients/polymarket-client.ts`

