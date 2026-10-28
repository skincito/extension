import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {MyListingsResponse} from '../src/steam/market';

const fetchMyListings = vi.fn<(start?: number) => Promise<MyListingsResponse>>();
const confirm = vi.fn<(id: string, steamListingId?: string) => Promise<unknown>>();
vi.mock('../src/steam/market', async importActual => ({
  ...await importActual<typeof import('../src/steam/market')>(),
  fetchMyListings: (start?: number) => fetchMyListings(start),
}));
vi.mock('../src/marketplace/client', () => ({
  confirmSaldoListing: (id: string, steamListingId?: string) => confirm(id, steamListingId),
  SkincitoAuthError: class SkincitoAuthError extends Error {},
}));
const {checkSell, everyMs, pollSells, watchSell} = await import('../src/background/sell-watch');
const {SkincitoAuthError} = await import('../src/marketplace/client');
const {SteamListingsUnreadableError, SteamRateLimitedError} = await import('../src/steam/market');

/** chrome.storage y chrome.alarms en memoria. */
function fakeChrome() {
  const area = () => {
    const data: Record<string, unknown> = {};
    return {data, get: vi.fn(async (key: string) => ({[key]: structuredClone(data[key])})), set: vi.fn(async (items: Record<string, unknown>) => {Object.assign(data, structuredClone(items))})};
  };
  const alarms = new Map<string, unknown>();
  vi.stubGlobal('chrome', {
    storage: {local: area(), session: area()},
    alarms: {get: vi.fn(async (name: string) => alarms.get(name)), create: vi.fn(async (name: string, info: unknown) => {alarms.set(name, info)}), clear: vi.fn(async (name: string) => alarms.delete(name))},
  });
  return {alarms};
}

const T0 = 1_000_000_000;
const ASSET = '54242522916';
const watch = (id = 'l1', assetId = ASSET) => ({saldoListingId: id, appId: 730, assetId, startedAt: T0});
const mine = (listingid: string, assetId = ASSET) => ({listingid, asset: {id: assetId, appid: 730}});
const page = (lists: Partial<MyListingsResponse> = {}): MyListingsResponse => ({success: true, listings: [], listings_to_confirm: [], listings_on_hold: [], ...lists});

describe('controlador de la espera de la confirmación', () => {
  beforeEach(() => {fetchMyListings.mockReset(); confirm.mockReset(); fakeChrome()});

  it('baja el ritmo con el tiempo: 5 s, 20 s, 1 min, 5 min; retenida, cada 30 min', () => {
    expect(everyMs(watch(), T0 + 60_000)).toBe(5_000);
    expect(everyMs(watch(), T0 + 5 * 60_000)).toBe(20_000);
    expect(everyMs(watch(), T0 + 30 * 60_000)).toBe(60_000);
    expect(everyMs(watch(), T0 + 3 * 60 * 60_000)).toBe(5 * 60_000);
    expect(everyMs({...watch(), listing: 'ON_HOLD'}, T0 + 60_000)).toBe(30 * 60_000);
  });

  it('la ventana puede preguntar seguido: a Steam se le pide solo cuando toca', async () => {
    await watchSell(watch());
    fetchMyListings.mockResolvedValue(page({listings_to_confirm: [mine('111')]}));
    for (let t = 0; t <= 12_000; t += 2_000) expect(await checkSell('l1', T0 + t)).toEqual({state: 'WAITING', listing: 'TO_CONFIRM'});
    // Preguntando cada 2 s, a Steam a los 0, 6 y 12 s (cada 5 s como mínimo), no en cada pregunta.
    expect(fetchMyListings).toHaveBeenCalledTimes(3);
  });

  it('dos preguntas a la vez comparten una sola lectura de Steam', async () => {
    await watchSell(watch());
    fetchMyListings.mockResolvedValue(page({listings_to_confirm: [mine('111')]}));
    await Promise.all([pollSells(T0), pollSells(T0), checkSell('l1', T0)]);
    expect(fetchMyListings).toHaveBeenCalledTimes(1);
  });

  it('una lectura sirve para todas las publicaciones en espera', async () => {
    await watchSell(watch('l1'));
    await watchSell(watch('l2', '999'));
    fetchMyListings.mockResolvedValue(page({listings: [mine('111')], listings_to_confirm: [mine('222', '999')]}));
    confirm.mockResolvedValue({});
    expect(await checkSell('l1', T0)).toMatchObject({state: 'CONFIRMED', steamListingId: '111', reported: true});
    expect(await checkSell('l2', T0)).toEqual({state: 'WAITING', listing: 'TO_CONFIRM'});
    expect(fetchMyListings).toHaveBeenCalledTimes(1);
  });

  it('activa: avisa a Skincito con su ID una sola vez y deja de seguirla', async () => {
    const {alarms} = fakeChrome();
    await watchSell(watch());
    expect(alarms.has('saldo-sell-watch')).toBe(true);
    fetchMyListings.mockResolvedValue(page({listings: [mine('1443024090348552503')]}));
    confirm.mockResolvedValue({});
    expect(await checkSell('l1', T0)).toEqual({state: 'CONFIRMED', steamListingId: '1443024090348552503', reported: true});
    expect(confirm).toHaveBeenCalledWith('l1', '1443024090348552503');
    expect(alarms.has('saldo-sell-watch')).toBe(false);
    expect(await checkSell('l1', T0 + 60_000)).toMatchObject({state: 'CONFIRMED', reported: true});
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('ante un 429 espera cada vez más (o lo que pide Steam) y lo avisa', async () => {
    await watchSell(watch());
    fetchMyListings.mockRejectedValueOnce(new SteamRateLimitedError(null));
    expect(await checkSell('l1', T0)).toMatchObject({state: 'WAITING', retryAt: T0 + 60_000, notice: expect.stringMatching(/esperar/)});
    // Durante la espera no se vuelve a Steam, aunque la ventana pregunte.
    await checkSell('l1', T0 + 30_000);
    expect(fetchMyListings).toHaveBeenCalledTimes(1);
    fetchMyListings.mockRejectedValueOnce(new SteamRateLimitedError(5 * 60_000));
    expect(await checkSell('l1', T0 + 61_000)).toMatchObject({retryAt: T0 + 61_000 + 5 * 60_000});
    fetchMyListings.mockRejectedValueOnce(new SteamRateLimitedError(null));
    expect(await checkSell('l1', T0 + 61_000 + 5 * 60_000)).toMatchObject({retryAt: T0 + 61_000 + 10 * 60_000});
    // Al volver a leer bien, recupera el ritmo y se va el aviso.
    fetchMyListings.mockResolvedValueOnce(page({listings_to_confirm: [mine('111')]}));
    expect(await checkSell('l1', T0 + 61_000 + 10 * 60_000)).toEqual({state: 'WAITING', listing: 'TO_CONFIRM'});
  });

  it('sin sesión de Steam no la da por rechazada: avisa y espera', async () => {
    await watchSell(watch());
    fetchMyListings.mockRejectedValue(new SteamListingsUnreadableError());
    for (const t of [0, 3 * 60_000, 6 * 60_000, 12 * 60_000]) {
      expect(await checkSell('l1', T0 + t)).toMatchObject({state: 'WAITING', notice: expect.stringMatching(/sesión iniciada/)});
    }
  });

  it('recién publicada puede no figurar; pasado el margen y dos revisiones sin ella, se da por rechazada', async () => {
    await watchSell(watch());
    fetchMyListings.mockResolvedValue(page());
    expect(await checkSell('l1', T0)).toEqual({state: 'WAITING', listing: null});
    expect(await checkSell('l1', T0 + 2 * 60_000 + 5_000)).toEqual({state: 'WAITING', listing: null});
    expect(await checkSell('l1', T0 + 2 * 60_000 + 30_000)).toEqual({state: 'GONE'});
  });

  it('si no está en la primera página y hay más de 100 activas, mira las siguientes', async () => {
    await watchSell(watch());
    fetchMyListings.mockImplementation(async start => start ? page({listings: [mine('333')]}) : page({total_count: 150, listings: [mine('1', '1')]}));
    confirm.mockResolvedValue({});
    expect(await checkSell('l1', T0)).toMatchObject({state: 'CONFIRMED', steamListingId: '333'});
    expect(fetchMyListings.mock.calls.map(([start]) => start)).toEqual([0, 100]);
  });

  it('retenida: la sigue cada 30 min y hasta 16 días', async () => {
    await watchSell(watch());
    fetchMyListings.mockResolvedValue(page({listings_on_hold: [mine('111')]}));
    expect(await checkSell('l1', T0)).toEqual({state: 'WAITING', listing: 'ON_HOLD'});
    await checkSell('l1', T0 + 10 * 60_000);
    expect(fetchMyListings).toHaveBeenCalledTimes(1);
    expect(await checkSell('l1', T0 + 3 * 24 * 60 * 60_000)).toEqual({state: 'WAITING', listing: 'ON_HOLD'});
    expect(await checkSell('l1', T0 + 17 * 24 * 60 * 60_000)).toEqual({state: 'EXPIRED'});
  });

  it('sin confirmar, deja de seguirla después de un día', async () => {
    await watchSell(watch());
    expect(await checkSell('l1', T0 + 25 * 60 * 60_000)).toEqual({state: 'EXPIRED'});
    expect(fetchMyListings).not.toHaveBeenCalled();
  });

  it('sin sesión de Skincito reintenta el aviso sin volver a Steam; otro error termina', async () => {
    await watchSell(watch());
    fetchMyListings.mockResolvedValue(page({listings: [mine('111')]}));
    confirm.mockRejectedValueOnce(new SkincitoAuthError(401));
    expect(await checkSell('l1', T0)).toMatchObject({state: 'CONFIRMED', reported: false});
    confirm.mockRejectedValueOnce(new Error('La publicación fue cancelada'));
    expect(await checkSell('l1', T0 + 5_000)).toMatchObject({state: 'CONFIRMED', reported: false, reportError: 'La publicación fue cancelada'});
    expect(fetchMyListings).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledTimes(2);
    await checkSell('l1', T0 + 60_000);
    expect(confirm).toHaveBeenCalledTimes(2);
  });
});
