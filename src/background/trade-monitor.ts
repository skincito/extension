import {getPendingTrades, reportStatus} from '../marketplace/client';
import {getSteamSession} from '../steam/session';
import {getTradeOffers} from '../steam/trade-offers';
import {getTradeHistory} from '../steam/trade-history';
import {evaluateTrade} from '../marketplace/matching';
import {config} from '../config';
import {proveTrade} from '../proof/trade-proof';
const LAST_CHECK = 'lastTradeCheck';
const PROOF_ATTEMPTS = 'proofAttempts';
let running = false;
export async function monitorTrades(force = false): Promise<void> {
  if (running) return;
  const last = ((await chrome.storage.local.get(LAST_CHECK))[LAST_CHECK] as number | undefined) ?? 0;
  if (!force && Date.now() - last < 3 * 60_000) return;
  running = true;
  try {
    const pending = await getPendingTrades();
    if (!pending.length) return;
    const session = await getSteamSession();
    const trades = pending.filter(t => t.sellerSteamId === session.steamId);
    if (!trades.length) return;
    const {sent} = await getTradeOffers(session.steamId);
    const history = await getTradeHistory(session.steamId);
    const attempts = ((await chrome.storage.local.get(PROOF_ATTEMPTS))[PROOF_ATTEMPTS] as Record<string, number> | undefined) ?? {};
    for (const trade of trades) {
      const offer = sent.find(o => o.tradeofferid === trade.steamTradeOfferId);
      const result = evaluateTrade(trade, history);
      // Un rechazo del backend para una operación (p. ej. 409 si cambió de estado) no frena al resto.
      await reportStatus(trade.id, {marketplaceTradeId: trade.id, steamTradeOfferId: offer?.tradeofferid,
        offerState: offer?.trade_offer_state, historyTradeId: result.trade?.tradeid,
        historyStatus: result.trade?.status, candidate: result.candidate, rolledBack: result.rolledBack,
        checkedAt: new Date().toISOString()}).catch(error => console.error('Skincito steam-status', trade.id, error));
      if ((result.candidate || result.rolledBack) && result.trade && config.notarySessionUrl && config.notaryVerifierUrl &&
          Date.now() - (attempts[trade.id] ?? 0) >= 6 * 60 * 60_000) {
        attempts[trade.id] = Date.now();
        await chrome.storage.local.set({[PROOF_ATTEMPTS]: attempts});
        try {await proveTrade(trade, result.trade)} catch (error) {console.error('TLSNotary proof failed', error)}
      }
    }
  } finally {running = false; await chrome.storage.local.set({[LAST_CHECK]: Date.now()})}
}
