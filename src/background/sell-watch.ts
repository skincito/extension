import {confirmSaldoListing, SkincitoAuthError} from '../marketplace/client';
import {fetchMyListings, findOwnListing, MY_LISTINGS_PAGE, SteamRateLimitedError, type MyListingsResponse, type OwnListing} from '../steam/market';

/**
 * Publicaciones del mercado de saldo que hizo la extensión y esperan la confirmación en la app de Steam o por mail.
 *
 * Un solo controlador decide cuándo se le pide a Steam (`/market/mylistings`, con la sesión del usuario), para que
 * el usuario no termine limitado por Steam: un pedido sirve para todas las publicaciones en espera, nunca hay dos a la
 * vez, el ritmo baja con el tiempo (CADENCE) y ante un 429 o una respuesta sin publicaciones se espera cada vez más
 * (BACKOFF_MS). La ventana y la alarma (cada 30 s) solo le preguntan al controlador: si no toca revisar, responde con
 * lo último que vio sin salir a Steam. Con la ventana abierta se llega al ritmo rápido; cerrada, la alarma no baja de
 * 30 s. Todo queda en storage para sobrevivir al reinicio del service worker y del navegador.
 *
 * Cuando la publicación aparece activa se avisa "Ya lo publiqué" a Skincito con su ID.
 */
export interface SellWatch {
  saldoListingId: string;
  appId: number;
  assetId: string;
  startedAt: number;
  /** Lo último que se vio en Steam: por confirmar, retenida, o null si no figuraba. */
  listing?: 'TO_CONFIRM' | 'ON_HOLD' | null;
  /** Revisiones seguidas en que no figuraba, pasado el margen de recién publicada. */
  missing?: number;
  /** Ya activa en Steam y falta avisarle a Skincito (no había sesión): se reintenta sin volver a Steam. */
  steamListingId?: string;
  reportError?: string;
}
export type SellWatchState =
  | {state: 'WAITING'; listing: 'TO_CONFIRM' | 'ON_HOLD' | null; notice?: string; retryAt?: number}
  | {state: 'CONFIRMED'; steamListingId: string; reported: boolean; reportError?: string}
  | {state: 'GONE'}
  | {state: 'EXPIRED'};
interface Poller {lastCheckAt: number; backoffUntil: number; backoffStep: number; notice: string | null}

const WATCHES = 'saldoSellWatches';
const POLLER = 'saldoSellPoller';
const DONE = 'saldoSellWatchesDone';
export const SELL_WATCH_ALARM = 'saldo-sell-watch';
/** Cada cuánto se revisa según el tiempo desde que se publicó: casi todos confirman en el primer o segundo minuto. */
export const CADENCE: readonly (readonly [until: number, every: number])[] = [
  [2 * 60_000, 5_000],
  [10 * 60_000, 20_000],
  [60 * 60_000, 60_000],
  [Infinity, 5 * 60_000],
];
/** Retenida (sin Steam Guard móvil Steam la retiene hasta 15 días): no hay apuro. */
const ON_HOLD_EVERY_MS = 30 * 60_000;
/** Esperas después de un 429 o de una respuesta sin publicaciones; un `Retry-After` más largo manda. */
export const BACKOFF_MS = [60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000];
/** Recién publicada, `mylistings` puede tardar en mostrarla: hasta entonces no se da por rechazada. */
const GRACE_MS = 2 * 60_000;
/** Revisiones seguidas sin encontrarla, pasado el margen, para darla por rechazada (una sola puede ser un hipo de Steam). */
const MISSING_TO_GONE = 2;
/** Steam vence las confirmaciones pendientes; pasado esto se deja de seguir. Retenida, hasta que la libere. */
const MAX_MS = 24 * 60 * 60_000;
const ON_HOLD_MAX_MS = 16 * 24 * 60 * 60_000;
/** Páginas de publicaciones activas que se recorren si no aparece en la primera (usuarios con más de 100). */
const MAX_PAGES = 5;

export function everyMs(watch: SellWatch, now: number): number {
  if (watch.listing === 'ON_HOLD') return ON_HOLD_EVERY_MS;
  const age = now - watch.startedAt;
  return CADENCE.find(([until]) => age < until)![1];
}

async function watches(): Promise<Record<string, SellWatch>> {
  return ((await chrome.storage.local.get(WATCHES))[WATCHES] as Record<string, SellWatch> | undefined) ?? {};
}
async function saveWatches(all: Record<string, SellWatch>): Promise<void> {
  await chrome.storage.local.set({[WATCHES]: all});
  if (!Object.keys(all).length) await chrome.alarms.clear(SELL_WATCH_ALARM);
}
async function poller(): Promise<Poller> {
  return ((await chrome.storage.local.get(POLLER))[POLLER] as Poller | undefined) ?? {lastCheckAt: 0, backoffUntil: 0, backoffStep: 0, notice: null};
}
async function savePoller(state: Poller): Promise<void> {
  await chrome.storage.local.set({[POLLER]: state});
}
/** Termina el seguimiento (ya sacado de `all`) y guarda cómo terminó, para la ventana que pregunte después. */
async function remember(saldoListingId: string, state: SellWatchState): Promise<void> {
  const done = ((await chrome.storage.session.get(DONE))[DONE] as Record<string, SellWatchState> | undefined) ?? {};
  await chrome.storage.session.set({[DONE]: {...done, [saldoListingId]: state}});
}

export async function watchSell(watch: SellWatch): Promise<void> {
  const all = await watches();
  all[watch.saldoListingId] = watch;
  await saveWatches(all);
  await ensureSellWatchAlarm();
}

export async function ensureSellWatchAlarm(): Promise<void> {
  if (!Object.keys(await watches()).length || await chrome.alarms.get(SELL_WATCH_ALARM)) return;
  await chrome.alarms.create(SELL_WATCH_ALARM, {periodInMinutes: 0.5, delayInMinutes: 0.5});
}

/** Las publicaciones propias: la primera página y, si alguna buscada no figura y hay más activas, las siguientes. */
async function readListings(pending: SellWatch[]): Promise<MyListingsResponse[]> {
  const first = await fetchMyListings(0);
  const pages = [first];
  const missing = () => pending.some(w => !findIn(pages, w));
  while (missing() && pages.length < MAX_PAGES && pages.length * MY_LISTINGS_PAGE < (first.total_count ?? 0)) {
    pages.push(await fetchMyListings(pages.length * MY_LISTINGS_PAGE));
  }
  return pages;
}
function findIn(pages: MyListingsResponse[], watch: SellWatch): OwnListing | null {
  for (const page of pages) {
    const own = findOwnListing(page, watch.appId, watch.assetId);
    if (own) return own;
  }
  return null;
}

/** Avisa a Skincito la publicación activa. Sin sesión de Skincito queda para reintentar; otro error termina. */
async function report(all: Record<string, SellWatch>, watch: SellWatch): Promise<void> {
  const steamListingId = watch.steamListingId!;
  try {
    await confirmSaldoListing(watch.saldoListingId, steamListingId);
    delete all[watch.saldoListingId];
    await remember(watch.saldoListingId, {state: 'CONFIRMED', steamListingId, reported: true});
  } catch (error) {
    watch.reportError = (error as Error).message;
    if (error instanceof SkincitoAuthError) return;
    delete all[watch.saldoListingId];
    await remember(watch.saldoListingId, {state: 'CONFIRMED', steamListingId, reported: false, reportError: watch.reportError});
  }
}

/** Una vuelta del controlador: si toca, una sola lectura de Steam para todas las publicaciones en espera. */
async function poll(now: number): Promise<void> {
  const all = await watches();
  for (const watch of Object.values(all)) {
    if (now - watch.startedAt <= (watch.listing === 'ON_HOLD' ? ON_HOLD_MAX_MS : MAX_MS)) continue;
    delete all[watch.saldoListingId];
    await remember(watch.saldoListingId, {state: 'EXPIRED'});
  }
  const list = Object.values(all);
  const state = await poller();
  const due = state.lastCheckAt + Math.min(...list.map(w => everyMs(w, now)));
  if (!list.length || now < state.backoffUntil || now < due) {
    await saveWatches(all);
    return;
  }
  const pending = list.filter(w => !w.steamListingId);
  if (pending.length) {
    let pages: MyListingsResponse[];
    try {
      pages = await readListings(pending);
    } catch (error) {
      const step = Math.min(state.backoffStep, BACKOFF_MS.length - 1);
      const wait = Math.max(BACKOFF_MS[step]!, error instanceof SteamRateLimitedError ? error.retryAfterMs ?? 0 : 0);
      await savePoller({lastCheckAt: now, backoffUntil: now + wait, backoffStep: step + 1, notice: (error as Error).message});
      await saveWatches(all);
      return;
    }
    for (const watch of pending) {
      const own = findIn(pages, watch);
      if (!own) {
        watch.listing = null;
        if (now - watch.startedAt <= GRACE_MS) continue;
        watch.missing = (watch.missing ?? 0) + 1;
        if (watch.missing >= MISSING_TO_GONE) {
          delete all[watch.saldoListingId];
          await remember(watch.saldoListingId, {state: 'GONE'});
        }
        continue;
      }
      watch.missing = 0;
      if (own.state === 'ACTIVE') watch.steamListingId = own.listingId;
      else watch.listing = own.state;
    }
  }
  await savePoller({lastCheckAt: now, backoffUntil: 0, backoffStep: 0, notice: null});
  for (const watch of Object.values(all)) if (watch.steamListingId) await report(all, watch);
  await saveWatches(all);
}

let running: Promise<void> | null = null;
/** Corre una vuelta, o se suma a la que está en curso: nunca hay dos lecturas de Steam a la vez. */
export function pollSells(now = Date.now()): Promise<void> {
  running ??= poll(now).finally(() => {running = null});
  return running;
}

/** Estado de una publicación para la ventana: le pregunta al controlador, que sale a Steam solo si toca. */
export async function checkSell(saldoListingId: string, now = Date.now()): Promise<SellWatchState> {
  await pollSells(now);
  const watch = (await watches())[saldoListingId];
  if (!watch) {
    const done = ((await chrome.storage.session.get(DONE))[DONE] as Record<string, SellWatchState> | undefined)?.[saldoListingId];
    if (done) return done;
    throw new Error('Esta publicación ya no está en seguimiento. Si la confirmaste, tocá "Ya lo publiqué" en Skincito.');
  }
  if (watch.steamListingId) return {state: 'CONFIRMED', steamListingId: watch.steamListingId, reported: false, reportError: watch.reportError};
  const state = await poller();
  const waiting: SellWatchState = {state: 'WAITING', listing: watch.listing ?? null};
  if (state.notice) waiting.notice = state.notice;
  if (state.backoffUntil > now) waiting.retryAt = state.backoffUntil;
  return waiting;
}

export async function checkAllSells(): Promise<void> {
  await pollSells().catch(error => console.error('saldo sell watch', error));
}
