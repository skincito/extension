import {getPendingTrades, reportStatus} from '../marketplace/client';
import {getSteamSession} from '../steam/session';
import {getTradeOffers} from '../steam/trade-offers';
import {getTradeHistory} from '../steam/trade-history';
import {evaluateTrade} from '../marketplace/matching';
import {config} from '../config';
import {proveTrade} from '../proof/trade-proof';
import type {SteamHistoryTrade} from '../types';
const LAST_CHECK = 'lastTradeCheck';
/** Antes se reintentaba la prueba recién a las 6 horas; queda solo para borrarlo. */
const LEGACY_PROOF_ATTEMPTS = 'proofAttempts';
/**
 * Resultado de cada prueba ya enviada, por operación y estado del trade en Steam. Una prueba
 * verificada o rechazada no se repite mientras el trade siga igual; un error (red, API, notario)
 * no se guarda y se reintenta en la próxima vuelta (3 minutos). Una prueba aceptada además la
 * informa la API (proofAcceptedAt) y la operación deja de ser candidata.
 */
const PROOF_OUTCOMES = 'proofOutcomes';
type ProofOutcomes = Record<string, {status: string; at: number}>;
const proofKey = (tradeId: string, trade: SteamHistoryTrade, rolledBack: boolean) =>
  `${tradeId}:${trade.tradeid}:${trade.status}:${rolledBack ? 'rollback' : 'delivery'}`;
let running = false;
export async function monitorTrades(force = false): Promise<void> {
  if (running) return;
  const last = ((await chrome.storage.local.get(LAST_CHECK))[LAST_CHECK] as number | undefined) ?? 0;
  if (!force && Date.now() - last < 3 * 60_000) return;
  running = true;
  // Se marca al empezar: si se marcara al terminar, la alarma siguiente caería dentro de los 3 minutos.
  await chrome.storage.local.set({[LAST_CHECK]: Date.now()});
  try {
    const pending = await getPendingTrades();
    if (!pending.length) return;
    const session = await getSteamSession();
    const trades = pending.filter(t => t.sellerSteamId === session.steamId);
    if (!trades.length) return;
    const {sent} = await getTradeOffers(session.steamId);
    const history = await getTradeHistory(session.steamId);
    const stored = ((await chrome.storage.local.get(PROOF_OUTCOMES))[PROOF_OUTCOMES] as ProofOutcomes | undefined) ?? {};
    // Sólo se conservan los resultados de operaciones que siguen pendientes.
    const outcomes: ProofOutcomes = Object.fromEntries(
      Object.entries(stored).filter(([key]) => trades.some(t => key.startsWith(`${t.id}:`))));
    await chrome.storage.local.remove(LEGACY_PROOF_ATTEMPTS);
    for (const trade of trades) {
      const offer = sent.find(o => o.tradeofferid === trade.steamTradeOfferId);
      const result = evaluateTrade(trade, history);
      // Un rechazo del backend para una operación (p. ej. 409 si cambió de estado) no frena al resto.
      await reportStatus(trade.id, {marketplaceTradeId: trade.id, steamTradeOfferId: offer?.tradeofferid,
        offerState: offer?.trade_offer_state, historyTradeId: result.trade?.tradeid,
        historyStatus: result.trade?.status,
        // Asset ID del item en el inventario del comprador; la API lo usa para buscarlo cuando no tiene float.
        newAssetId: result.trade?.assets_given.find(a => a.appid === 730 && a.assetid === trade.assetId)?.new_assetid,
        candidate: result.candidate, rolledBack: result.rolledBack,
        checkedAt: new Date().toISOString()}).catch(error => console.error('Skincito steam-status', trade.id, error));
      if ((result.candidate || result.rolledBack) && result.trade && config.notarySessionUrl && config.notaryVerifierUrl) {
        const key = proofKey(trade.id, result.trade, result.rolledBack);
        if (outcomes[key]) continue;
        try {
          const verdict = await proveTrade(trade, result.trade);
          outcomes[key] = {status: verdict.status ?? 'RECEIVED', at: Date.now()};
          if (verdict.status === 'REJECTED') console.warn('TLSNotary proof rejected', trade.id, verdict.reason);
        } catch (error) {console.error('TLSNotary proof failed', error)}
      }
    }
    await chrome.storage.local.set({[PROOF_OUTCOMES]: outcomes});
  } finally {running = false}
}
