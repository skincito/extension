import {config} from '../config';
import type {PendingTrade, SteamHistoryTrade} from '../types';
import {getAccessToken} from '../steam/access-token';
import {submitProof} from '../marketplace/client';
export async function proveTrade(trade: PendingTrade, history: SteamHistoryTrade): Promise<void> {
  if (!config.notarySessionUrl || !config.notaryVerifierUrl) throw new Error('Configurá el servicio TLSNotary antes de generar pruebas.');
  const token = await getAccessToken(trade.sellerSteamId);
  const url = new URL('https://api.steampowered.com/IEconService/GetTradeHistory/v1/');
  url.search = new URLSearchParams({max_trades: '5', start_after_time: String(history.time_init), navigating_back: 'true', include_failed: 'true', access_token: token}).toString();
  await chrome.offscreen.createDocument({url: 'offscreen.html', reasons: [chrome.offscreen.Reason.WORKERS], justification: 'Generar una prueba TLSNotary de GetTradeHistory.'}).catch(async e => {if (!(await chrome.offscreen.hasDocument())) throw e});
  try {
    const response = await chrome.runtime.sendMessage({target: 'offscreen', type: 'PROVE', url: url.href, token, sessionUrl: config.notarySessionUrl, verifierUrl: config.notaryVerifierUrl});
    if (!response?.ok || typeof response.proof !== 'string') throw new Error(response?.error || 'TLSNotary no devolvió una prueba.');
    await submitProof(trade.id, {marketplaceTradeId: trade.id, steamTradeId: history.tradeid, proof: response.proof, proofFormat: 'skincito-notary-v1'});
  } finally {await chrome.offscreen.closeDocument().catch(() => {})}
}
