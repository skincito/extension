import type {OfferReport, SaldoBuyRequest, SaldoSellRequest} from './types';
import type {ApprovalView, WalletView} from './bridge/protocol';
import {OFFER_STATE_LABELS} from './marketplace/matching';
import {STEAM_USD, type SaldoBuyResult, type SaldoSellResult} from './steam/market';
// Ventana que abre la extensión cuando la web pide una entrega, una publicación o una compra en el market: el usuario
// aprueba o rechaza acá, fuera del alcance de la página.
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
const usd = (minor: number) => `US$ ${(minor / 100).toFixed(2)}`;
const ars = (minor: number) => new Intl.NumberFormat('es-AR', {style: 'currency', currency: 'ARS'}).format(minor / 100);
/** Filas con textContent (nunca HTML): los datos vienen de Steam y de Skincito. */
function rows(entries: [string, string, string?][]): void {
  $('rows').replaceChildren(...entries.map(([label, value, href]) => {
    const row = document.createElement('div'); row.className = 'row';
    const name = document.createElement('span'); name.textContent = label;
    const b = document.createElement('b');
    if (href) {const a = document.createElement('a'); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = value; b.append(a)} else b.textContent = value;
    row.append(name, b);
    return row;
  }));
}
function bullets(lines: string[]): void {$('bullets').replaceChildren(...lines.map(text => {const li = document.createElement('li'); li.textContent = text; return li}))}
function header(eyebrow: string, title: string, item: string, detail: string): void {
  $('eyebrow').textContent = eyebrow; $('title').textContent = title; $('item').textContent = item; $('asset').textContent = detail;
}
/** Lo que impide aprobar con esta billetera, o null. */
function walletProblem(wallet: WalletView | null, needMinor = 0): string | null {
  if (!wallet) return 'No pudimos leer tu billetera de Steam. Abrí steamcommunity.com/market con tu sesión y volvé a pedirlo.';
  if (wallet.currency !== STEAM_USD) return 'Tu billetera de Steam no está en dólares (USD): el mercado de saldo solo opera en USD.';
  if (wallet.balanceMinor < needMinor) return `Tu billetera tiene ${usd(wallet.balanceMinor)} y la compra es de ${usd(needMinor)}.`;
  return null;
}

let busyLabel = 'Enviando…';
let onSuccess: (result: unknown) => string = () => '';

function renderDelivery(view: Extract<ApprovalView, {kind: 'DELIVERY'}>): string | null {
  const {trade, steamId} = view;
  header('Pedido de entrega', '¿Enviar este item al comprador?', trade.marketHashName, `Asset ID ${trade.assetId}`);
  rows([['Desde tu cuenta', steamId], ['Para el comprador', trade.buyerSteamId, `https://steamcommunity.com/profiles/${trade.buyerSteamId}`], ['Pedís a cambio', 'Nada']]);
  bullets(['La oferta incluye sólo el item vendido.', 'Queda registrada en Skincito al crearse.', 'Steam puede pedirte confirmarla en la app móvil.']);
  onSuccess = result => {
    const report = result as OfferReport;
    return report.needsConfirmation
      ? `Oferta ${report.steamTradeOfferId} creada. Confirmala en la app móvil de Steam para que le llegue al comprador.`
      : `Oferta ${report.steamTradeOfferId} enviada. Le avisamos al comprador.`;
  };
  if (steamId !== trade.sellerSteamId) return `Estás en Steam con otra cuenta. Esta venta se envía desde ${trade.sellerSteamId}: iniciá sesión con esa cuenta y volvé a pedir la entrega.`;
  if (trade.blockingOffer) return `Ya hay una oferta ${OFFER_STATE_LABELS[trade.blockingOffer.state] ?? ''} (${trade.blockingOffer.id}) para esta venta. No envíes otra.`;
  return null;
}

function notReported(result: {reported: boolean; reportError?: string}, action: string): string {
  return result.reported ? '' : `\nNo pudimos avisarle a Skincito (${result.reportError ?? 'error'}): tocá "${action}" en la web.`;
}

function renderSell(view: {sell: SaldoSellRequest; steamId: string; wallet: WalletView | null}): string | null {
  const {sell, steamId, wallet} = view;
  header('Compra de saldo', '¿Publicar este skin en el market de Steam?', sell.name, `Asset ID ${sell.assetId}`);
  rows([['Desde tu cuenta', steamId], ['Recibís (You receive)', usd(sell.priceMinor)], ['El comprador paga (aprox.)', usd(sell.buyerPaysMinor)]]);
  bullets(['Se publica sólo este skin, a este precio.', 'Steam te va a pedir confirmar la publicación en la app móvil.', 'Después avisamos a Skincito para verificarla.']);
  busyLabel = 'Publicando…';
  onSuccess = result => {
    const r = result as SaldoSellResult & {reported: boolean; reportError?: string};
    return (r.needsConfirmation
      ? 'Publicado. Confirmá la publicación en la app móvil de Steam: la verificamos en unos minutos y te avisamos.'
      : 'Publicado. La verificamos en unos minutos y te avisamos.') + notReported(r, 'Ya lo publiqué');
  };
  if (steamId !== sell.steamId) return `Estás en Steam con otra cuenta. Esta oferta es de ${sell.steamId}: iniciá sesión con esa cuenta y volvé a pedirlo.`;
  return walletProblem(wallet);
}

function renderBuy(view: {buy: SaldoBuyRequest; steamId: string; wallet: WalletView | null}): string | null {
  const {buy, steamId, wallet} = view;
  const pattern = buy.patternTemplate === null ? '' : ` · Plantilla ${buy.patternTemplate}`;
  header('Venta de saldo', '¿Comprar esta publicación con tu billetera de Steam?', buy.name, `Float ${buy.wearRating.toFixed(6)}${pattern}`);
  rows([['Con tu cuenta', steamId], ['Pagás en Steam', `${usd(buy.total)} (${usd(buy.subtotal)} + ${usd(buy.fee)} de comisiones)`],
    ['Tu billetera', wallet ? usd(wallet.balanceMinor) : '—'], ['Cobrás en Skincito', ars(buy.sellerNetMinor)],
    ['Publicación', buy.listingId, `https://steamcommunity.com/market/listings/${buy.appId}/${encodeURIComponent(buy.marketHashName)}?detail=${buy.listingId}`]]);
  bullets(['Se compra sólo esta publicación, a este precio exacto: si cambió, Steam rechaza la compra.', 'La compra en Steam no se puede deshacer.', 'Después avisamos a Skincito para verificarla y acreditarte el cobro.']);
  busyLabel = 'Comprando…';
  onSuccess = result => {
    const r = result as SaldoBuyResult & {reported: boolean; reportError?: string};
    return (r.needsConfirmation
      ? 'Steam pide confirmar la compra en la app móvil. Confirmala: después la verificamos y te avisamos cuando cobres.'
      : 'Compraste la publicación. La verificamos en unos minutos y te avisamos cuando cobres.') + notReported(r, 'Ya la compré');
  };
  if (steamId !== buy.sellerSteamId) return `Estás en Steam con otra cuenta. Esta venta es de ${buy.sellerSteamId}: iniciá sesión con esa cuenta y volvé a pedirlo.`;
  return walletProblem(wallet, buy.total);
}

function render(view: ApprovalView): void {
  $('loading').hidden = true; $('request').hidden = false;
  try {$('origin').textContent = new URL(view.origin).host} catch {}
  const problem = view.kind === 'SALDO_SELL' ? renderSell(view) : view.kind === 'SALDO_BUY' ? renderBuy(view) : renderDelivery(view);
  if (problem) {notice('warning', problem); return}
  $<HTMLButtonElement>('approve').disabled = false;
}
$('approve').onclick = () => {void (async () => {
  const approve = $<HTMLButtonElement>('approve'), reject = $<HTMLButtonElement>('reject');
  approve.disabled = reject.disabled = true; approve.textContent = busyLabel; $('notice').textContent = '';
  try {
    notice('success', onSuccess(await send<unknown>({type: 'RESOLVE_APPROVAL', requestId, approved: true})));
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
