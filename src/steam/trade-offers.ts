import type {SteamOffer, TradeAsset} from '../types';
import {getAccessToken, clearAccessToken} from './access-token';

const BASE = 76561197960265728n;
export function accountIdToSteamId(accountId: number): string {return (BASE + BigInt(accountId)).toString()}
interface ApiOffer extends Omit<SteamOffer, 'otherSteamId' | 'items_to_give' | 'items_to_receive'> {items_to_give?: TradeAsset[]; items_to_receive?: TradeAsset[]}
function normalize(o: ApiOffer): SteamOffer {return {...o, otherSteamId: accountIdToSteamId(o.accountid_other), items_to_give: o.items_to_give ?? [], items_to_receive: o.items_to_receive ?? []}}
export async function getTradeOffers(sellerSteamId: string): Promise<{sent: SteamOffer[]; received: SteamOffer[]; source: 'api' | 'html'}> {
  try {
    const token = await getAccessToken(sellerSteamId);
    const url = new URL('https://api.steampowered.com/IEconService/GetTradeOffers/v1/');
    url.search = new URLSearchParams({access_token: token, get_sent_offers: 'true', get_received_offers: 'true'}).toString();
    const response = await fetch(url, {credentials: 'include'});
    if (!response.ok) throw new Error(`GetTradeOffers ${response.status}`);
    const json = await response.json() as {response?: {trade_offers_sent?: ApiOffer[]; trade_offers_received?: ApiOffer[]; next_cursor?: number}};
    const sent = (json.response?.trade_offers_sent ?? []).map(normalize);
    const received = (json.response?.trade_offers_received ?? []).map(normalize);
    if (sent.length || received.length) return {sent, received, source: 'api'};
  } catch (error) {console.warn('GetTradeOffers; se usará HTML', error); await clearAccessToken()}
  const response = await fetch('https://steamcommunity.com/id/me/tradeoffers/sent?l=english', {credentials: 'include'});
  if (!response.ok) throw new Error(`Steam sent offers ${response.status}`);
  const html = await response.text();
  if (/too many requests/i.test(html)) throw new Error('Steam limitó la consulta de ofertas.');
  const sent = parseSentOffersHtml(html);
  return {sent, received: [], source: 'html'};
}

// Fallback is intentionally state-only. HTML lacks the API's reliable item and party fields.
export function parseSentOffersHtml(html: string): SteamOffer[] {
  const blocks = html.split(/(?=<div\s+class="tradeoffer"\s+id="tradeofferid_\d+")/);
  return blocks.flatMap(block => {
    const id = /^<div\s+class="tradeoffer"\s+id="tradeofferid_(\d+)"/.exec(block)?.[1];
    if (!id) return [];
    const region = block.split(/(?=<div\s+class="tradeoffer"\s+id="tradeofferid_\d+")/)[0] ?? '';
    const inactive = /tradeoffer_items_ctn[^]*?inactive/.test(region);
    const banner = /tradeoffer_items_banner[^>]*>([^<]*)/i.exec(region)?.[1]?.toLowerCase() ?? '';
    const states: [RegExp, number][] = [[/accepted/,3],[/counter/,4],[/expired/,5],[/cancel/,6],[/declined/,7],[/invalid/,8],[/mobile confirmation/,9],[/escrow/,11]];
    const state = inactive ? (states.find(([re]) => re.test(banner))?.[1] ?? 1) : 2;
    return [{tradeofferid: id, accountid_other: 0, otherSteamId: '', trade_offer_state: state, items_to_give: [], items_to_receive: [], time_created: 0, time_updated: 0}];
  });
}
