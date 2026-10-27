import type {SaldoBuyRequest, SaldoSellRequest} from '../types';
import {getSteamSession, requireSeller} from './session';

/** Billetera de Steam tal como la expone el market en `g_rgWalletInfo` (montos en centavos, como texto). */
export interface WalletInfo {wallet_currency: number; wallet_balance?: string | number; wallet_delayed_balance?: string | number}
/** Código de USD en el market de Steam. El mercado de saldo solo opera en dólares. */
export const STEAM_USD = 1;

export function parseWalletInfo(html: string): WalletInfo | null {
  const raw = /g_rgWalletInfo\s*=\s*(\{.*?\});/s.exec(html)?.[1];
  if (!raw) return null;
  try {
    const wallet = JSON.parse(raw) as WalletInfo;
    return typeof wallet.wallet_currency === 'number' ? wallet : null;
  } catch {return null}
}

/** La billetera tiene que estar en USD (si no, Steam convierte los montos) y, para comprar, alcanzar. */
export function assertUsdWallet(wallet: WalletInfo | null, needMinor = 0): void {
  if (!wallet) throw new Error('No pudimos leer tu billetera de Steam. Abrí steamcommunity.com/market y volvé a intentar.');
  if (wallet.wallet_currency !== STEAM_USD) throw new Error('Tu billetera de Steam no está en dólares (USD): el mercado de saldo solo opera en USD.');
  const balance = Number(wallet.wallet_balance ?? 0);
  if (needMinor > 0 && !(balance >= needMinor)) throw new Error(`Tu billetera de Steam tiene US$ ${(balance / 100).toFixed(2)} y la compra es de US$ ${(needMinor / 100).toFixed(2)}.`);
}

export async function getWalletInfo(): Promise<WalletInfo | null> {
  const response = await fetch('https://steamcommunity.com/market/', {credentials: 'include', headers: {Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9'}});
  if (!response.ok) throw new Error(`Steam respondió ${response.status}`);
  return parseWalletInfo(await response.text());
}

/** `price` es lo que recibe el vendedor ("You receive"), en centavos de su billetera. */
export function sellForm(sessionId: string, request: SaldoSellRequest): URLSearchParams {
  if (!Number.isInteger(request.priceMinor) || request.priceMinor <= 0) throw new Error('Monto de la publicación inválido.');
  return new URLSearchParams({sessionid: sessionId, appid: String(request.appId), contextid: request.contextId, assetid: request.assetId, amount: '1', price: String(request.priceMinor)});
}

/** Los montos del listing verificado: si Steam ya no lo vende a ese precio, rechaza la compra. */
export function buyForm(sessionId: string, request: SaldoBuyRequest): URLSearchParams {
  if (request.currency !== STEAM_USD && request.currency !== 2000 + STEAM_USD) throw new Error('La publicación no está en dólares.');
  if (request.subtotal + request.fee !== request.total) throw new Error('Los montos de la publicación no cierran.');
  // `currency` es la de la billetera de quien compra (USD), no el código con offset del listing.
  return new URLSearchParams({sessionid: sessionId, currency: String(STEAM_USD), subtotal: String(request.subtotal), fee: String(request.fee),
    total: String(request.total), quantity: '1', billing_state: '', save_my_address: '0'});
}

export interface SellResponse {success?: boolean; message?: string; requires_confirmation?: number | boolean; needs_mobile_confirmation?: boolean; needs_email_confirmation?: boolean}
export interface BuyResponse {wallet_info?: {success?: number; wallet_balance?: string | number}; message?: string; need_confirmation?: boolean}
export interface SaldoSellResult {listed: true; needsConfirmation: boolean}
export interface SaldoBuyResult {bought: true; needsConfirmation: boolean; walletBalanceMinor: number | null}

export function interpretSell(status: number, body: SellResponse | null): SaldoSellResult {
  if (!body?.success) throw new Error(body?.message || `Steam respondió ${status} al publicar.`);
  return {listed: true, needsConfirmation: Boolean(body.requires_confirmation || body.needs_mobile_confirmation || body.needs_email_confirmation)};
}

/** Sin confirmar (sin verificar si Steam la pide para el market): la compra queda en la app y la API la verifica igual. */
export function interpretBuy(status: number, body: BuyResponse | null): SaldoBuyResult {
  if (body?.need_confirmation) return {bought: true, needsConfirmation: true, walletBalanceMinor: null};
  if (body?.wallet_info?.success !== 1) throw new Error(body?.message || `Steam respondió ${status} al comprar.`);
  const balance = Number(body.wallet_info.wallet_balance);
  return {bought: true, needsConfirmation: false, walletBalanceMinor: Number.isFinite(balance) ? balance : null};
}

const REFERER_RULE_ID = 2;
/**
 * Steam exige el Referer de su propia página para publicar y comprar. Strings en vez de los enums de
 * chrome.declarativeNetRequest, que Firefox no expone (ver create-offer.ts).
 */
async function withReferer<T>(url: string, referer: string, run: () => Promise<T>): Promise<T> {
  await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds: [REFERER_RULE_ID], addRules: [{id: REFERER_RULE_ID, priority: 1,
    action: {type: 'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType, requestHeaders: [{header: 'referer', operation: 'set' as chrome.declarativeNetRequest.HeaderOperation, value: referer}]},
    condition: {urlFilter: url, resourceTypes: ['xmlhttprequest' as chrome.declarativeNetRequest.ResourceType], initiatorDomains: [new URL(chrome.runtime.getURL('')).hostname]}}]});
  try {return await run()} finally {await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds: [REFERER_RULE_ID]})}
}

async function postForm<T>(url: string, referer: string, form: URLSearchParams): Promise<{status: number; body: T | null}> {
  return withReferer(url, referer, async () => {
    const response = await fetch(url, {method: 'POST', credentials: 'include', headers: {'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'}, body: form});
    return {status: response.status, body: await response.json().catch(() => null) as T | null};
  });
}

/** Publica el skin de la oferta de saldo en el market con lo que recibe el comprador de saldo. */
export async function sellSaldoItem(request: SaldoSellRequest): Promise<SaldoSellResult> {
  const session = await getSteamSession(); requireSeller(session.steamId, request.steamId);
  assertUsdWallet(await getWalletInfo());
  const {status, body} = await postForm<SellResponse>('https://steamcommunity.com/market/sellitem/', `https://steamcommunity.com/profiles/${session.steamId}/inventory/`, sellForm(session.sessionId, request));
  return interpretSell(status, body);
}

/** Compra exactamente el listing verificado de la operación, con la billetera de Steam. */
export async function buySaldoListing(request: SaldoBuyRequest): Promise<SaldoBuyResult> {
  const session = await getSteamSession(); requireSeller(session.steamId, request.sellerSteamId);
  assertUsdWallet(await getWalletInfo(), request.total);
  if (!/^\d+$/.test(request.listingId)) throw new Error('Publicación de Steam inválida.');
  const referer = `https://steamcommunity.com/market/listings/${request.appId}/${encodeURIComponent(request.marketHashName)}`;
  const {status, body} = await postForm<BuyResponse>(`https://steamcommunity.com/market/buylisting/${request.listingId}`, referer, buyForm(session.sessionId, request));
  return interpretBuy(status, body);
}
