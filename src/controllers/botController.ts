import type { ApiKeyCreds } from "@polymarket/clob-client";
import { appSecrets } from "../config";
import { isDryRun } from "../config/environment";
import { tradeConfig } from "../config/tradeConfig";
import { QueueManager } from "../core/queueManager";
import { scheduleDaily } from "../core/scheduler";
import { resetDailyMetrics, metrics } from "../utils/metrics";
import {
  eventSlugFromMarket,
  fetchMarketByConditionId
} from "../services/api/polymarketApi";
import { fetchRecentTrades } from "../services/api/userApi";
import { sendDiscord } from "../services/notifications/discordBot";
import { sendTelegram } from "../services/notifications/telegramBot";
import { submitCopyOrder } from "../services/blockchain/tradeExecutor";
import { activityToIntent, userTradeToIntent } from "../strategies/copyTrading";
import { allowIntent } from "../strategies/riskManagement";
import { logger } from "../utils/logger";
import { sleep } from "../utils/helpers";
import { isSportsMarketEvent } from "./marketController";
import { WalletController } from "./walletController";
import { startSportsWs } from "../services/websocket/sportsWs";
import { startTradeWs } from "../services/websocket/tradeWs";
import { ClobUserChannel } from "../services/websocket/clobUserChannel";
import { logStartupWalletBalances } from "../services/blockchain/onchainBalances";
import { validateTradingPrerequisites } from "../services/startup/validateTrading";
import { copyTradeDetail } from "../utils/copyTradeLog";
import { printSportResultColoredTable } from "../utils/sportResultTable";

import chalkLogger from "chalk-ts-logger";
import type { GammaMarket } from "../types/market";
import type { CopyTradeIntent } from "../types/trade";

export class BotController {
  private readonly seen = new Set<string>();
  private readonly queue = new QueueManager();
  private readonly wallets: WalletController;
  private highWaterTs = 0;
  private bootstrapped = false;
  private leaderWsWarmUntil = 0;
  private userWs: ClobUserChannel | null = null;

  constructor() {
    this.wallets = new WalletController(appSecrets.privateKeys, appSecrets.polygonRpc, tradeConfig.chainId);
  }

  async start(): Promise<void> {
    if (!appSecrets.privateKeys.length) throw new Error("PRIVATE_KEY required");

    if (tradeConfig.leaderFeed === "rest" && !appSecrets.targetWallet) {
      throw new Error("TARGET_WALLET required when LEADER_FEED=rest");
    }

    if (tradeConfig.leaderFeed === "clob_user_ws") {
      if (!appSecrets.targetClobApiKey || !appSecrets.targetClobSecret || !appSecrets.targetClobPassphrase) {
        throw new Error(
          "LEADER_FEED=clob_user_ws requires TARGET_CLOB_API_KEY, TARGET_CLOB_SECRET, TARGET_CLOB_PASSPHRASE (the leader account Polymarket CLOB API credentials)"
        );
      }
    }

    await validateTradingPrerequisites();
    await logStartupWalletBalances(this.wallets.wallets);
    chalkLogger.logText("bot started");
    scheduleDaily(0, 5, () => resetDailyMetrics());
    startSportsWs(appSecrets.wsSportsUrl || undefined, (p) => {
      if (appSecrets.sportsWsColoredTable) {
        printSportResultColoredTable(p);
      } else {
        logger.debug({ p }, "sport_result");
      }
    });
    startTradeWs(
      appSecrets.wsMarketAssetIds,
      (raw) => logger.debug({ raw }, "clob market"),
      appSecrets.marketWsCustomFeatures
    );

    logger.info(
      {
        target: appSecrets.targetWallet,
        leaderFeed: tradeConfig.leaderFeed,
        dryRun: isDryRun(),
        sportsOnly: tradeConfig.sportsOnly,
        signatureType: tradeConfig.signatureType,
        geoblock: tradeConfig.geoblockEnabled
      },
      "bot start"
    );

    if (tradeConfig.leaderFeed === "rest") {
      logger.info("leader: public Data API /activity — only TARGET_WALLET needed");
    }

    if (tradeConfig.leaderFeed === "clob_user_ws") {
      this.leaderWsWarmUntil = Date.now() + tradeConfig.leaderWsWarmupMs;
      const creds: ApiKeyCreds = {
        key: appSecrets.targetClobApiKey,
        secret: appSecrets.targetClobSecret,
        passphrase: appSecrets.targetClobPassphrase
      };
      this.userWs = new ClobUserChannel(
        creds,
        (payload) => {
          void this.onLeaderUserTrade(payload);
        },
        appSecrets.targetUserWsMarkets
      );
      this.userWs.start();
      await new Promise(() => {});
      return;
    }

    while (true) {
      try {
        await this.tickRest();
      } catch (e) {
        logger.error({ err: e }, "tick");
        metrics.lastError = String(e);
      }
      await sleep(tradeConfig.pollIntervalMs);
    }
  }

  private async onLeaderUserTrade(t: Record<string, unknown>): Promise<void> {
    if (Date.now() < this.leaderWsWarmUntil) return;
    const id = String(t.id ?? "");
    if (!id) return;
    if (this.seen.has(`ws:${id}`)) return;

    const conditionId = String(t.market ?? "");
    if (!conditionId) return;

    let market: GammaMarket | null;
    try {
      market = await fetchMarketByConditionId(conditionId);
    } catch (e) {
      logger.error({ err: e, conditionId }, "leader ws gamma");
      return;
    }
    if (!market) {
      this.seen.add(`ws:${id}`);
      return;
    }
    if (market.closed || market.active === false) {
      this.seen.add(`ws:${id}`);
      return;
    }
    if (market.enableOrderBook === false) {
      this.seen.add(`ws:${id}`);
      return;
    }

    const eventSlug = eventSlugFromMarket(market);
    const sportOk = await isSportsMarketEvent(eventSlug);
    if (!sportOk) {
      this.seen.add(`ws:${id}`);
      return;
    }

    const intent = userTradeToIntent(t, market, eventSlug);
    if (!intent) {
      this.seen.add(`ws:${id}`);
      return;
    }

    const risk = allowIntent(intent);
    if (!risk.ok) {
      this.seen.add(`ws:${id}`);
      return;
    }

    this.seen.add(`ws:${id}`);
    logger.info(
      { ...copyTradeDetail(intent, market), copyStatus: "scheduled" },
      "copy trade"
    );
    this.queue.enqueue(intent, async () => {
      await this.execute(intent, market);
    });
  }

  private async tickRest(): Promise<void> {
    const rows = await fetchRecentTrades(appSecrets.targetWallet, { limit: 50 });
    const newest = rows.reduce((m, r) => Math.max(m, r.timestamp), 0);
    if (!this.bootstrapped) {
      this.bootstrapped = true;
      this.highWaterTs = rows.length ? newest : Math.floor(Date.now() / 1000);
      return;
    }
    for (const a of rows) {
      if (a.timestamp <= this.highWaterTs) continue;
      const intent = activityToIntent(a);
      if (!intent) continue;
      if (this.seen.has(intent.dedupeKey)) continue;

      const sportOk = await isSportsMarketEvent(a.eventSlug);
      if (!sportOk) {
        this.seen.add(intent.dedupeKey);
        continue;
      }

      const risk = allowIntent(intent);
      if (!risk.ok) {
        this.seen.add(intent.dedupeKey);
        continue;
      }

      const market = await fetchMarketByConditionId(a.conditionId);
      if (!market) {
        this.seen.add(intent.dedupeKey);
        continue;
      }
      if (market.closed || market.active === false) {
        this.seen.add(intent.dedupeKey);
        continue;
      }
      if (market.enableOrderBook === false) {
        this.seen.add(intent.dedupeKey);
        continue;
      }

      this.seen.add(intent.dedupeKey);
      logger.info(
        { ...copyTradeDetail(intent, market), copyStatus: "scheduled" },
        "copy trade"
      );
      this.queue.enqueue(intent, async () => {
        await this.execute(intent, market);
      });
    }
    if (newest > this.highWaterTs) this.highWaterTs = newest;
  }

  private async execute(intent: CopyTradeIntent, market: GammaMarket): Promise<void> {
    metrics.tradesAttempted++;
    const detail = copyTradeDetail(intent, market);
    const msg = `${intent.side} ${intent.sizeUsdc.toFixed(2)} USDC @ ${intent.price} on ${intent.title}`;
    logger.info({ ...detail, copyStatus: "processing" }, "copy trade");
    if (isDryRun()) {
      logger.info({ ...detail, copyStatus: "dry_run_no_order" }, "copy trade");
      await sendTelegram(appSecrets.telegramBotToken, appSecrets.telegramChatId, `dry-run: ${msg}`);
      await sendDiscord(appSecrets.discordWebhookUrl, `dry-run: ${msg}`);
      metrics.tradesSucceeded++;
      metrics.usdcNotional += intent.sizeUsdc;
      return;
    }
    try {
      const w = this.wallets.next();
      const funder = appSecrets.funderAddress || undefined;
      logger.info(
        { ...detail, copyStatus: "submitting_clob", wallet: w.address, funder: funder ?? w.address },
        "copy trade"
      );
      const clobResponse = await submitCopyOrder(w.wallet, intent, market, funder);
      logger.info(
        { ...detail, copyStatus: "clob_order_posted", wallet: w.address, clobResponse },
        "copy trade"
      );
      metrics.tradesSucceeded++;
      metrics.usdcNotional += intent.sizeUsdc;
      await sendTelegram(appSecrets.telegramBotToken, appSecrets.telegramChatId, `filled: ${msg}`);
      await sendDiscord(appSecrets.discordWebhookUrl, `filled: ${msg}`);
    } catch (e) {
      metrics.tradesFailed++;
      metrics.lastError = String(e);
      logger.error({ err: e, ...detail, copyStatus: "failed" }, "copy trade");
      await sendTelegram(appSecrets.telegramBotToken, appSecrets.telegramChatId, `fail: ${msg} ${String(e)}`);
      await sendDiscord(appSecrets.discordWebhookUrl, `fail: ${msg}`);
    }
  }
}
