import type {PendingTrade, SteamHistoryTrade, SteamOffer} from '../types';
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
export const TradeOfferState = {Active: 2, Accepted: 3, CreatedNeedsConfirmation: 9, InEscrow: 11} as const;
const BLOCKING_OFFER_STATES: number[] = [TradeOfferState.Active, TradeOfferState.Accepted, TradeOfferState.CreatedNeedsConfirmation, TradeOfferState.InEscrow];
export const OFFER_STATE_LABELS: Record<number, string> = {2: 'activa', 3: 'aceptada', 9: 'esperando confirmación en el celular', 11: 'en escrow'};
/** Oferta enviada que todavía puede entregar (o ya entregó) el asset: registrada para la venta o armada a mano para el mismo comprador y asset. */
export function findBlockingOffer(order: PendingTrade, sent: SteamOffer[]): SteamOffer | undefined {
  return sent.find(o => BLOCKING_OFFER_STATES.includes(o.trade_offer_state) && (o.tradeofferid === order.steamTradeOfferId ||
    (o.otherSteamId === order.buyerSteamId && o.items_to_give.some(a => a.appid === 730 && a.assetid === order.assetId))));
}
/**
 * Elige qué venta asistir en la página de oferta. Varias ventas al mismo comprador comparten trade URL:
 * se prefiere la que se abrió desde Skincito, después la primera que todavía no tiene oferta, y sólo
 * si todas ya tienen una se muestra el bloqueo.
 */
export function pickActiveTrade<T extends PendingTrade & {blockingOffer?: unknown}>(trades: T[], preferredId?: string): T | undefined {
  const preferred = trades.find(t => t.id === preferredId);
  return (preferred && !preferred.blockingOffer ? preferred : undefined) ?? trades.find(t => !t.blockingOffer) ?? preferred ?? trades[0];
}
