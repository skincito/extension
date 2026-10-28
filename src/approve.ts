import type {OfferReport, SaldoBuyRequest, SaldoSellRequest} from './types';
import type {ApprovalView, WalletView} from './bridge/protocol';
import {OFFER_STATE_LABELS} from './marketplace/matching';
import {STEAM_USD, type SaldoBuyResult, type SaldoSellResult} from './steam/market';

type SellOutcome = SaldoSellResult & {steamListingId: string | null; reported: boolean; reportError?: string; watching: boolean};
// Ventana que abre la extensión cuando la web pide una entrega, una publicación o una compra en el market: el usuario
// aprueba o rechaza acá, fuera del alcance de la página. La publicación no se aprueba acá: la ventana publica sola y
// el usuario la confirma en la app de Steam o por mail.
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

let sellName = '';
function sellConfirmed(steamListingId: string, result: {reported: boolean; reportError?: string}): string {
  return `Publicación confirmada en Steam (${steamListingId}). Avisamos a Skincito: te avisamos cuando tu oferta quede activa.` + notReported(result, 'Ya lo publiqué');
}

function renderSell(view: {sell: SaldoSellRequest; steamId: string; wallet: WalletView | null}): string | null {
  const {sell, steamId, wallet} = view;
  header('Compra de saldo', 'Publicando tu skin en el market de Steam', sell.name, `Asset ID ${sell.assetId}`);
  rows([['Desde tu cuenta', steamId], ['Recibís (You receive)', usd(sell.priceMinor)], ['El comprador paga (aprox.)', usd(sell.buyerPaysMinor)]]);
  bullets(['Se publica sólo este skin, a este precio.', 'Steam te pide confirmar la publicación en la app móvil o por mail.', 'Cuando la confirmes, avisamos a Skincito para verificarla.']);
  busyLabel = 'Publicando…'; sellName = sell.name; sellId = sell.id;
  onSuccess = result => {
    const r = result as SellOutcome;
    return r.steamListingId ? sellConfirmed(r.steamListingId, r) : 'Publicada en Steam. Te avisamos cuando tu oferta quede activa.' + notReported(r, 'Ya lo publiqué');
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
  if (problem) {
    notice('warning', problem);
    if (view.kind === 'SALDO_SELL') {$('approve').hidden = true; $('reject').textContent = 'Cerrar'}
    return;
  }
  $<HTMLButtonElement>('approve').disabled = false;
  fit();
  // Publicar no necesita "Aprobar": la confirmación la da el usuario en la app de Steam o por mail.
  if (view.kind === 'SALDO_SELL') void run();
}
let poll: ReturnType<typeof setInterval> | undefined;
let sellId = '';
let checking = false;
type SellWatchState = {state: 'WAITING'; listing: 'TO_CONFIRM' | 'ON_HOLD' | null}
  | {state: 'CONFIRMED'; steamListingId: string; reported: boolean; reportError?: string} | {state: 'GONE'} | {state: 'EXPIRED'};
function waiting(title: string, text: string): void {
  $('waiting').hidden = false; $('waitingTitle').textContent = title; $('waitingText').textContent = text; fit();
}
/** Cierra la ventana a los pocos segundos, para que se alcance a leer el aviso: la cuenta va en "Cerrar". */
const CLOSE_AFTER_S = 4;
function closeSoon(): void {
  const close = $<HTMLButtonElement>('reject');
  let left = CLOSE_AFTER_S;
  const tick = () => {
    if (left <= 0) {window.close(); return}
    close.textContent = `Cerrar (${left})`; left--;
    setTimeout(tick, 1_000);
  };
  tick();
}
/** Confirmada y avisada a Skincito: no queda nada por hacer acá. Si el aviso falló, queda abierta con el error. */
function sellDone(steamListingId: string, result: {reported: boolean; reportError?: string}): void {
  notice('success', sellConfirmed(steamListingId, result)); finish();
  if (result.reported) closeSoon();
}
/** ¿Ya está confirmada la publicación? La ventana pregunta sola cada pocos segundos. */
async function checkSell(): Promise<void> {
  if (checking) return;
  checking = true;
  try {
    const check = await send<SellWatchState>({type: 'CHECK_SALDO_SELL', saldoListingId: sellId});
    if (check.state === 'CONFIRMED') {sellDone(check.steamListingId, check); return}
    if (check.state === 'GONE') {notice('error', 'La publicación ya no está en tu market de Steam: si la rechazaste, volvé a publicarla desde Skincito.'); finish(); return}
    if (check.state === 'EXPIRED') {notice('error', 'Pasó demasiado tiempo sin que la confirmes: revisá la publicación en Steam y tocá "Ya lo publiqué" en Skincito.'); finish(); return}
    if (check.listing === 'ON_HOLD') notice('warning', 'Steam retiene la publicación (en espera): cuando la libere, la detectamos.');
  } catch (e) {
    notice('error', (e as Error).message);
  } finally {
    checking = false;
  }
}
/** Publicada, falta la confirmación en la app o por mail: la extensión la sigue en segundo plano. */
function awaitSellConfirmation(): void {
  clearInterval(ping);
  // Lo que se iba a hacer ya pasó: queda la espera arriba, sin las aclaraciones previas.
  $('bullets').hidden = true; $('notice').textContent = '';
  $('title').textContent = 'Confirmá la publicación';
  waiting('Confirmala en la app de Steam o en tu mail', `Steam te pide confirmar la publicación de ${sellName}. La seguimos en segundo plano y avisamos a Skincito apenas la confirmes, aunque cierres esta ventana.`);
  // Se detecta sola apenas la confirmás: no hace falta un botón para revisar.
  $('approve').hidden = true;
  const close = $<HTMLButtonElement>('reject');
  close.textContent = 'Cerrar'; close.disabled = false;
  close.onclick = () => window.close();
  poll = setInterval(() => {void checkSell()}, 5_000);
}
/** Aprueba el pedido (o, al publicar, lo corre apenas abre la ventana). */
async function run(): Promise<void> {
  const approve = $<HTMLButtonElement>('approve'), reject = $<HTMLButtonElement>('reject');
  approve.disabled = reject.disabled = true; approve.textContent = busyLabel; $('notice').textContent = '';
  if (sellId) waiting('Publicando en Steam…', `Publicamos ${sellName} con lo que recibís en Steam.`);
  try {
    const result = await send<unknown>({type: 'RESOLVE_APPROVAL', requestId, approved: true});
    const sell = sellId ? result as SellOutcome : null;
    if (sell?.watching) {awaitSellConfirmation(); return}
    if (sell?.steamListingId) {sellDone(sell.steamListingId, sell); return}
    notice('success', onSuccess(result));
    finish();
  } catch (e) {
    $('waiting').hidden = true;
    notice('error', (e as Error).message);
    approve.disabled = reject.disabled = false; approve.textContent = 'Reintentar';
  }
}
$('approve').onclick = () => {void run()};
$('reject').onclick = () => {void send({type: 'RESOLVE_APPROVAL', requestId, approved: false}).finally(() => window.close())};
// Los eventos mantienen vivo el service worker de Chrome mientras la ventana está abierta.
const ping = setInterval(() => {void send({type: 'PING_APPROVAL', requestId}).catch(e => {notice('error', (e as Error).message); finish()})}, 20_000);
send<ApprovalView>({type: 'GET_APPROVAL', requestId}).then(render).catch(e => {$('loading').hidden = true; notice('error', (e as Error).message); finish()});
