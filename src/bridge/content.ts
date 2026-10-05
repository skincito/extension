import type {ActiveTrade} from '../types';
import type {PageMessage} from './protocol';
const send = <T>(message: unknown): Promise<T> => chrome.runtime.sendMessage(message).then((r: {ok: boolean; data?: T; error?: string}) => {if (!r.ok) throw new Error(r.error); return r.data as T});
async function init(): Promise<void> {
  const trades = await send<ActiveTrade[]>({type: 'GET_ACTIVE_TRADE'});
  const active = trades.find(t => {
    try {
      const a = new URL(t.buyerTradeUrl); const b = new URL(location.href);
      return a.origin === b.origin && a.pathname === b.pathname && a.searchParams.get('partner') === b.searchParams.get('partner') && a.searchParams.get('token') === b.searchParams.get('token');
    } catch {return false}
  }) ?? null;
  window.postMessage({source: 'skincito-content', type: 'ACTIVE_TRADE', trade: active} satisfies PageMessage, location.origin);
}
window.addEventListener('message', event => {
  if (event.source !== window || event.origin !== location.origin) return;
  const m = event.data as PageMessage;
  if (m?.source === 'skincito-page' && m.type === 'OFFER_CREATED') void send({type: 'PAGE_OFFER', report: m.report}).catch(console.error);
});
void init().catch(error => {console.error(error); window.postMessage({source: 'skincito-content', type: 'ACTIVE_TRADE', trade: null} satisfies PageMessage, location.origin)});
