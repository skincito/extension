import {config} from './config';
import {roleOf, type ActiveTrade, type PendingTrade, type OfferReport} from './types';
import type {ApprovalView, ExternalRequest, InternalRequest} from './bridge/protocol';
import {getPendingTrades, reportOffer, SkincitoAuthError} from './marketplace/client';
import {getSteamSession} from './steam/session';
import {getAccessToken} from './steam/access-token';
import {createOffer} from './steam/create-offer';
import {monitorTrades} from './background/trade-monitor';
import {getTradeOffers} from './steam/trade-offers';
import {findBlockingOffer, OFFER_STATE_LABELS} from './marketplace/matching';
import {approve, getApproval, reject, requestApproval} from './background/approval';

const DEMO_KEY = 'demoPendingTrade';
const OPENED_TABS = 'openedTradeTabs';
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
/** Una venta: lo único que se puede enviar o abrir en Steam (una compra solo se prueba). */
async function findSale(id: string): Promise<PendingTrade & {buyerTradeUrl: string}> {
  const trade = await findTrade(id);
  if (roleOf(trade) !== 'SELLER' || !trade.buyerTradeUrl) throw new Error('Operación no encontrada.');
  return trade as PendingTrade & {buyerTradeUrl: string};
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
  const trade = await findSale(id);
  const u = new URL(trade.buyerTradeUrl);
  if (u.origin !== 'https://steamcommunity.com' || u.pathname !== '/tradeoffer/new/') throw new Error('Trade URL inválida.');
  const tab = await chrome.tabs.create({url: u.href});
  // Recordamos qué venta abrió esta pestaña: el comprador puede tener varias con el mismo trade URL.
  if (tab.id !== undefined) {
    const opened = ((await chrome.storage.session.get(OPENED_TABS))[OPENED_TABS] as Record<string, string> | undefined) ?? {};
    await chrome.storage.session.set({[OPENED_TABS]: {...opened, [tab.id]: trade.id}});
  }
  return {opened: true};
}
/** Crea la oferta con sólo el asset vendido y la registra en Skincito. */
async function deliver(tradeId: string): Promise<OfferReport> {
  const trade = await findSale(tradeId);
  await assertNoBlockingOffer(trade);
  const report = await createOffer(trade);
  const demo = (await chrome.storage.local.get(DEMO_KEY))[DEMO_KEY] as PendingTrade | undefined;
  if (demo?.id === trade.id) await chrome.storage.local.set({demoOfferReport: report});
  else await reportOffer(trade.id, report);
  return report;
}
async function approvalView(requestId: string): Promise<ApprovalView> {
  const {tradeId, origin} = getApproval(requestId);
  const trade = await findSale(tradeId);
  const {steamId} = await getSteamSession();
  // Las ofertas enviadas sólo se pueden leer con la cuenta vendedora; con otra cuenta la ventana ya avisa y no deja aprobar.
  const [checked] = steamId === trade.sellerSteamId ? await withBlockingOffers([trade], steamId) : [trade];
  return {trade: checked ?? trade, steamId, origin};
}
async function handle(message: InternalRequest, tabId?: number, origin = ''): Promise<unknown> {
  switch (message.type) {
    case 'GET_STATUS': {
      const session = await getSteamSession();
      const token = await getAccessToken(session.steamId);
      const {trades, session: skincitoSession} = await pendingWithSession();
      return {steamId: session.steamId, hasAccessToken: !!token, skincitoSession, trades};
    }
    case 'GET_ACTIVE_TRADE': {
      const session = await getSteamSession();
      const trades = await withBlockingOffers((await pending()).filter(t => roleOf(t) === 'SELLER' && t.sellerSteamId === session.steamId), session.steamId);
      const opened = ((await chrome.storage.session.get(OPENED_TABS))[OPENED_TABS] as Record<string, string> | undefined) ?? {};
      return {trades, preferredTradeId: tabId === undefined ? undefined : opened[tabId]};
    }
    case 'OPEN_TRADE': return openTrade(message.tradeId);
    case 'CREATE_OFFER': return deliver(message.tradeId);
    case 'REQUEST_DELIVERY': {
      await findSale(message.tradeId);
      return requestApproval(message.tradeId, origin);
    }
    case 'GET_APPROVAL': return approvalView(message.requestId);
    // La ventana avisa cada tanto: mantiene vivo el service worker mientras el vendedor decide.
    case 'PING_APPROVAL': return getApproval(message.requestId);
    case 'RESOLVE_APPROVAL':
      if (message.approved) return approve(message.requestId, deliver);
      return reject(message.requestId);
    case 'PAGE_OFFER': {
      const r: OfferReport = message.report;
      const t = await findSale(r.marketplaceTradeId);
      if (r.otherSteamId !== t.buyerSteamId || r.givenAssetIds.length !== 1 || r.givenAssetIds[0] !== t.assetId || r.receivedAssetIds.length) throw new Error('La oferta no coincide con la operación.');
      const demo = (await chrome.storage.local.get(DEMO_KEY))[DEMO_KEY] as PendingTrade | undefined;
      if (demo?.id === t.id) await chrome.storage.local.set({demoOfferReport: r});
      else await reportOffer(t.id, r);
      return {recorded: true};
    }
  }
}
function fromWebsite(url: string | undefined): boolean {
  try {return !!url && config.websiteOrigins.includes(new URL(url).origin)} catch {return false}
}
/** Lo que la web puede pedir: lo mismo llega por externally_connectable (Chrome) o por web-bridge.js (Firefox). */
function externalOperation(message: ExternalRequest): InternalRequest | undefined {
  return message?.type === 'SKINCITO_GET_STATUS' ? {type: 'GET_STATUS'} :
    message?.type === 'SKINCITO_REQUEST_DELIVERY' && typeof message.tradeId === 'string' ? {type: 'REQUEST_DELIVERY', tradeId: message.tradeId} : undefined;
}
function respond(operation: InternalRequest, sendResponse: (response: unknown) => void, tabId?: number, origin?: string): true {
  handle(operation, tabId, origin).then(data => sendResponse({ok: true, data})).catch(error => sendResponse({ok: false, error: String(error)}));
  return true;
}
chrome.runtime.onMessage.addListener((message: InternalRequest, sender, sendResponse) => {
  if ((message as InternalRequest & {target?: string}).target === 'offscreen') return;
  if (message?.type === 'WEB_REQUEST') {
    // Sólo desde web-bridge.js corriendo en una pestaña de la web de Skincito.
    if (sender.id !== chrome.runtime.id || !sender.tab || !fromWebsite(sender.url)) return;
    const operation = externalOperation(message.request);
    return operation ? respond(operation, sendResponse, undefined, new URL(sender.url!).origin) : undefined;
  }
  if (sender.id !== chrome.runtime.id) return;
  const fromExtensionPage = !!sender.url?.startsWith(chrome.runtime.getURL(''));
  // Aprobar una entrega sólo desde la ventana de la extensión, nunca desde un content script.
  if (['GET_APPROVAL', 'PING_APPROVAL', 'RESOLVE_APPROVAL'].includes(message?.type)) return fromExtensionPage ? respond(message, sendResponse) : undefined;
  if (!['GET_STATUS', 'GET_ACTIVE_TRADE', 'OPEN_TRADE', 'CREATE_OFFER', 'PAGE_OFFER'].includes(message?.type)) return;
  if (sender.url && !sender.url.startsWith('https://steamcommunity.com/') && !fromExtensionPage) return;
  return respond(message, sendResponse, sender.tab?.id);
});
chrome.runtime.onMessageExternal?.addListener((message: ExternalRequest, sender, sendResponse) => {
  if (!sender.origin || !fromWebsite(sender.url) || !config.websiteOrigins.includes(sender.origin)) return;
  const operation = externalOperation(message);
  return operation ? respond(operation, sendResponse, undefined, sender.origin) : undefined;
});
chrome.tabs.onRemoved.addListener(tabId => {void chrome.storage.session.get(OPENED_TABS).then(r => {
  const opened = r[OPENED_TABS] as Record<string, string> | undefined;
  if (opened?.[tabId]) {delete opened[tabId]; return chrome.storage.session.set({[OPENED_TABS]: opened})}
})});
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
