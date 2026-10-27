import type {OfferReport, SaldoBuyRequest, SaldoSellRequest} from './types';
import type {ApprovalView, WalletView} from './bridge/protocol';
import {OFFER_STATE_LABELS} from './marketplace/matching';
import {STEAM_USD, type SaldoBuyResult, type SaldoSellResult} from './steam/market';

type SellOutcome = SaldoSellResult & {steamListingId: string | null; reported: boolean; reportError?: string};
type SellCheck = {confirmed: false; state: 'TO_CONFIRM' | 'ON_HOLD'} | {confirmed: true; result: SellOutcome};
// Ventana que abre la extensión cuando la web pide una entrega, una publicación o una compra en el market: el usuario
// aprueba o rechaza acá, fuera del alcance de la página.
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const requestId = location.hash.slice(1);
async function send<T>(message: unknown): Promise<T> {
  const response = await chrome.runtime.sendMessage(message) as {ok: boolean; data?: T; error?: string} | undefined;
  if (!response) throw new Error('La extensión no respondió. Recargala en la página de extensiones y volvé a pedirlo desde la web.');
  if (!response.ok) throw new Error((response.error ?? '').replace(/^Error: /, ''));
  return response.data as T;
}
function notice(tone: 'warning' | 'error' | 'success', text: string): void {const n = $('notice'); n.className = `notice ${tone}`; n.textContent = text; fit()}
/** Ajusta el alto de la ventana a su contenido, para que no haya que scrollear, y la sube si no entra en la pantalla. */
function fit(): void {requestAnimationFrame(() => {void (async () => {
  const win = await chrome.windows.getCurrent().catch(() => undefined);
  if (win?.id === undefined || win.top === undefined) return;
  const part = (tag: string) => document.querySelector(tag) as HTMLElement;
  const content = part('header').offsetHeight + part('main').scrollHeight + part('footer').offsetHeight;
  const frame = window.outerHeight - window.innerHeight;
  const availTop = (screen as Screen & {availTop?: number}).availTop ?? 0;
  const height = Math.min(content + frame, screen.availHeight);
  const top = Math.max(availTop, Math.min(win.top, availTop + screen.availHeight - height));
  if (height !== win.height || top !== win.top) await chrome.windows.update(win.id, {height, top}).catch(() => undefined);
})()})}
/** Sin pedido que aprobar: sólo queda cerrar. */
function finish(): void {
  $('waiting').hidden = true; clearInterval(poll);
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
  $('waitingText').textContent = `Abrí la app de Steam, entrá a Confirmaciones y aceptá la publicación de ${sell.name}. La detectamos sola; si ya la aceptaste, tocá "Ya la aprobé".`;
  onSuccess = result => {
    const r = result as SellOutcome;
    return `Publicación confirmada en Steam${r.steamListingId ? ` (${r.steamListingId})` : ''}. La verificamos y te avisamos cuando tu oferta quede activa.` + notReported(r, 'Ya lo publiqué');
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
  fit();
}
let poll: ReturnType<typeof setInterval> | undefined;
let checking = false;
/** ¿Ya está activa la publicación? `manual`: lo pidió el usuario con "Ya la aprobé" y espera respuesta. */
async function checkSell(manual: boolean): Promise<void> {
  if (checking) return;
  checking = true;
  const approve = $<HTMLButtonElement>('approve');
  if (manual) {approve.disabled = true; approve.textContent = 'Revisando…'}
  try {
    const check = await send<SellCheck>({type: 'CHECK_SALDO_SELL', requestId});
    if (check.confirmed) {notice('success', onSuccess(check.result)); finish(); return}
    if (check.state === 'ON_HOLD') notice('warning', 'Steam retiene la publicación (en espera): cuando la libere, la detectamos.');
    else if (manual) notice('warning', 'Steam todavía no la muestra confirmada. Aceptala en la app y volvé a tocar "Ya la aprobé".');
  } catch (e) {
    notice('error', (e as Error).message);
  } finally {
    checking = false;
    if (manual && !approve.hidden) {approve.disabled = false; approve.textContent = 'Ya la aprobé'}
  }
}
/** Publicado en Steam, falta la confirmación en la app: círculo de carga, "Ya la aprobé" y chequeo periódico. */
function awaitSellConfirmation(): void {
  // Lo que se iba a hacer ya pasó: queda la espera arriba, sin las aclaraciones previas.
  $('waiting').hidden = false; $('bullets').hidden = true; $('notice').textContent = ''; fit();
  const approve = $<HTMLButtonElement>('approve'), close = $<HTMLButtonElement>('reject');
  approve.textContent = 'Ya la aprobé'; approve.disabled = false;
  approve.onclick = () => {void checkSell(true)};
  // Ya se publicó: cerrar no la cancela, la web pide tocar "Ya lo publiqué".
  close.textContent = 'Cerrar'; close.disabled = false;
  close.onclick = () => window.close();
  poll = setInterval(() => {void checkSell(false)}, 4_000);
}
$('approve').onclick = () => {void (async () => {
  const approve = $<HTMLButtonElement>('approve'), reject = $<HTMLButtonElement>('reject');
  approve.disabled = reject.disabled = true; approve.textContent = busyLabel; $('notice').textContent = '';
  try {
    const result = await send<unknown>({type: 'RESOLVE_APPROVAL', requestId, approved: true});
    if ((result as {awaitingConfirmation?: boolean} | null)?.awaitingConfirmation) {awaitSellConfirmation(); return}
    notice('success', onSuccess(result));
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
