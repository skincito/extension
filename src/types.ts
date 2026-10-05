export interface PendingTrade {
  id: string; sellerSteamId: string; buyerSteamId: string; assetId: string;
  marketHashName: string; acceptedAt: string; buyerTradeUrl: string;
  steamTradeOfferId?: string; proofAcceptedAt?: string;
}
export interface BlockingOffer {id: string; state: number}
/** Venta pendiente con la oferta de Steam que impide enviar otra, si existe. */
export type ActiveTrade = PendingTrade & {blockingOffer?: BlockingOffer};
export interface TradeAsset {assetid: string; new_assetid?: string; appid: number; contextid?: string}
export interface SteamOffer {tradeofferid: string; accountid_other: number; otherSteamId: string; trade_offer_state: number; items_to_give: TradeAsset[]; items_to_receive: TradeAsset[]; time_created: number; time_updated: number}
export interface SteamHistoryTrade {tradeid: string; steamid_other: string; status: number; assets_given: TradeAsset[]; assets_received: TradeAsset[]; time_init: number; time_settlement?: number; rollback_trade?: string}
/** `needsConfirmation`: Steam pidió confirmar la oferta en la app (Steam Guard) o por email; recién después le llega al comprador. */
export interface OfferReport {marketplaceTradeId: string; steamTradeOfferId: string; otherSteamId: string; givenAssetIds: string[]; receivedAssetIds: string[]; needsConfirmation?: boolean}
/** Respuesta de steamcommunity.com/tradeoffer/new/send. */
export interface SendOfferResponse {tradeofferid?: string; strError?: string; needs_mobile_confirmation?: boolean; needs_email_confirmation?: boolean}
export interface StatusReport {marketplaceTradeId: string; steamTradeOfferId?: string; offerState?: number; historyTradeId?: string; historyStatus?: number; newAssetId?: string; candidate: boolean; rolledBack: boolean; checkedAt: string}
export interface ProofSubmission {marketplaceTradeId: string; steamTradeId: string; proof: string; proofFormat: 'skincito-notary-v1'}
