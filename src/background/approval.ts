/**
 * Pedidos de la web esperando que el usuario los apruebe, como las firmas de MetaMask: la web pide,
 * la extensión abre su propia ventana (que la página no puede falsificar ni cliquear) y recién al aprobar actúa en Steam.
 * Viven en memoria: si el service worker se reinicia, la ventana avisa que el pedido venció y la web vuelve a pedirlo.
 *
 * - DELIVERY: crear la oferta de intercambio de una venta (`subjectId` = orden).
 * - SALDO_SELL: publicar en el market el skin de una oferta de compra de saldo (`subjectId` = oferta).
 * - SALDO_BUY: comprar en el market el listing de una operación de venta de saldo (`subjectId` = operación).
 */
export type ApprovalKind = 'DELIVERY' | 'SALDO_SELL' | 'SALDO_BUY';
interface Waiter {resolve(result: unknown): void; reject(error: Error): void}
/**
 * Lo que devuelve una acción aprobada que todavía no terminó (p. ej. una publicación que falta confirmar en
 * la app de Steam): la ventana queda abierta esperando y, si el usuario la cierra, la web recibe `onClose`.
 */
export interface Awaiting {awaitingConfirmation: true; onClose: unknown}
interface Approval {kind: ApprovalKind; subjectId: string; origin: string; windowId?: number; waiters: Waiter[]; awaiting?: Awaiting}
const approvals = new Map<string, Approval>();
const WIDTH = 380, HEIGHT = 600;
const REJECTED: Record<ApprovalKind, string> = {
  DELIVERY: 'Rechazaste la entrega en la extensión.',
  SALDO_SELL: 'Rechazaste la publicación en la extensión.',
  SALDO_BUY: 'Rechazaste la compra en la extensión.',
};

function find(kind: ApprovalKind, subjectId: string): [string, Approval] | undefined {return [...approvals].find(([, a]) => a.kind === kind && a.subjectId === subjectId)}

/** Abre la ventana de aprobación y resuelve con el resultado, o rechaza si el usuario la cierra o rechaza. */
export async function requestApproval<T>(kind: ApprovalKind, subjectId: string, origin: string): Promise<T> {
  const existing = find(kind, subjectId);
  if (existing) {
    // Un segundo click en la web no abre otra ventana: trae al frente la que ya está esperando.
    if (existing[1].windowId !== undefined) await chrome.windows.update(existing[1].windowId, {focused: true}).catch(() => undefined);
    return new Promise<T>((resolve, reject) => existing[1].waiters.push({resolve: resolve as (result: unknown) => void, reject}));
  }
  const requestId = crypto.randomUUID();
  const approval: Approval = {kind, subjectId, origin, waiters: []};
  const result = new Promise<T>((resolve, reject) => approval.waiters.push({resolve: resolve as (result: unknown) => void, reject}));
  approvals.set(requestId, approval);
  try {
    // Arriba a la derecha de la ventana desde la que se pidió, donde queda el ícono de la extensión.
    const anchor = await chrome.windows.getLastFocused().catch(() => undefined);
    const position = anchor?.left !== undefined && anchor.width !== undefined && anchor.top !== undefined
      ? {left: Math.max(anchor.left, anchor.left + anchor.width - WIDTH - 16), top: anchor.top + 72} : {};
    const window = await chrome.windows.create({url: chrome.runtime.getURL(`approve.html#${requestId}`), type: 'popup', width: WIDTH, height: HEIGHT, focused: true, ...position});
    approval.windowId = window?.id;
  } catch (error) {
    approvals.delete(requestId);
    throw error;
  }
  return result;
}

export function getApproval(requestId: string): {kind: ApprovalKind; subjectId: string; origin: string} {
  const approval = approvals.get(requestId);
  if (!approval) throw new Error('Este pedido venció. Volvé a Skincito y tocá de nuevo el botón de la extensión.');
  return {kind: approval.kind, subjectId: approval.subjectId, origin: approval.origin};
}

const isAwaiting = (result: unknown): result is Awaiting => (result as Awaiting | null)?.awaitingConfirmation === true;

/**
 * Aprobado: actúa en Steam y avisa a la web. Si falla, el pedido sigue abierto para reintentar o rechazar.
 * Si la acción devuelve `Awaiting`, el pedido queda abierto hasta `complete`.
 */
export async function approve(requestId: string, run: (kind: ApprovalKind, subjectId: string) => Promise<unknown>): Promise<unknown> {
  const {kind, subjectId} = getApproval(requestId);
  const result = await run(kind, subjectId);
  const approval = approvals.get(requestId);
  if (isAwaiting(result) && approval) {approval.awaiting = result; return result}
  complete(requestId, result);
  return result;
}

export function isAwaitingConfirmation(requestId: string): boolean {return approvals.get(requestId)?.awaiting !== undefined}

/** Termina un pedido que esperaba (ver `Awaiting`) y le pasa el resultado a la web. */
export function complete(requestId: string, result: unknown): void {
  const approval = approvals.get(requestId);
  approvals.delete(requestId);
  approval?.waiters.forEach(w => w.resolve(result));
}

export async function reject(requestId: string): Promise<void> {
  const approval = approvals.get(requestId);
  if (!approval) return;
  settleRejected(requestId);
  if (approval.windowId !== undefined) await chrome.windows.remove(approval.windowId).catch(() => undefined);
}

function settleRejected(requestId: string): void {
  const approval = approvals.get(requestId);
  approvals.delete(requestId);
  // Ya se actuó en Steam: no es un rechazo, la web recibe lo que corresponde a cerrar antes de terminar.
  if (approval?.awaiting) approval.waiters.forEach(w => w.resolve(approval.awaiting!.onClose));
  else approval?.waiters.forEach(w => w.reject(new Error(REJECTED[approval.kind])));
}

// Cerrar la ventana sin aprobar equivale a rechazar.
chrome.windows.onRemoved.addListener(windowId => {
  for (const [requestId, approval] of approvals) if (approval.windowId === windowId) settleRejected(requestId);
});
