import type {PendingTrade} from './types';
import {config} from './config';
const $ = (id: string) => document.getElementById(id)!;
async function send<T>(message: unknown): Promise<T> {
  const response = await chrome.runtime.sendMessage(message) as {ok: boolean; data?: T; error?: string};
  if (!response.ok) throw new Error(response.error);
  return response.data as T;
}
function error(e: unknown): void {$('error').textContent = (e instanceof Error ? e.message : String(e)).replace(/^Error: /, '')}
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.className = className; node.textContent = text; return node;
}
/** Pinta una fila de estado: verde si ok, rojo si no, y un link opcional para resolverlo. */
function setRow(id: string, ok: boolean, text: string, link?: {href: string; label: string}): void {
  const row = $(id); row.className = `row ${ok ? 'ok' : 'bad'}`;
  const span = row.querySelector('span')!; span.textContent = text;
  if (link) {const a = el('a', '', link.label); a.href = link.href; a.target = '_blank'; span.append(' · ', a)}
}
function renderTrades(trades: PendingTrade[]): void {
  $('trades').replaceChildren();
  if (trades.length === 0) {$('trades').append(el('div', 'empty', 'No tenés ventas pendientes de envío.')); return}
  for (const t of trades) {
    const card = el('article', 'trade');
    const open = el('button', 'primary', 'Abrir en Steam');
    open.onclick = () => {void send({type: 'OPEN_TRADE', tradeId: t.id}).catch(error)};
    // Envía una oferta real sin pasar por la página de Steam: sólo visible en modo desarrollador.
    const direct = el('button', 'secondary dev-only', 'Oferta directa');
    direct.onclick = () => {if (!confirm(`Crear oferta Steam del asset ${t.assetId} para ${t.buyerSteamId}?`)) return; void send({type: 'CREATE_OFFER', tradeId: t.id}).then(refresh).catch(error)};
    const actions = el('div', 'actions'); actions.append(open, direct);
    card.append(el('div', 'name', t.marketHashName), el('div', 'meta', `Asset ID ${t.assetId} · Comprador ${t.buyerSteamId}`), actions);
    $('trades').append(card);
  }
}
async function refresh(): Promise<void> {
  $('error').textContent = '';
  $('refresh').classList.add('spin');
  try {
    const data = await send<{steamId: string; hasAccessToken: boolean; skincitoSession: 'ok' | 'unauthenticated' | 'error'; trades: PendingTrade[]}>({type: 'GET_STATUS'});
    setRow('steam', true, `Cuenta ${data.steamId}`);
    if (data.skincitoSession === 'ok') setRow('skincito', true, 'Conectado');
    else if (data.skincitoSession === 'unauthenticated') setRow('skincito', false, 'Sin sesión', {href: config.websiteOrigin, label: 'Iniciar sesión'});
    else setRow('skincito', false, 'No responde');
    const demo = (await chrome.storage.local.get('demoOfferReport')).demoOfferReport as {steamTradeOfferId?: string} | undefined;
    $('devStatus').textContent = `Access token: ${data.hasAccessToken ? 'obtenido' : 'sin obtener'}${demo?.steamTradeOfferId ? ` · Oferta de prueba: ${demo.steamTradeOfferId}` : ''}`;
    renderTrades(data.trades);
  } catch (e) {
    error(e);
    setRow('steam', false, 'Sin sesión', {href: 'https://steamcommunity.com/login/home/', label: 'Iniciar sesión'});
    setRow('skincito', false, 'Sin comprobar');
    $('trades').replaceChildren(el('div', 'empty', 'Iniciá sesión en Steam Community para ver tus ventas.'));
  } finally {$('refresh').classList.remove('spin')}
}
const dev = $('dev') as HTMLDetailsElement;
dev.addEventListener('toggle', () => {document.body.classList.toggle('dev', dev.open); void chrome.storage.local.set({devMode: dev.open})});
void chrome.storage.local.get('devMode').then(({devMode}) => {dev.open = devMode === true});
$('save').addEventListener('click', () => {void (async () => {
  const t = JSON.parse(($('fixture') as HTMLTextAreaElement).value) as PendingTrade;
  if (!t.id || !/^\d{17}$/.test(t.sellerSteamId) || !/^\d{17}$/.test(t.buyerSteamId) || !/^\d+$/.test(t.assetId) || !t.acceptedAt || !t.buyerTradeUrl) throw new Error('Fixture incompleto.');
  await chrome.storage.local.set({demoPendingTrade: t}); await refresh();
})().catch(error)});
$('clear').addEventListener('click', () => {void chrome.storage.local.remove('demoPendingTrade').then(refresh).catch(error)});
$('refresh').addEventListener('click', () => {void refresh()});
void refresh();
