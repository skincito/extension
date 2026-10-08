import type {ActiveTrade, OfferReport} from '../types';
/** Lo que la web puede pedir. La entrega sólo se pide: la oferta se crea si el vendedor la aprueba en la ventana de la extensión. */
export type ExternalRequest = {type: 'SKINCITO_GET_STATUS'} | {type: 'SKINCITO_REQUEST_DELIVERY'; tradeId: string};
export type InternalRequest = {type: 'WEB_REQUEST'; request: ExternalRequest} | {type: 'GET_STATUS'} | {type: 'GET_ACTIVE_TRADE'} | {type: 'OPEN_TRADE'; tradeId: string} | {type: 'CREATE_OFFER'; tradeId: string} | {type: 'PAGE_OFFER'; report: OfferReport}
  | {type: 'REQUEST_DELIVERY'; tradeId: string} | {type: 'GET_APPROVAL'; requestId: string} | {type: 'PING_APPROVAL'; requestId: string} | {type: 'RESOLVE_APPROVAL'; requestId: string; approved: boolean};
/** Lo que ve la ventana de aprobación. `steamId` es la cuenta de Steam logueada en el navegador. */
export interface ApprovalView {trade: ActiveTrade; steamId: string; origin: string}
export type PageMessage = {source: 'skincito-content'; type: 'ACTIVE_TRADE'; trade: ActiveTrade | null} | {source: 'skincito-page'; type: 'OFFER_CREATED'; report: OfferReport};
/** Firefox: la web y web-bridge.js se hablan por postMessage con estos mensajes. */
export type WebBridgeMessage = {source: 'skincito-web'; id: string; request: ExternalRequest} | {source: 'skincito-extension'; id: string; response: unknown};
