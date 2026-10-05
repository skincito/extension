export interface SteamSession {steamId: string; sessionId: string}
export async function getSteamSession(): Promise<SteamSession> {
  const response = await fetch('https://steamcommunity.com/', {credentials: 'include', headers: {Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9'}});
  if (!response.ok) throw new Error(`Steam respondió ${response.status}`);
  const html = await response.text();
  const steamId = /g_steamID\s*=\s*"(\d{17})"/.exec(html)?.[1];
  const sessionId = /g_sessionID\s*=\s*"([0-9a-fA-F]+)"/.exec(html)?.[1];
  if (!steamId || !sessionId) throw new Error('Iniciá sesión en Steam Community.');
  return {steamId, sessionId};
}
export function requireSeller(actual: string, expected: string): void {
  if (actual !== expected) throw new Error(`La cuenta Steam ${actual} no coincide con el vendedor ${expected}.`);
}
