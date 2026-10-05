import {config} from '../config';
import type {OfferReport, PendingTrade, ProofSubmission, StatusReport} from '../types';
/** Sin sesión de Skincito: la API responde 401/403 (DevAuthGuard usa 403). */
export class SkincitoAuthError extends Error {constructor(status: number) {super(`Iniciá sesión en Skincito (${status}).`)}}
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${config.apiBaseUrl.replace(/\/$/, '')}${path}`, {credentials: 'include', ...init, headers: {'Content-Type': 'application/json', ...init?.headers}});
  if (response.status === 401 || response.status === 403) throw new SkincitoAuthError(response.status);
  if (!response.ok) throw new Error(`Skincito respondió ${response.status}`);
  return response.json() as Promise<T>;
}
export async function getPendingTrades(): Promise<PendingTrade[]> {
  const result = await api<{trades: PendingTrade[]}>('/extension/trades/pending');
  return result.trades;
}
export function reportOffer(tradeId: string, report: OfferReport): Promise<{accepted: boolean}> {return api(`/extension/trades/${encodeURIComponent(tradeId)}/offer`, {method: 'POST', body: JSON.stringify(report)})}
export function reportStatus(tradeId: string, report: StatusReport): Promise<{accepted: boolean}> {return api(`/extension/trades/${encodeURIComponent(tradeId)}/steam-status`, {method: 'POST', body: JSON.stringify(report)})}
export function submitProof(tradeId: string, proof: ProofSubmission): Promise<{accepted: boolean}> {return api(`/extension/trades/${encodeURIComponent(tradeId)}/proof`, {method: 'POST', body: JSON.stringify(proof)})}
