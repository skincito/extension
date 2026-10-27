import type {ActiveTrade, OfferReport, SaldoBuyRequest, SaldoSellRequest} from '../types';
/**
 * Lo que la web puede pedir. La entrega, la publicación y la compra en el market sólo se piden: pasan si el usuario
 * las aprueba en la ventana de la extensión.
 */
export type ExternalRequest = {type: 'SKINCITO_GET_STATUS'} | {type: 'SKINCITO_REQUEST_DELIVERY'; tradeId: string} | {type: 'SKINCITO_CANCEL_OFFER'; tradeOfferId: string}
  | {type: 'SKINCITO_REQUEST_SALDO_SELL'; saldoListingId: string} | {type: 'SKINCITO_REQUEST_SALDO_BUY'; saldoTradeId: string};
export type InternalRequest = {type: 'WEB_REQUEST'; request: ExternalRequest} | {type: 'GET_STATUS'} | {type: 'GET_ACTIVE_TRADE'} | {type: 'OPEN_TRADE'; tradeId: string} | {type: 'CREATE_OFFER'; tradeId: string} | {type: 'PAGE_OFFER'; report: OfferReport}
  | {type: 'REQUEST_DELIVERY'; tradeId: string} | {type: 'REQUEST_SALDO_SELL'; saldoListingId: string} | {type: 'REQUEST_SALDO_BUY'; saldoTradeId: string} | {type: 'CANCEL_OFFER'; tradeOfferId: string} | {type: 'GET_APPROVAL'; requestId: string} | {type: 'PING_APPROVAL'; requestId: string} | {type: 'RESOLVE_APPROVAL'; requestId: string; approved: boolean};
/** Billetera de Steam como la muestra la ventana (centavos). */
export interface WalletView {currency: number; balanceMinor: number}
/** Lo que ve la ventana de aprobación. `steamId` es la cuenta de Steam logueada en el navegador; `wallet` es null si no se pudo leer. */
export type ApprovalView = {kind: 'DELIVERY'; trade: ActiveTrade; steamId: string; origin: string}
  | {kind: 'SALDO_SELL'; sell: SaldoSellRequest; steamId: string; origin: string; wallet: WalletView | null}
  | {kind: 'SALDO_BUY'; buy: SaldoBuyRequest; steamId: string; origin: string; wallet: WalletView | null};
export type PageMessage = {source: 'skincito-content'; type: 'ACTIVE_TRADE'; trade: ActiveTrade | null} | {source: 'skincito-page'; type: 'OFFER_CREATED'; report: OfferReport};
/** Firefox: la web y web-bridge.js se hablan por postMessage con estos mensajes. */
export type WebBridgeMessage = {source: 'skincito-web'; id: string; request: ExternalRequest} | {source: 'skincito-extension'; id: string; response: unknown};
