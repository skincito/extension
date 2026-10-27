import {config} from './config';
import {roleOf, type ActiveTrade, type PendingTrade, type OfferReport, type SaldoSellRequest} from './types';
import type {ApprovalView, ExternalRequest, InternalRequest} from './bridge/protocol';
import {confirmSaldoListing, getPendingTrades, getSaldoBuyRequest, getSaldoSellRequest, reportOffer, reportSaldoPurchase, SkincitoAuthError} from './marketplace/client';
import {getSteamSession} from './steam/session';
import {getAccessToken} from './steam/access-token';
import {createOffer} from './steam/create-offer';
import {monitorTrades} from './background/trade-monitor';
import {getTradeOffers, cancelTradeOffer} from './steam/trade-offers';
import {findBlockingOffer, OFFER_STATE_LABELS} from './marketplace/matching';
import {approve, complete, getApproval, isAwaitingConfirmation, reject, requestApproval, type ApprovalKind, type Awaiting} from './background/approval';
import {buySaldoListing, getOwnListing, getWalletInfo, sellSaldoItem, type SaldoBuyResult, type SaldoSellResult} from './steam/market';

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
/**
 * Cancela en Steam la oferta de una venta pendiente del usuario. Solo esa: la web no puede pedir que se
 * cancele cualquier otra oferta de la cuenta.
 */
async function cancelSaleOffer(tradeOfferId: string): Promise<{cancelled: true; tradeOfferId: string}> {
  const {steamId} = await getSteamSession();
  const sale = (await pending()).find(t => roleOf(t) === 'SELLER' && t.steamTradeOfferId === tradeOfferId);
  if (!sale) throw new Error('La oferta no corresponde a ninguna de tus ventas en curso.');
  if (sale.sellerSteamId !== steamId) throw new Error(`Esta venta se envió desde la cuenta ${sale.sellerSteamId}: iniciá sesión en Steam con esa cuenta.`);
  return cancelTradeOffer(tradeOfferId);
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
/** Resultado que vuelve a la web: si avisar a Skincito falló, la publicación o la compra igual ya se hizo en Steam. */
type Reported<T> = T & {reported: boolean; reportError?: string};
type SaldoSellOutcome = Reported<SaldoSellResult & {steamListingId: string | null}>;
/** Publicaciones hechas que esperan la confirmación en la app de Steam, por oferta: qué asset buscar. */
const sellsAwaitingConfirmation = new Map<string, SaldoSellRequest>();
/** Avisa "Ya lo publiqué" con la publicación que se ve entre las propias, si ya se encontró. */
async function reportSell(saldoListingId: string, result: SaldoSellResult, steamListingId: string | null): Promise<SaldoSellOutcome> {
  sellsAwaitingConfirmation.delete(saldoListingId);
  try {await confirmSaldoListing(saldoListingId, steamListingId ?? undefined); return {...result, steamListingId, reported: true}}
  catch (error) {return {...result, steamListingId, reported: false, reportError: (error as Error).message}}
}
/**
 * Publica el skin de la oferta de compra de saldo. Si Steam pide confirmarla en la app, la ventana queda
 * esperando (`Awaiting`) hasta que la publicación aparezca activa entre las propias (`CHECK_SALDO_SELL`).
 */
async function sellSaldo(saldoListingId: string): Promise<SaldoSellOutcome | Awaiting> {
  const request = await getSaldoSellRequest(saldoListingId);
  const result = await sellSaldoItem(request);
  const own = await getOwnListing(request.appId, request.assetId).catch(() => null);
  if (!result.needsConfirmation || own?.state === 'ACTIVE') return reportSell(saldoListingId, result, own?.listingId ?? null);
  sellsAwaitingConfirmation.set(saldoListingId, request);
  const onClose: SaldoSellOutcome = {...result, steamListingId: null, reported: false, reportError: 'cerraste la ventana antes de que Steam confirmara la publicación'};
  return {awaitingConfirmation: true, onClose};
}
/** "Ya la aprobé" (o el chequeo periódico de la ventana): ¿la publicación ya está activa en Steam? */
async function checkSaldoSell(requestId: string): Promise<{confirmed: false; state: 'TO_CONFIRM' | 'ON_HOLD'} | {confirmed: true; result: SaldoSellOutcome}> {
  const {kind, subjectId} = getApproval(requestId);
  const request = sellsAwaitingConfirmation.get(subjectId);
  if (kind !== 'SALDO_SELL' || !isAwaitingConfirmation(requestId) || !request) throw new Error('Este pedido no espera la confirmación de Steam.');
  const own = await getOwnListing(request.appId, request.assetId);
  if (!own) throw new Error('No encontramos la publicación en tu market de Steam. Si la cancelaste en la app, cerrá esta ventana y volvé a publicarla desde Skincito.');
  if (own.state !== 'ACTIVE') return {confirmed: false, state: own.state};
  const result = await reportSell(subjectId, {listed: true, needsConfirmation: true}, own.listingId);
  complete(requestId, result);
  return {confirmed: true, result};
}
/** Compra el listing de la operación y avisa "Ya la compré". Comprado en Steam, nunca falla: no hay que volver a comprar. */
async function buySaldo(saldoTradeId: string): Promise<Reported<SaldoBuyResult>> {
  const result = await buySaldoListing(await getSaldoBuyRequest(saldoTradeId));
  try {await reportSaldoPurchase(saldoTradeId); return {...result, reported: true}}
  catch (error) {return {...result, reported: false, reportError: (error as Error).message}}
}
function runApproved(kind: ApprovalKind, subjectId: string): Promise<unknown> {
  return kind === 'SALDO_SELL' ? sellSaldo(subjectId) : kind === 'SALDO_BUY' ? buySaldo(subjectId) : deliver(subjectId);
}
async function walletView() {
  const wallet = await getWalletInfo().catch(() => null);
  return wallet ? {currency: wallet.wallet_currency, balanceMinor: Number(wallet.wallet_balance ?? 0)} : null;
}
async function approvalView(requestId: string): Promise<ApprovalView> {
  const {kind, subjectId, origin} = getApproval(requestId);
  const {steamId} = await getSteamSession();
  if (kind === 'SALDO_SELL') return {kind, sell: await getSaldoSellRequest(subjectId), steamId, origin, wallet: await walletView()};
  if (kind === 'SALDO_BUY') return {kind, buy: await getSaldoBuyRequest(subjectId), steamId, origin, wallet: await walletView()};
  const trade = await findSale(subjectId);
  // Las ofertas enviadas sólo se pueden leer con la cuenta vendedora; con otra cuenta la ventana ya avisa y no deja aprobar.
  const [checked] = steamId === trade.sellerSteamId ? await withBlockingOffers([trade], steamId) : [trade];
  return {kind, trade: checked ?? trade, steamId, origin};
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
    case 'CANCEL_OFFER': return cancelSaleOffer(message.tradeOfferId);
    case 'REQUEST_DELIVERY': {
      await findSale(message.tradeId);
      return requestApproval<OfferReport>('DELIVERY', message.tradeId, origin);
    }
    // Se lee de Skincito antes de abrir la ventana: si la oferta o la operación no es del usuario, no se abre nada.
    case 'REQUEST_SALDO_SELL': {
      await getSaldoSellRequest(message.saldoListingId);
      return requestApproval('SALDO_SELL', message.saldoListingId, origin);
    }
    case 'REQUEST_SALDO_BUY': {
      await getSaldoBuyRequest(message.saldoTradeId);
      return requestApproval('SALDO_BUY', message.saldoTradeId, origin);
    }
    case 'GET_APPROVAL': return approvalView(message.requestId);
    // La ventana avisa cada tanto: mantiene vivo el service worker mientras el vendedor decide.
    case 'PING_APPROVAL': return getApproval(message.requestId);
    case 'CHECK_SALDO_SELL': return checkSaldoSell(message.requestId);
    case 'RESOLVE_APPROVAL':
      if (message.approved) return approve(message.requestId, runApproved);
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
    message?.type === 'SKINCITO_REQUEST_DELIVERY' && typeof message.tradeId === 'string' ? {type: 'REQUEST_DELIVERY', tradeId: message.tradeId} :
    message?.type === 'SKINCITO_CANCEL_OFFER' && typeof message.tradeOfferId === 'string' ? {type: 'CANCEL_OFFER', tradeOfferId: message.tradeOfferId} :
    message?.type === 'SKINCITO_REQUEST_SALDO_SELL' && typeof message.saldoListingId === 'string' ? {type: 'REQUEST_SALDO_SELL', saldoListingId: message.saldoListingId} :
    message?.type === 'SKINCITO_REQUEST_SALDO_BUY' && typeof message.saldoTradeId === 'string' ? {type: 'REQUEST_SALDO_BUY', saldoTradeId: message.saldoTradeId} : undefined;
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
  if (['GET_APPROVAL', 'PING_APPROVAL', 'RESOLVE_APPROVAL', 'CHECK_SALDO_SELL'].includes(message?.type)) return fromExtensionPage ? respond(message, sendResponse) : undefined;
  if (!['GET_STATUS', 'GET_ACTIVE_TRADE', 'OPEN_TRADE', 'CREATE_OFFER', 'PAGE_OFFER', 'CANCEL_OFFER'].includes(message?.type)) return;
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
