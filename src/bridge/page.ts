import type {ActiveTrade, OfferReport, SendOfferResponse} from '../types';
import type {PageMessage} from './protocol';
declare const UserThem: {strSteamId?: string} | undefined;
declare const UserYou: {findAsset?: (appid: number, contextid: number, assetid: string) => {element?: HTMLElement} | undefined} | undefined;
declare const MoveItemToTrade: (element: HTMLElement) => void;
declare const ShowItemInventory: (appid: number, contextid: number) => void;
declare const g_steamID: string | undefined;
declare const g_rgCurrentTradeStatus: {me?: {assets?: {appid: number; contextid: string; assetid: string}[]}; them?: {assets?: {appid: number; contextid: string; assetid: string}[]}} | undefined;
declare const $J: ((target: Document) => {on: (event: string, cb: (_: unknown, request: {responseJSON?: SendOfferResponse}, settings: {url: string; data?: string}) => void) => void}) | undefined;
let active: ActiveTrade | null = null;
// Aviso fijado por un click (p. ej. asset faltante) que prevalece sobre el estado inspeccionado hasta el próximo click.
let notice: View | null = null;
type View = {tone: 'info' | 'success' | 'warning'; title: string; detail: string; action?: boolean};
// El panel vive en un Shadow DOM para que el CSS de Steam no lo afecte y el nuestro no se filtre a Steam.
const STYLES = `
:host{all:initial;display:block;margin:10px 0 16px;font-family:"Motiva Sans",Arial,Helvetica,sans-serif}
:host(.floating){position:fixed;top:10px;right:10px;z-index:999999;max-width:420px}
.card{display:flex;align-items:center;gap:14px;padding:14px 16px;border-radius:4px;background:#15171c;color:#fff;box-shadow:0 2px 10px #0006;border-left:4px solid #3b82f6}
.card.success{border-left-color:#a4d007}
.card.warning{background:#8f1515;border-left-color:#ff6b6b}
.logo{flex:none;width:36px;height:36px;border-radius:6px;background:#3b82f6;display:grid;place-items:center;font:700 20px Arial,sans-serif;color:#fff}
.warning .logo{background:#fff2;}
.body{flex:1;min-width:0}
.eyebrow{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#8f98a0}
.warning .eyebrow{color:#ffd0d0}
.title{font-size:17px;line-height:1.3;margin:2px 0;overflow-wrap:anywhere}
.detail{font-size:13px;color:#acb2b8;overflow-wrap:anywhere;white-space:pre-line}
.warning .detail{color:#ffe3e3}
.btn{flex:none;border:0;border-radius:2px;padding:1px;cursor:pointer;color:#d2efa9;background:linear-gradient(to bottom,#a4d007 5%,#536904 95%);font:inherit}
.btn span{display:block;padding:0 16px;line-height:32px;font-size:15px;border-radius:2px;background:linear-gradient(to bottom,#799905 5%,#536904 95%)}
.btn:hover{color:#fff;background:linear-gradient(to bottom,#b6d908 5%,#80a006 95%)}
.btn:hover span{background:linear-gradient(to bottom,#a1bf07 5%,#80a006 95%)}
.btn[hidden]{display:none}
`;
let host: HTMLElement | undefined;
let ui: {card: HTMLDivElement; eyebrow: HTMLDivElement; title: HTMLDivElement; detail: HTMLDivElement; button: HTMLButtonElement} | undefined;
function mount(): NonNullable<typeof ui> {
  if (ui) return ui;
  host = document.createElement('div');
  host.id = 'skincito-trade-assistant';
  const root = host.attachShadow({mode: 'closed'});
  const style = document.createElement('style'); style.textContent = STYLES;
  const card = document.createElement('div'); card.className = 'card';
  const logo = document.createElement('div'); logo.className = 'logo'; logo.textContent = 'S';
  const body = document.createElement('div'); body.className = 'body';
  const eyebrow = document.createElement('div'); eyebrow.className = 'eyebrow';
  const title = document.createElement('div'); title.className = 'title';
  const detail = document.createElement('div'); detail.className = 'detail';
  const button = document.createElement('button'); button.className = 'btn';
  const label = document.createElement('span'); label.textContent = 'Agregar item vendido'; button.append(label);
  body.append(eyebrow, title, detail); card.append(logo, body, button); root.append(style, card);
  // Igual que CSFloat: el panel va dentro del layout, justo antes del área de intercambio.
  const anchor = document.querySelector('div.trade_area');
  if (anchor?.parentElement) anchor.parentElement.insertBefore(host, anchor);
  else {host.classList.add('floating'); document.body.append(host)}
  return ui = {card, eyebrow, title, detail, button};
}
function render(view: View): void {
  const {card, eyebrow, title, detail, button} = mount();
  card.className = `card ${view.tone}`;
  eyebrow.textContent = view.tone === 'warning' ? 'Skincito · No envíes esta oferta' : 'Skincito · Venta detectada';
  title.textContent = view.title;
  detail.textContent = view.detail;
  button.hidden = !view.action;
}
function inspect(): void {
  if (!active) return;
  const sale = `Asset ID ${active.assetId} · Comprador ${active.buyerSteamId}`;
  if (g_steamID !== active.sellerSteamId || UserThem?.strSteamId !== active.buyerSteamId) {render({tone: 'warning', title: 'Cuenta o comprador Steam incorrecto', detail: `Esta venta es para la cuenta ${active.sellerSteamId} y el comprador ${active.buyerSteamId}.`}); return}
  if (active.blockingOffer) {render({tone: 'warning', title: 'Ya enviaste una oferta para esta venta', detail: `Oferta ${active.blockingOffer.id}. No envíes otra.`}); return}
  const assets = g_rgCurrentTradeStatus?.me?.assets ?? [];
  if (assets.some(a => a.assetid !== active!.assetId || a.appid !== 730 || String(a.contextid) !== '2') || (g_rgCurrentTradeStatus?.them?.assets?.length ?? 0) > 0) {
    render({tone: 'warning', title: 'La oferta contiene items ajenos a esta venta', detail: 'Quitá los otros items. Sólo podés enviar el item vendido y no pedir nada a cambio.'}); return;
  }
  if (notice) {render(notice); return}
  if (assets.length > 0) {render({tone: 'success', title: active.marketHashName, detail: `Item agregado. Revisá la oferta y enviala.
${sale}`}); return}
  render({tone: 'info', title: active.marketHashName, detail: `Usá el botón para agregar el item; el inventario está bloqueado.
${sale}`, action: true});
}
function enable(trade: ActiveTrade): void {
  active = trade;
  inspect();
  const inventory = document.getElementById('inventories');
  if (inventory) {inventory.style.pointerEvents = 'none'; inventory.style.opacity = '0.5'}
  mount().button.onclick = () => {
    notice = null;
    inspect();
    if (active?.blockingOffer) return;
    if (g_steamID !== trade.sellerSteamId || UserThem?.strSteamId !== trade.buyerSteamId) return;
    if ((g_rgCurrentTradeStatus?.me?.assets?.length ?? 0) > 0 || (g_rgCurrentTradeStatus?.them?.assets?.length ?? 0) > 0) return;
    const asset = UserYou?.findAsset?.(730, 2, trade.assetId)?.element;
    if (!asset) {try {ShowItemInventory(730, 2)} catch {} notice = {tone: 'warning', title: 'El item vendido ya no está en tu inventario', detail: `No encontramos el Asset ID ${trade.assetId}. No envíes otro item manualmente.`}; inspect(); return}
    MoveItemToTrade(asset);
    const note = document.getElementById('trade_offer_note') as HTMLTextAreaElement | null;
    if (note) note.value = `Skincito trade ${trade.id}`;
    setTimeout(inspect, 300);
  };
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
        receivedAssetIds: (raw.them?.assets ?? []).map(a => a.assetid),
        needsConfirmation: Boolean(request.responseJSON.needs_mobile_confirmation || request.responseJSON.needs_email_confirmation)};
      active = {...active, blockingOffer: {id: report.steamTradeOfferId, state: report.needsConfirmation ? 9 : 2}};
      inspect();
      window.postMessage({source: 'skincito-page', type: 'OFFER_CREATED', report} satisfies PageMessage, location.origin);
    } catch (error) {console.error('Skincito offer capture', error)}
  });
}
capture();
