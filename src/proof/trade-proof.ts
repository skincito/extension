import {config} from '../config';
import type {PendingTrade, ProofVerdict, SteamHistoryTrade} from '../types';
import {getAccessToken} from '../steam/access-token';
import {getNotaryTicket, submitProof} from '../marketplace/client';
import {runProofWorker, type ProveMessage, type ProveResult} from './run-worker';
export async function proveTrade(trade: PendingTrade, history: SteamHistoryTrade): Promise<ProofVerdict> {
  if (!config.notarySessionUrl || !config.notaryVerifierUrl) throw new Error('Configurá el servicio TLSNotary antes de generar pruebas.');
  const token = await getAccessToken(trade.sellerSteamId);
  const url = new URL('https://api.steampowered.com/IEconService/GetTradeHistory/v1/');
  // Sin start_after_*/navigating_back: el notario sólo acepta la página más reciente, para que
  // un rollback o un intento posterior al trade probado no pueda quedar afuera.
  url.search = new URLSearchParams({max_trades: '100', include_failed: 'true', access_token: token}).toString();
  const ticket = await getNotaryTicket(trade.id);
  const response = await prove({url: url.href, token, ticket, sessionUrl: config.notarySessionUrl, verifierUrl: config.notaryVerifierUrl});
  if (!response?.ok || typeof response.proof !== 'string') throw new Error(response?.error || 'TLSNotary no devolvió una prueba.');
  return submitProof(trade.id, {marketplaceTradeId: trade.id, steamTradeId: history.tradeid, proof: response.proof, proofFormat: 'skincito-notary-v1'});
}
/** Chrome no permite workers en el service worker y usa un documento offscreen; Firefox no tiene offscreen pero su página de fondo sí crea workers. */
async function prove(message: ProveMessage): Promise<ProveResult> {
  if (!chrome.offscreen) return runProofWorker(message);
  await chrome.offscreen.createDocument({url: 'offscreen.html', reasons: [chrome.offscreen.Reason.WORKERS], justification: 'Generar una prueba TLSNotary de GetTradeHistory.'}).catch(async e => {if (!(await chrome.offscreen.hasDocument())) throw e});
  try {return await chrome.runtime.sendMessage({target: 'offscreen', type: 'PROVE', ...message})}
  finally {await chrome.offscreen.closeDocument().catch(() => {})}
}
