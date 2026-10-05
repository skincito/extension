import type {SteamHistoryTrade} from '../types';
import {getAccessToken, clearAccessToken} from './access-token';
export async function getTradeHistory(sellerSteamId: string, maxTrades = 250): Promise<SteamHistoryTrade[]> {
  const token = await getAccessToken(sellerSteamId);
  const url = new URL('https://api.steampowered.com/IEconService/GetTradeHistory/v1/');
  url.search = new URLSearchParams({access_token: token, max_trades: String(maxTrades), include_failed: 'true'}).toString();
  const response = await fetch(url, {credentials: 'include'});
  if (!response.ok) {if (response.status === 401 || response.status === 403) await clearAccessToken(); throw new Error(`GetTradeHistory ${response.status}`)}
  const json = await response.json() as {response?: {trades?: SteamHistoryTrade[]}};
  return (json.response?.trades ?? []).map(trade => ({...trade,
    assets_given: (trade.assets_given ?? []).filter(a => a.appid === 730),
    assets_received: (trade.assets_received ?? []).filter(a => a.appid === 730)}));
}
