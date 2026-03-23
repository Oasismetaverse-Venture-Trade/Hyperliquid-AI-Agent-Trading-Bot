import { tradeConfig } from "../config/tradeConfig";
import type { DataApiActivity } from "../types/apiResponses";
import type { GammaMarket } from "../types/market";
import type { CopyTradeIntent } from "../types/trade";
import { clamp } from "../utils/helpers";
export function activityToIntent(activity: DataApiActivity): CopyTradeIntent | null {
  
  if (activity.type !== "TRADE") return null;
  const usdc = activity.usdcSize;
  if (!Number.isFinite(usdc) || usdc <= 0) return null;
  const scaledUsdc = clamp(usdc * tradeConfig.copyRatio, tradeConfig.minTradeUsdc, tradeConfig.maxTradeUsdc);
  const shares = scaledUsdc / Math.max(1e-9, activity.price);
  const dedupeKey = `${activity.transactionHash}:${activity.asset}:${activity.side}`;
  return {
    dedupeKey,
    tokenId: String(activity.asset),
    conditionId: activity.conditionId,
    side: activity.side,
    price: activity.price,
    sizeUsdc: scaledUsdc,
    sizeShares: shares,
    title: activity.title,
    outcome: activity.outcome,
    eventSlug: activity.eventSlug,
    transactionHash: activity.transactionHash,
    timestamp: activity.timestamp,
    priority: scaledUsdc
  };
}

export function userTradeToIntent(
  t: Record<string, unknown>,
  market: GammaMarket,
  eventSlug: string
): CopyTradeIntent | null {
  const price = parseFloat(String(t.price ?? "0"));
  const size = parseFloat(String(t.size ?? "0"));
  if (!Number.isFinite(price) || !Number.isFinite(size) || price <= 0 || size <= 0) return null;
  const usdc = price * size;
  const scaledUsdc = clamp(usdc * tradeConfig.copyRatio, tradeConfig.minTradeUsdc, tradeConfig.maxTradeUsdc);
  const shares = scaledUsdc / Math.max(1e-9, price);
  const id = String(t.id ?? "");
  const tx = String(t.transaction_hash ?? t.id ?? "");
  const tsMs = parseInt(String(t.timestamp ?? "0"), 10);
  const ts = Number.isFinite(tsMs) ? Math.floor(tsMs / 1000) : Math.floor(Date.now() / 1000);
  const side = t.side === "SELL" ? "SELL" : "BUY";
  const dedupeKey = `ws:${id}:${side}`;
  return {
    dedupeKey,
    tokenId: String(t.asset_id ?? ""),
    conditionId: String(t.market ?? ""),
    side,
    price,
    sizeUsdc: scaledUsdc,
    sizeShares: shares,
    title: market.question ?? "?",
    outcome: String(t.outcome ?? ""),
    eventSlug,
    transactionHash: tx,
    timestamp: ts,
    priority: scaledUsdc
  };
}
