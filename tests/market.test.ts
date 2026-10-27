import {describe, expect, it} from 'vitest';
import {assertUsdWallet, buyForm, interpretBuy, interpretSell, parseWalletInfo, sellForm} from '../src/steam/market';
import type {SaldoBuyRequest, SaldoSellRequest} from '../src/types';
const fields = (form: URLSearchParams) => {const out: Record<string, string> = {}; form.forEach((value, key) => {out[key] = value}); return out};

const sell: SaldoSellRequest = {id: 'l1', steamId: '76561198000000001', appId: 730, contextId: '2', assetId: '54087175594',
  marketHashName: 'Five-SeveN | Autumn Thicket (Field-Tested)', name: 'Five-SeveN | Autumn Thicket', priceMinor: 2000, buyerPaysMinor: 2300, currency: 'USD'};
const buy: SaldoBuyRequest = {id: 't1', sellerSteamId: '76561198000000002', appId: 730, marketHashName: sell.marketHashName, name: sell.name,
  wearRating: 0.0925, patternTemplate: 510, priceUsdMinor: 2000, sellerNetMinor: 3_277_500, reservedUntil: '2026-10-28T00:00:00Z',
  listingId: '6166200160038137363', currency: 2001, subtotal: 2000, fee: 300, total: 2300};

describe('billetera de Steam', () => {
  it('lee g_rgWalletInfo del market', () => {
    const html = `<script>var g_rgWalletInfo = {"wallet_currency":1,"wallet_country":"AR","wallet_balance":"12345","success":1};\nvar g_x = 1;</script>`;
    expect(parseWalletInfo(html)).toMatchObject({wallet_currency: 1, wallet_balance: '12345'});
    expect(parseWalletInfo('<html>sin sesión</html>')).toBeNull();
  });
  it('exige USD y, para comprar, saldo suficiente', () => {
    expect(() => assertUsdWallet({wallet_currency: 1, wallet_balance: '2300'}, 2300)).not.toThrow();
    expect(() => assertUsdWallet({wallet_currency: 1, wallet_balance: '2299'}, 2300)).toThrow(/US\$ 22.99/);
    expect(() => assertUsdWallet({wallet_currency: 34, wallet_balance: '999999'})).toThrow(/USD/);
    expect(() => assertUsdWallet(null)).toThrow(/billetera/);
  });
});

describe('formularios del market', () => {
  it('sellitem lleva el asset y lo que recibe el vendedor', () => {
    expect(fields(sellForm('sess', sell))).toEqual({sessionid: 'sess', appid: '730', contextid: '2', assetid: '54087175594', amount: '1', price: '2000'});
    expect(() => sellForm('sess', {...sell, priceMinor: 0})).toThrow();
  });
  it('buylisting lleva los montos exactos y la moneda de la billetera (USD), no el código del listing', () => {
    expect(fields(buyForm('sess', buy))).toEqual({sessionid: 'sess', currency: '1', subtotal: '2000', fee: '300', total: '2300',
      quantity: '1', billing_state: '', save_my_address: '0'});
    expect(() => buyForm('sess', {...buy, total: 2301})).toThrow(/no cierran/);
    expect(() => buyForm('sess', {...buy, currency: 2034})).toThrow(/dólares/);
  });
});

describe('respuestas del market', () => {
  it('publicar: éxito con confirmación en la app, o el mensaje de Steam', () => {
    expect(interpretSell(200, {success: true, requires_confirmation: 1, needs_mobile_confirmation: true})).toEqual({listed: true, needsConfirmation: true});
    expect(() => interpretSell(200, {success: false, message: 'You already have a listing for this item'})).toThrow(/already/);
    expect(() => interpretSell(502, null)).toThrow(/502/);
  });
  it('comprar: wallet_info con success 1, confirmación pendiente, o el mensaje de Steam', () => {
    expect(interpretBuy(200, {wallet_info: {success: 1, wallet_balance: '100'}})).toEqual({bought: true, needsConfirmation: false, walletBalanceMinor: 100});
    expect(interpretBuy(200, {need_confirmation: true})).toMatchObject({bought: true, needsConfirmation: true});
    expect(() => interpretBuy(502, {message: 'The listing may have been removed'})).toThrow(/removed/);
  });
});
