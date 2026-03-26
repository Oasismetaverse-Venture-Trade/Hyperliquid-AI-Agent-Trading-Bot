# Polymarket Copy Trading Bot

TypeScript bot that **monitors a Polymarket address** and can optionally **copy its open positions** by placing matching BUY/SELL orders via the Polymarket CLOB client.

[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

## Overview

This project has two modes:

- **Monitor-only**: polls a target wallet’s **open positions** and prints a clean status view.
- **Copy trading**: when the target **opens** a new position, the bot places a **BUY**; when the target **closes** a position, the bot places a **SELL**.

Important: the current implementation is **polling-based** (no mempool / frontrunning logic in this repo).

## Screenshots

All images in `docs/images/`:

### Console preview

![Console preview](docs/images/console-preview.png)

### Dashboard

![Dashboard](docs/images/dashboard.png)

### Trade flow

![Trade flow](docs/images/trade-flow.png)

### Follow

![Follow](docs/images/follow.png)

### Target

![Target](docs/images/target.png)

## Quick start

### Prerequisites

- Node.js **18+**
- A Polymarket/Polygon-compatible wallet (private key required only for copy trading)

### Install

```bash
npm install
```

### Configure

Copy the template and fill in values:

```bash
cp .env.example .env
```

Required variables:

| Variable | Required | Description |
|---|---:|---|
| `TARGET_ADDRESS` | yes | Address to monitor |
| `COPY_TRADING_ENABLED` | yes | `true` to trade, `false` to monitor only |
| `PRIVATE_KEY` | copy trading only | Wallet key used for signing CLOB actions |

Safety variables (recommended):

| Variable | Default | Description |
|---|---:|---|
| `DRY_RUN` | `true` in `.env.example` | Simulate orders (no real trading) |
| `POSITION_SIZE_MULTIPLIER` | `1.0` | Scale copied position size |
| `MAX_POSITION_SIZE` | `10000` | Skip positions above this USD size |
| `MAX_TRADE_SIZE` | `5000` | Skip trades above this USD size |
| `MIN_TRADE_SIZE` | `1` | Skip trades below this USD size |
| `SLIPPAGE_TOLERANCE` | `1.0` | Percent slippage tolerance (passed through config) |
| `POLL_INTERVAL` | `30000` | Polling interval in ms |

Optional variables:

| Variable | Default | Description |
|---|---:|---|
| `POLYMARKET_API_KEY` | - | Optional bearer token for some endpoints |
| `CHAIN_ID` | `137` | Polygon mainnet |
| `CLOB_HOST` | `https://clob.polymarket.com` | Polymarket CLOB host |

### Run

Development:

```bash
npm run dev
```

Production:

```bash
npm run build
npm start
```

## Project structure

```text
.
├─ docs/
│  ├─ GUIDE.md
│  └─ images/
├─ examples/
├─ src/
│  ├─ clients/
│  │  └─ polymarket-client.ts
│  ├─ monitors/
│  │  └─ account-monitor.ts
│  ├─ trading/
│  │  ├─ copy-trading-monitor.ts
│  │  └─ trade-executor.ts
│  ├─ types/
│  │  └─ index.ts
│  └─ index.ts
├─ .env.example
├─ package.json
└─ tsconfig.json
```

## How it works (high level)

- **`PolymarketClient`** (`src/clients/polymarket-client.ts`): fetches positions/trades and normalizes API responses.
- **`AccountMonitor`** (`src/monitors/account-monitor.ts`): polls `getUserPositions()` and emits updates.
- **`CopyTradingMonitor`** (`src/trading/copy-trading-monitor.ts`): compares the latest target positions against the previous snapshot and triggers trade actions.
- **`TradeExecutor`** (`src/trading/trade-executor.ts`): uses `@polymarket/clob-client` to create/post BUY/SELL orders (or simulates when `DRY_RUN=true`).

## Console output style (ANSI colors)

The built-in `AccountMonitor.getFormattedStatus()` now prints a colored “dashboard” look (ANSI escape codes).  
To disable colors set `NO_COLOR=1`.

Example (standalone demo):

```bash
node -e "const R=(s)=>`\\x1b[0m${s}`; const c=(code,s)=>`\\x1b[${code}m${s}\\x1b[0m`; const box=(title,lines)=>{const w=Math.max(title.length,...lines.map(l=>l.length))+4; const top='╔'+'═'.repeat(w-2)+'╗'; const mid='║ '+title.padEnd(w-4)+' ║'; const sep='╠'+'═'.repeat(w-2)+'╣'; const body=lines.map(l=>'║ '+l.padEnd(w-4)+' ║'); const bot='╚'+'═'.repeat(w-2)+'╝'; console.log(c('35',top)); console.log(c('35',mid)); console.log(c('35',sep)); body.forEach(l=>console.log(c('35',l))); console.log(c('35',bot));}; const badge=(label,value,color)=>`${c(color,label.padEnd(10))} ${value}`; box('LIVE SPORTS', [badge('CHALLENGER','Challenger Split  |  LIVE  |  tennis','33'), badge('SCORE','5-1  ♦  S1','95'), badge('status','inprogress','36'), badge('gameId','5265294','36')]);"
```

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Run `src/index.ts` via `ts-node` |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled `dist/index.js` |
| `npm run watch` | TypeScript build in watch mode |
| `npm run example:basic` | Run `examples/basic-usage.ts` |
| `npm run example:custom` | Run `examples/custom-handler.ts` |
| `npm run example:copy-trading` | Run `examples/copy-trading.ts` |

## Security

- Never commit `.env`.
- Always start with `DRY_RUN=true`.
- Treat `PRIVATE_KEY` as production secret (use a dedicated wallet with limited funds).

## Disclaimer

This project is provided “as is” for educational purposes. Trading involves risk. You are responsible for complying with applicable laws and platform terms.
