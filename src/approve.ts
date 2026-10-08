import type {OfferReport} from './types';
import type {ApprovalView} from './bridge/protocol';
import {OFFER_STATE_LABELS} from './marketplace/matching';
// Ventana que abre la extensión cuando la web pide una entrega: el vendedor aprueba o rechaza acá, fuera del alcance de la página.
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const requestId = location.hash.slice(1);
async function send<T>(message: unknown): Promise<T> {
  const response = await chrome.runtime.sendMessage(message) as {ok: boolean; data?: T; error?: string};
  if (!response.ok) throw new Error((response.error ?? '').replace(/^Error: /, ''));
  return response.data as T;
}
function notice(tone: 'warning' | 'error' | 'success', text: string): void {const n = $('notice'); n.className = `notice ${tone}`; n.textContent = text}
/** Sin pedido que aprobar: sólo queda cerrar. */
function finish(): void {
  $('approve').hidden = true;
  const close = $<HTMLButtonElement>('reject'); close.textContent = 'Cerrar'; close.disabled = false;
  close.onclick = () => window.close();
  clearInterval(ping);
}
function render({trade, steamId, origin}: ApprovalView): void {
  $('loading').hidden = true; $('request').hidden = false;
  try {$('origin').textContent = new URL(origin).host} catch {}
  $('item').textContent = trade.marketHashName;
  $('asset').textContent = `Asset ID ${trade.assetId}`;
  $('seller').textContent = steamId;
  const buyer = $<HTMLAnchorElement>('buyer'); buyer.textContent = trade.buyerSteamId; buyer.href = `https://steamcommunity.com/profiles/${trade.buyerSteamId}`;
  if (steamId !== trade.sellerSteamId) {notice('warning', `Estás en Steam con otra cuenta. Esta venta se envía desde ${trade.sellerSteamId}: iniciá sesión con esa cuenta y volvé a pedir la entrega.`); return}
  if (trade.blockingOffer) {notice('warning', `Ya hay una oferta ${OFFER_STATE_LABELS[trade.blockingOffer.state] ?? ''} (${trade.blockingOffer.id}) para esta venta. No envíes otra.`); return}
  $<HTMLButtonElement>('approve').disabled = false;
}
$('approve').onclick = () => {void (async () => {
  const approve = $<HTMLButtonElement>('approve'), reject = $<HTMLButtonElement>('reject');
  approve.disabled = reject.disabled = true; approve.textContent = 'Enviando…'; $('notice').textContent = '';
  try {
    const report = await send<OfferReport>({type: 'RESOLVE_APPROVAL', requestId, approved: true});
    notice('success', report.needsConfirmation
      ? `Oferta ${report.steamTradeOfferId} creada. Confirmala en la app móvil de Steam para que le llegue al comprador.`
      : `Oferta ${report.steamTradeOfferId} enviada. Le avisamos al comprador.`);
    finish();
  } catch (e) {
    notice('error', (e as Error).message);
    approve.disabled = reject.disabled = false; approve.textContent = 'Reintentar';
  }
})()};
$('reject').onclick = () => {void send({type: 'RESOLVE_APPROVAL', requestId, approved: false}).finally(() => window.close())};
// Los eventos mantienen vivo el service worker de Chrome mientras la ventana está abierta.
const ping = setInterval(() => {void send({type: 'PING_APPROVAL', requestId}).catch(e => {notice('error', (e as Error).message); finish()})}, 20_000);
send<ApprovalView>({type: 'GET_APPROVAL', requestId}).then(render).catch(e => {$('loading').hidden = true; notice('error', (e as Error).message); finish()});
