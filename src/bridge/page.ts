import type {ActiveTrade, OfferReport} from '../types';
import type {PageMessage} from './protocol';
declare const UserThem: {strSteamId?: string} | undefined;
declare const UserYou: {findAsset?: (appid: number, contextid: number, assetid: string) => {element?: HTMLElement} | undefined} | undefined;
declare const MoveItemToTrade: (element: HTMLElement) => void;
declare const ShowItemInventory: (appid: number, contextid: number) => void;
declare const g_steamID: string | undefined;
declare const g_rgCurrentTradeStatus: {me?: {assets?: {appid: number; contextid: string; assetid: string}[]}; them?: {assets?: {appid: number; contextid: string; assetid: string}[]}} | undefined;
declare const $J: ((target: Document) => {on: (event: string, cb: (_: unknown, request: {responseJSON?: {tradeofferid?: string}}, settings: {url: string; data?: string}) => void) => void}) | undefined;
let active: ActiveTrade | null = null;
let banner: HTMLDivElement | undefined;
function render(message: string, warning = false): void {
  banner ??= document.createElement('div');
  banner.id = 'skincito-trade-assistant';
  banner.style.cssText = `position:fixed;top:10px;right:10px;z-index:999999;background:${warning ? '#9a1b1b' : '#102c46'};color:white;padding:16px;max-width:370px;border-radius:8px;font:14px Arial;box-shadow:0 2px 15px #0008`;
  let label = banner.querySelector('span');
  if (!label) {label = document.createElement('span'); banner.prepend(label)}
  label.textContent = message;
  if (!banner.isConnected) document.body.append(banner);
}
function inspect(): void {
  if (!active) return;
  if (g_steamID !== active.sellerSteamId || UserThem?.strSteamId !== active.buyerSteamId) {render('Skincito: cuenta o comprador Steam incorrecto. No envíes esta oferta.', true); return}
  if (active.blockingOffer) {render(`Skincito: ya enviaste la oferta ${active.blockingOffer.id} para esta venta. No envíes otra.`, true); return}
  const assets = g_rgCurrentTradeStatus?.me?.assets ?? [];
  if (assets.some(a => a.assetid !== active!.assetId || a.appid !== 730 || String(a.contextid) !== '2') || (g_rgCurrentTradeStatus?.them?.assets?.length ?? 0) > 0) {
    render('Skincito: la oferta contiene items ajenos a esta venta. No la envíes.', true); return;
  }
  render(`Skincito: comprador ${active.buyerSteamId} · ${active.marketHashName} · Asset ID ${active.assetId}`);
}
function enable(trade: ActiveTrade): void {
  active = trade;
  inspect();
  const inventory = document.getElementById('inventories');
  if (inventory) {inventory.style.pointerEvents = 'none'; inventory.style.opacity = '0.65'}
  const button = document.createElement('button'); button.textContent = 'Agregar asset vendido';
  button.style.cssText = 'display:block;margin-top:10px;padding:8px;cursor:pointer';
  if (trade.blockingOffer) button.disabled = true;
  button.onclick = () => {
    inspect();
    if (active?.blockingOffer) return;
    if (g_steamID !== trade.sellerSteamId || UserThem?.strSteamId !== trade.buyerSteamId) return;
    if ((g_rgCurrentTradeStatus?.me?.assets?.length ?? 0) > 0 || (g_rgCurrentTradeStatus?.them?.assets?.length ?? 0) > 0) {render('Quitá los otros items antes de continuar.', true); return}
    const asset = UserYou?.findAsset?.(730, 2, trade.assetId)?.element;
    if (!asset) {try {ShowItemInventory(730, 2)} catch {} render('El asset vendido ya no se encuentra en tu inventario. No envíes otro item manualmente.', true); return}
    MoveItemToTrade(asset);
    const note = document.getElementById('trade_offer_note') as HTMLTextAreaElement | null;
    if (note) note.value = `Skincito trade ${trade.id}`;
    setTimeout(inspect, 300);
  };
  banner?.append(button);
  setInterval(inspect, 1500);
}
window.addEventListener('message', event => {
  if (event.source !== window || event.origin !== location.origin) return;
  const m = event.data as PageMessage;
  if (m?.source === 'skincito-content' && m.type === 'ACTIVE_TRADE' && m.trade) enable(m.trade);
});
function capture(): void {
  if (typeof $J === 'undefined') {setTimeout(capture, 500); return}
  $J(document).on('ajaxComplete', (_event, request, settings) => {
    if (!active || !settings.url.includes('/tradeoffer/new/send') || !request.responseJSON?.tradeofferid || !settings.data) return;
    try {
      const form = new URLSearchParams(settings.data);
      const raw = JSON.parse(form.get('json_tradeoffer') ?? '{}') as {me?: {assets?: {appid: number; assetid: string}[]}; them?: {assets?: {appid: number; assetid: string}[]}};
      const report: OfferReport = {marketplaceTradeId: active.id, steamTradeOfferId: request.responseJSON.tradeofferid,
        otherSteamId: UserThem?.strSteamId ?? '', givenAssetIds: (raw.me?.assets ?? []).map(a => a.assetid),
        receivedAssetIds: (raw.them?.assets ?? []).map(a => a.assetid)};
      active = {...active, blockingOffer: {id: report.steamTradeOfferId, state: 9}};
      inspect();
      window.postMessage({source: 'skincito-page', type: 'OFFER_CREATED', report} satisfies PageMessage, location.origin);
    } catch (error) {console.error('Skincito offer capture', error)}
  });
}
capture();
