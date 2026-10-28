import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {OwnListing} from '../src/steam/market';

const own = vi.fn<() => Promise<OwnListing | null>>();
const confirm = vi.fn<(id: string, steamListingId?: string) => Promise<unknown>>();
vi.mock('../src/steam/market', () => ({getOwnListing: () => own()}));
vi.mock('../src/marketplace/client', () => ({
  confirmSaldoListing: (id: string, steamListingId?: string) => confirm(id, steamListingId),
  SkincitoAuthError: class SkincitoAuthError extends Error {},
}));
const {checkSell, watchSell} = await import('../src/background/sell-watch');
const {SkincitoAuthError} = await import('../src/marketplace/client');

/** chrome.storage y chrome.alarms en memoria. */
function fakeChrome() {
  const area = () => {
    const data: Record<string, unknown> = {};
    return {data, get: vi.fn(async (key: string) => ({[key]: data[key]})), set: vi.fn(async (items: Record<string, unknown>) => {Object.assign(data, items)})};
  };
  const alarms = new Map<string, unknown>();
  const chrome = {
    storage: {local: area(), session: area()},
    alarms: {get: vi.fn(async (name: string) => alarms.get(name)), create: vi.fn(async (name: string, info: unknown) => {alarms.set(name, info)}), clear: vi.fn(async (name: string) => alarms.delete(name))},
  };
  vi.stubGlobal('chrome', chrome);
  return {chrome, alarms};
}

const T0 = 1_000_000;
const watch = {saldoListingId: 'l1', appId: 730, assetId: '54242522916', startedAt: T0};

describe('seguimiento de la publicación hasta que se confirma', () => {
  beforeEach(() => {own.mockReset(); confirm.mockReset()});

  it('espera mientras falta confirmarla y, activa, avisa a Skincito con su ID y termina', async () => {
    const {alarms} = fakeChrome();
    await watchSell(watch);
    expect(alarms.has('saldo-sell-watch')).toBe(true);
    own.mockResolvedValueOnce({listingId: '1443024090348552503', state: 'TO_CONFIRM'});
    expect(await checkSell('l1', T0 + 5_000)).toEqual({state: 'WAITING', listing: 'TO_CONFIRM'});
    expect(confirm).not.toHaveBeenCalled();
    own.mockResolvedValueOnce({listingId: '1443024090348552503', state: 'ACTIVE'});
    confirm.mockResolvedValueOnce({});
    expect(await checkSell('l1', T0 + 30_000)).toEqual({state: 'CONFIRMED', steamListingId: '1443024090348552503', reported: true});
    expect(confirm).toHaveBeenCalledWith('l1', '1443024090348552503');
    expect(alarms.has('saldo-sell-watch')).toBe(false);
    // La ventana que pregunta después recibe cómo terminó, sin volver a avisar.
    expect(await checkSell('l1')).toMatchObject({state: 'CONFIRMED', reported: true});
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('recién publicada puede no figurar todavía; pasado el margen, se da por rechazada', async () => {
    fakeChrome();
    await watchSell(watch);
    own.mockResolvedValue(null);
    expect(await checkSell('l1', T0 + 30_000)).toEqual({state: 'WAITING', listing: null});
    expect(await checkSell('l1', T0 + 3 * 60_000)).toEqual({state: 'GONE'});
  });

  it('sin sesión de Skincito sigue intentando; otro error termina el seguimiento', async () => {
    fakeChrome();
    await watchSell(watch);
    own.mockResolvedValue({listingId: '111', state: 'ACTIVE'});
    confirm.mockRejectedValueOnce(new SkincitoAuthError(401));
    expect(await checkSell('l1', T0 + 30_000)).toMatchObject({state: 'CONFIRMED', reported: false});
    confirm.mockRejectedValueOnce(new Error('La publicación fue cancelada'));
    expect(await checkSell('l1', T0 + 60_000)).toMatchObject({state: 'CONFIRMED', reported: false, reportError: 'La publicación fue cancelada'});
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(await checkSell('l1', T0 + 90_000)).toMatchObject({reportError: 'La publicación fue cancelada'});
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('deja de seguirla después de un día', async () => {
    fakeChrome();
    await watchSell(watch);
    expect(await checkSell('l1', T0 + 25 * 60 * 60_000)).toEqual({state: 'EXPIRED'});
    expect(own).not.toHaveBeenCalled();
  });
});
