import type {PendingTrade} from './types';
const $ = (id: string) => document.getElementById(id)!;
async function send<T>(message: unknown): Promise<T> {
  const response = await chrome.runtime.sendMessage(message) as {ok: boolean; data?: T; error?: string};
  if (!response.ok) throw new Error(response.error);
  return response.data as T;
}
function error(e: unknown): void {$('error').textContent = String(e)}
async function refresh(): Promise<void> {
  $('error').textContent = '';
  try {
    const data = await send<{steamId: string; hasAccessToken: boolean; trades: PendingTrade[]}>({type: 'GET_STATUS'});
    $('status').textContent = `SteamID: ${data.steamId} · Access token: ${data.hasAccessToken ? 'obtenido' : 'sin obtener'}`;
    const demo = (await chrome.storage.local.get('demoOfferReport')).demoOfferReport as {steamTradeOfferId?: string} | undefined;
    if (demo?.steamTradeOfferId) $('status').textContent += ` · Oferta de prueba: ${demo.steamTradeOfferId}`;
    $('trades').replaceChildren();
    for (const t of data.trades) {
      const article = document.createElement('article');
      const label = document.createElement('div'); label.textContent = `${t.marketHashName} · Asset ${t.assetId} · Comprador ${t.buyerSteamId}`;
      const open = document.createElement('button'); open.textContent = 'Abrir Steam';
      open.onclick = () => {void send({type: 'OPEN_TRADE', tradeId: t.id}).catch(error)};
      const direct = document.createElement('button'); direct.textContent = 'Crear oferta directa';
      direct.onclick = () => {if (!confirm(`Crear oferta Steam del asset ${t.assetId} para ${t.buyerSteamId}?`)) return; void send({type: 'CREATE_OFFER', tradeId: t.id}).then(refresh).catch(error)};
      article.append(label, open, direct); $('trades').append(article);
    }
  } catch (e) {error(e); $('status').textContent = 'No se pudo comprobar Steam.'}
}
$('save').addEventListener('click', () => {void (async () => {
  const t = JSON.parse(($('fixture') as HTMLTextAreaElement).value) as PendingTrade;
  if (!t.id || !/^\d{17}$/.test(t.sellerSteamId) || !/^\d{17}$/.test(t.buyerSteamId) || !/^\d+$/.test(t.assetId) || !t.acceptedAt || !t.buyerTradeUrl) throw new Error('Fixture incompleto.');
  await chrome.storage.local.set({demoPendingTrade: t}); await refresh();
})().catch(error)});
$('clear').addEventListener('click', () => {void chrome.storage.local.remove('demoPendingTrade').then(refresh).catch(error)});
$('refresh').addEventListener('click', () => {void refresh()});
void refresh();
