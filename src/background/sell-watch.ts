import {confirmSaldoListing, SkincitoAuthError} from '../marketplace/client';
import {getOwnListing} from '../steam/market';

/**
 * Publicaciones del mercado de saldo que hizo la extensión y esperan la confirmación en la app de Steam o por mail.
 * Se siguen en segundo plano (alarma cada 30 s, guardadas en storage para sobrevivir al reinicio del service worker):
 * cuando la publicación aparece activa entre las propias, se avisa "Ya lo publiqué" a Skincito con su ID.
 */
export interface SellWatch {saldoListingId: string; appId: number; assetId: string; startedAt: number}
export type SellWatchState =
  | {state: 'WAITING'; listing: 'TO_CONFIRM' | 'ON_HOLD' | null}
  | {state: 'CONFIRMED'; steamListingId: string; reported: boolean; reportError?: string}
  | {state: 'GONE'}
  | {state: 'EXPIRED'};

const WATCHES = 'saldoSellWatches';
const DONE = 'saldoSellWatchesDone';
export const SELL_WATCH_ALARM = 'saldo-sell-watch';
/** Recién publicada, `mylistings` puede tardar en mostrarla: hasta entonces no se da por rechazada. */
const GRACE_MS = 2 * 60_000;
/** Steam vence las confirmaciones pendientes; pasado esto se deja de seguir. */
const MAX_MS = 24 * 60 * 60_000;

async function watches(): Promise<Record<string, SellWatch>> {
  return ((await chrome.storage.local.get(WATCHES))[WATCHES] as Record<string, SellWatch> | undefined) ?? {};
}
async function update(change: (all: Record<string, SellWatch>) => void): Promise<Record<string, SellWatch>> {
  const all = await watches();
  change(all);
  await chrome.storage.local.set({[WATCHES]: all});
  if (!Object.keys(all).length) await chrome.alarms.clear(SELL_WATCH_ALARM);
  return all;
}
/** Termina el seguimiento y guarda cómo terminó, para la ventana que pregunte después. */
async function finish(saldoListingId: string, state: SellWatchState): Promise<SellWatchState> {
  await update(all => {delete all[saldoListingId]});
  const done = ((await chrome.storage.session.get(DONE))[DONE] as Record<string, SellWatchState> | undefined) ?? {};
  await chrome.storage.session.set({[DONE]: {...done, [saldoListingId]: state}});
  return state;
}

export async function watchSell(watch: SellWatch): Promise<void> {
  await update(all => {all[watch.saldoListingId] = watch});
  await ensureSellWatchAlarm();
}

export async function ensureSellWatchAlarm(): Promise<void> {
  if (!Object.keys(await watches()).length || await chrome.alarms.get(SELL_WATCH_ALARM)) return;
  await chrome.alarms.create(SELL_WATCH_ALARM, {periodInMinutes: 0.5, delayInMinutes: 0.5});
}

/** ¿Ya está activa la publicación? Si lo está, avisa a Skincito y termina el seguimiento. */
export async function checkSell(saldoListingId: string, now = Date.now()): Promise<SellWatchState> {
  const watch = (await watches())[saldoListingId];
  if (!watch) {
    const done = ((await chrome.storage.session.get(DONE))[DONE] as Record<string, SellWatchState> | undefined)?.[saldoListingId];
    if (done) return done;
    throw new Error('Esta publicación ya no está en seguimiento. Si la confirmaste, tocá "Ya lo publiqué" en Skincito.');
  }
  if (now - watch.startedAt > MAX_MS) return finish(saldoListingId, {state: 'EXPIRED'});
  const own = await getOwnListing(watch.appId, watch.assetId);
  if (!own) return now - watch.startedAt > GRACE_MS ? finish(saldoListingId, {state: 'GONE'}) : {state: 'WAITING', listing: null};
  if (own.state !== 'ACTIVE') return {state: 'WAITING', listing: own.state};
  try {
    await confirmSaldoListing(saldoListingId, own.listingId);
    return finish(saldoListingId, {state: 'CONFIRMED', steamListingId: own.listingId, reported: true});
  } catch (error) {
    const result: SellWatchState = {state: 'CONFIRMED', steamListingId: own.listingId, reported: false, reportError: (error as Error).message};
    // Sin sesión de Skincito se reintenta en la próxima vuelta; otro error (p. ej. la oferta se canceló) no se arregla solo.
    return error instanceof SkincitoAuthError ? result : finish(saldoListingId, result);
  }
}

export async function checkAllSells(): Promise<void> {
  for (const id of Object.keys(await watches())) await checkSell(id).catch(error => console.error('saldo sell watch', id, error));
}
