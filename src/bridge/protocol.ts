import type {ActiveTrade, OfferReport} from '../types';
export type ExternalRequest = {type: 'SKINCITO_GET_STATUS'} | {type: 'SKINCITO_OPEN_TRADE'; tradeId: string} | {type: 'SKINCITO_CREATE_OFFER'; tradeId: string};
export type InternalRequest = {type: 'WEB_REQUEST'; request: ExternalRequest} | {type: 'GET_STATUS'} | {type: 'GET_ACTIVE_TRADE'} | {type: 'OPEN_TRADE'; tradeId: string} | {type: 'CREATE_OFFER'; tradeId: string} | {type: 'PAGE_OFFER'; report: OfferReport};
export type PageMessage = {source: 'skincito-content'; type: 'ACTIVE_TRADE'; trade: ActiveTrade | null} | {source: 'skincito-page'; type: 'OFFER_CREATED'; report: OfferReport};
/** Firefox: la web y web-bridge.js se hablan por postMessage con estos mensajes. */
export type WebBridgeMessage = {source: 'skincito-web'; id: string; request: ExternalRequest} | {source: 'skincito-extension'; id: string; response: unknown};
