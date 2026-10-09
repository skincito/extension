import {getPendingTrades, reportStatus} from '../marketplace/client';
import {getSteamSession} from '../steam/session';
import {getTradeOffers} from '../steam/trade-offers';
import {getTradeHistory} from '../steam/trade-history';
import {evaluateTrade} from '../marketplace/matching';
import {config} from '../config';
import {proveTrade} from '../proof/trade-proof';
import {ownSteamId, roleOf, type SteamHistoryTrade} from '../types';
import {soldAsset} from '../marketplace/matching';
const LAST_CHECK = 'lastTradeCheck';
/** Antes se reintentaba la prueba recién a las 6 horas; queda solo para borrarlo. */
const LEGACY_PROOF_ATTEMPTS = 'proofAttempts';
/**
 * Resultado de cada prueba ya enviada, por operación y estado del trade en Steam. Una prueba
 * verificada no se repite mientras el trade siga igual, una rechazada se reintenta a los 30 minutos; un error (red, API, notario)
 * no se guarda y se reintenta en la próxima vuelta (3 minutos). Una prueba aceptada además la
 * informa la API (proofAcceptedAt) y la operación deja de ser candidata.
 */
const PROOF_OUTCOMES = 'proofOutcomes';
/** Un rechazo se vuelve a intentar pasado este tiempo: la API puede haber cambiado sus reglas. */
const REJECTED_RETRY_MS = 30 * 60_000;
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
    // Ventas y compras de la cuenta de Steam abierta: cada parte reporta y prueba con su historial.
    const trades = pending.filter(t => ownSteamId(t) === session.steamId);
    if (!trades.length) return;
    // Las ofertas enviadas solo le sirven al vendedor.
    const {sent} = trades.some(t => roleOf(t) === 'SELLER') ? await getTradeOffers(session.steamId) : {sent: []};
    const history = await getTradeHistory(session.steamId);
    const stored = ((await chrome.storage.local.get(PROOF_OUTCOMES))[PROOF_OUTCOMES] as ProofOutcomes | undefined) ?? {};
    // Sólo se conservan los resultados de operaciones que siguen pendientes.
    const outcomes: ProofOutcomes = Object.fromEntries(
      Object.entries(stored).filter(([key]) => trades.some(t => key.startsWith(`${t.id}:`))));
    await chrome.storage.local.remove(LEGACY_PROOF_ATTEMPTS);
    for (const trade of trades) {
      const offer = roleOf(trade) === 'SELLER' ? sent.find(o => o.tradeofferid === trade.steamTradeOfferId) : undefined;
      const result = evaluateTrade(trade, history);
      // Un rechazo del backend para una operación (p. ej. 409 si cambió de estado) no frena al resto.
      await reportStatus(trade.id, {marketplaceTradeId: trade.id, steamTradeOfferId: offer?.tradeofferid,
        offerState: offer?.trade_offer_state, historyTradeId: result.trade?.tradeid,
        historyStatus: result.trade?.status,
        // Asset ID del ítem en el inventario del comprador (Steam lo informa al terminar la protección).
        newAssetId: result.trade ? soldAsset(trade, result.trade)?.new_assetid : undefined,
        candidate: result.candidate, rolledBack: result.rolledBack,
        checkedAt: new Date().toISOString()}).catch(error => console.error('Skincito steam-status', trade.id, error));
      if ((result.candidate || result.rolledBack) && result.trade && config.notarySessionUrl && config.notaryVerifierUrl) {
        const key = proofKey(trade.id, result.trade, result.rolledBack);
        const previous = outcomes[key];
        if (previous && (previous.status !== 'REJECTED' || Date.now() - previous.at < REJECTED_RETRY_MS)) continue;
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
