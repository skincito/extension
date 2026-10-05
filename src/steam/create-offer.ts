import type {PendingTrade, OfferReport, SendOfferResponse} from '../types';
import {getSteamSession, requireSeller} from './session';
import {accountIdToSteamId} from './trade-offers';
function parseTradeUrl(trade: PendingTrade): {token: string; partner: string} {
  const url = new URL(trade.buyerTradeUrl);
  if (url.origin !== 'https://steamcommunity.com' || url.pathname !== '/tradeoffer/new/') throw new Error('Trade URL inválida.');
  const partner = url.searchParams.get('partner'); const token = url.searchParams.get('token');
  if (!partner || !/^\d+$/.test(partner) || !token || !/^[A-Za-z0-9_-]+$/.test(token)) throw new Error('Trade URL sin partner/token válidos.');
  if (accountIdToSteamId(Number(partner)) !== trade.buyerSteamId) throw new Error('La Trade URL no corresponde al comprador.');
  return {partner, token};
}
export async function createOffer(trade: PendingTrade): Promise<OfferReport> {
  const session = await getSteamSession(); requireSeller(session.steamId, trade.sellerSteamId);
  const {token} = parseTradeUrl(trade);
  const data = {newversion: true, version: 2, me: {assets: [{appid: 730, contextid: 2, amount: 1, assetid: trade.assetId}], currency: [], ready: false}, them: {assets: [], currency: [], ready: false}};
  const form = new URLSearchParams({sessionid: session.sessionId, serverid: '1', partner: trade.buyerSteamId,
    tradeoffermessage: `Skincito trade ${trade.id}`, json_tradeoffer: JSON.stringify(data), captcha: '', trade_offer_create_params: JSON.stringify({trade_offer_access_token: token})});
  const ruleId = 1;
  await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds: [ruleId], addRules: [{id: ruleId, priority: 1,
    action: {type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS, requestHeaders: [{header: 'referer', operation: chrome.declarativeNetRequest.HeaderOperation.SET, value: 'https://steamcommunity.com/tradeoffer/new'}]},
    condition: {urlFilter: 'https://steamcommunity.com/tradeoffer/new/send', resourceTypes: [chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST], initiatorDomains: [chrome.runtime.id]}}]});
  try {
    const response = await fetch('https://steamcommunity.com/tradeoffer/new/send', {method: 'POST', credentials: 'include', headers: {'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'}, body: form});
    const result = await response.json() as SendOfferResponse;
    if (!response.ok || !result.tradeofferid) throw new Error(result.strError || `Steam respondió ${response.status}`);
    return {marketplaceTradeId: trade.id, steamTradeOfferId: result.tradeofferid, otherSteamId: trade.buyerSteamId, givenAssetIds: [trade.assetId], receivedAssetIds: [],
      needsConfirmation: needsConfirmation(result)};
  } finally {await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds: [ruleId]})}
}
/** Steam devuelve el ID aunque la oferta todavía tenga que confirmarse en la app o por email. */
export function needsConfirmation(result: SendOfferResponse): boolean {
  return Boolean(result.needs_mobile_confirmation || result.needs_email_confirmation);
}
