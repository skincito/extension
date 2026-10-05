import {getSteamSession, requireSeller} from './session';
interface CachedToken {token: string; steamId: string; updatedAt: number}
const KEY = 'steamAccessToken';
export async function getAccessToken(expectedSteamId: string): Promise<string> {
  const session = await getSteamSession();
  requireSeller(session.steamId, expectedSteamId);
  const cached = (await chrome.storage.local.get(KEY))[KEY] as CachedToken | undefined;
  if (cached?.steamId === expectedSteamId && Date.now() - cached.updatedAt < 30 * 60_000) return cached.token;
  const response = await fetch('https://steamcommunity.com/', {credentials: 'include', headers: {Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9;q=0.8'}});
  if (!response.ok) throw new Error(`Steam respondió ${response.status}`);
  const body = await response.text();
  const steamId = /g_steamID\s*=\s*"(\d{17})"/.exec(body)?.[1];
  requireSeller(steamId ?? '', expectedSteamId);
  const token = /data-loyalty_webapi_token="&quot;([a-zA-Z0-9_.-]+)&quot;"/.exec(body)?.[1];
  if (!token || !steamId) throw new Error('No se pudo obtener el access token de la sesión Steam.');
  await chrome.storage.local.set({[KEY]: {token, steamId, updatedAt: Date.now()} satisfies CachedToken});
  return token;
}
export async function clearAccessToken(): Promise<void> {await chrome.storage.local.remove(KEY)}
