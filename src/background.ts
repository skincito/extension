import {config} from './config';
import type {ActiveTrade, PendingTrade, OfferReport} from './types';
import type {ExternalRequest, InternalRequest} from './bridge/protocol';
import {getPendingTrades, reportOffer, SkincitoAuthError} from './marketplace/client';
import {getSteamSession} from './steam/session';
import {getAccessToken} from './steam/access-token';
import {createOffer} from './steam/create-offer';
import {monitorTrades} from './background/trade-monitor';
import {getTradeOffers} from './steam/trade-offers';
import {findBlockingOffer, OFFER_STATE_LABELS} from './marketplace/matching';

const DEMO_KEY = 'demoPendingTrade';
type SkincitoSession = 'ok' | 'unauthenticated' | 'error';
async function pendingWithSession(): Promise<{trades: PendingTrade[]; session: SkincitoSession}> {
  let session: SkincitoSession = 'ok';
  const live = await getPendingTrades().catch(error => {session = error instanceof SkincitoAuthError ? 'unauthenticated' : 'error'; return []});
  const demo = (await chrome.storage.local.get(DEMO_KEY))[DEMO_KEY] as PendingTrade | undefined;
  return {trades: demo ? [...live, demo] : live, session};
}
async function pending(): Promise<PendingTrade[]> {return (await pendingWithSession()).trades}
async function findTrade(id: string): Promise<PendingTrade> {
  const trade = (await pending()).find(t => t.id === id);
  if (!trade) throw new Error('Operación no encontrada.');
  return trade;
}
async function withBlockingOffers(trades: PendingTrade[], sellerSteamId: string): Promise<ActiveTrade[]> {
  if (!trades.length) return [];
  const {sent} = await getTradeOffers(sellerSteamId);
  return trades.map(t => {const o = findBlockingOffer(t, sent); return o ? {...t, blockingOffer: {id: o.tradeofferid, state: o.trade_offer_state}} : t});
}
async function assertNoBlockingOffer(trade: PendingTrade): Promise<void> {
  const [checked] = await withBlockingOffers([trade], trade.sellerSteamId);
  const offer = checked?.blockingOffer;
  if (offer) throw new Error(`Ya hay una oferta ${OFFER_STATE_LABELS[offer.state] ?? ''} (${offer.id}) para esta venta. No envíes otra.`);
}
async function openTrade(id: string): Promise<{opened: true}> {
  const trade = await findTrade(id);
  const u = new URL(trade.buyerTradeUrl);
  if (u.origin !== 'https://steamcommunity.com' || u.pathname !== '/tradeoffer/new/') throw new Error('Trade URL inválida.');
  await chrome.tabs.create({url: u.href});
  return {opened: true};
}
async function handle(message: InternalRequest): Promise<unknown> {
  switch (message.type) {
    case 'GET_STATUS': {
      const session = await getSteamSession();
      const token = await getAccessToken(session.steamId);
      const {trades, session: skincitoSession} = await pendingWithSession();
      return {steamId: session.steamId, hasAccessToken: !!token, skincitoSession, trades};
    }
    case 'GET_ACTIVE_TRADE': {
      const session = await getSteamSession();
      return withBlockingOffers((await pending()).filter(t => t.sellerSteamId === session.steamId), session.steamId);
    }
    case 'OPEN_TRADE': return openTrade(message.tradeId);
    case 'CREATE_OFFER': {
      const trade = await findTrade(message.tradeId);
      await assertNoBlockingOffer(trade);
      const report = await createOffer(trade);
      const demo = (await chrome.storage.local.get(DEMO_KEY))[DEMO_KEY] as PendingTrade | undefined;
      if (demo?.id === trade.id) await chrome.storage.local.set({demoOfferReport: report});
      else await reportOffer(trade.id, report);
      return report;
    }
    case 'PAGE_OFFER': {
      const r: OfferReport = message.report;
      const t = await findTrade(r.marketplaceTradeId);
      if (r.otherSteamId !== t.buyerSteamId || r.givenAssetIds.length !== 1 || r.givenAssetIds[0] !== t.assetId || r.receivedAssetIds.length) throw new Error('La oferta no coincide con la operación.');
      const demo = (await chrome.storage.local.get(DEMO_KEY))[DEMO_KEY] as PendingTrade | undefined;
      if (demo?.id === t.id) await chrome.storage.local.set({demoOfferReport: r});
      else await reportOffer(t.id, r);
      return {recorded: true};
    }
  }
}
chrome.runtime.onMessage.addListener((message: InternalRequest, sender, sendResponse) => {
  if ((message as InternalRequest & {target?: string}).target === 'offscreen') return;
  if (!['GET_STATUS', 'GET_ACTIVE_TRADE', 'OPEN_TRADE', 'CREATE_OFFER', 'PAGE_OFFER'].includes(message?.type)) return;
  if (sender.id !== chrome.runtime.id || (sender.url && !sender.url.startsWith('https://steamcommunity.com/') && !sender.url.startsWith(chrome.runtime.getURL('')))) return;
  handle(message).then(data => sendResponse({ok: true, data})).catch(error => sendResponse({ok: false, error: String(error)}));
  return true;
});
chrome.runtime.onMessageExternal.addListener((message: ExternalRequest, sender, sendResponse) => {
  if (!sender.url || !sender.origin || !config.websiteOrigins.includes(new URL(sender.url).origin) || !config.websiteOrigins.includes(sender.origin)) return;
  const operation: InternalRequest | undefined = message.type === 'SKINCITO_GET_STATUS' ? {type: 'GET_STATUS'} :
    message.type === 'SKINCITO_OPEN_TRADE' ? {type: 'OPEN_TRADE', tradeId: message.tradeId} :
    message.type === 'SKINCITO_CREATE_OFFER' ? {type: 'CREATE_OFFER', tradeId: message.tradeId} : undefined;
  if (!operation) return;
  handle(operation).then(data => sendResponse({ok: true, data})).catch(error => sendResponse({ok: false, error: String(error)}));
  return true;
});
const MONITOR_ALARM = 'skincito-monitor';
/** Crea la alarma si falta, tiene otro período o quedó a más de 10 minutos (p. ej. por un reloj del sistema mal puesto). */
async function ensureMonitorAlarm(): Promise<void> {
  const alarm = await chrome.alarms.get(MONITOR_ALARM);
  if (!alarm || alarm.periodInMinutes !== 3 || alarm.scheduledTime > Date.now() + 10 * 60_000)
    await chrome.alarms.create(MONITOR_ALARM, {periodInMinutes: 3, delayInMinutes: 1});
}
// La alarma ya está espaciada: no pasa por el freno de 3 minutos, que es para los arranques del service worker.
chrome.alarms.onAlarm.addListener(alarm => {if (alarm.name === MONITOR_ALARM) void monitorTrades(true).catch(console.error)});
chrome.runtime.onInstalled.addListener(() => {void ensureMonitorAlarm()});
// Despierta el service worker al abrir Chrome; las alarmas pueden no sobrevivir al reinicio.
chrome.runtime.onStartup.addListener(() => {void ensureMonitorAlarm()});
void ensureMonitorAlarm();
void monitorTrades().catch(console.error);
