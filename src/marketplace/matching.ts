import type {PendingTrade, SteamHistoryTrade} from '../types';
export const TradeStatus = {Committed: 2, Complete: 3, Failed: 4, TradeProtectionRollback: 12} as const;
export function latestRelevantAttempt(order: PendingTrade, history: SteamHistoryTrade[]): SteamHistoryTrade | undefined {
  return history.filter(t => t.steamid_other === order.buyerSteamId && t.assets_given.some(a => a.appid === 730 && a.assetid === order.assetId))
    .sort((a, b) => b.time_init - a.time_init || b.tradeid.localeCompare(a.tradeid))[0];
}
export function evaluateTrade(order: PendingTrade, history: SteamHistoryTrade[]): {candidate: boolean; rolledBack: boolean; trade?: SteamHistoryTrade} {
  const trade = latestRelevantAttempt(order, history);
  if (!trade) return {candidate: false, rolledBack: false};
  const acceptedAt = Math.floor(Date.parse(order.acceptedAt) / 1000);
  const rolledBack = trade.status === TradeStatus.TradeProtectionRollback || history.some(t => t.rollback_trade === trade.tradeid);
  const candidate = !order.proofAcceptedAt && Number.isFinite(acceptedAt) && trade.time_init >= acceptedAt &&
    (trade.status === TradeStatus.Committed || trade.status === TradeStatus.Complete) &&
    !!trade.time_settlement && !rolledBack && !trade.rollback_trade;
  return {candidate, rolledBack, trade};
}
