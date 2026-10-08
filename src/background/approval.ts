import type {OfferReport} from '../types';

/**
 * Pedidos de entrega de la web esperando que el vendedor los apruebe, como las firmas de MetaMask: la web pide,
 * la extensión abre su propia ventana (que la página no puede falsificar ni cliquear) y recién al aprobar crea la oferta.
 * Viven en memoria: si el service worker se reinicia, la ventana avisa que el pedido venció y la web vuelve a pedirlo.
 */
interface Waiter {resolve(report: OfferReport): void; reject(error: Error): void}
interface Approval {tradeId: string; origin: string; windowId?: number; waiters: Waiter[]}
const approvals = new Map<string, Approval>();
const WIDTH = 380, HEIGHT = 600;

function byTrade(tradeId: string): [string, Approval] | undefined {return [...approvals].find(([, a]) => a.tradeId === tradeId)}

/** Abre la ventana de aprobación y resuelve con la oferta creada, o rechaza si el vendedor la cierra o rechaza. */
export async function requestApproval(tradeId: string, origin: string): Promise<OfferReport> {
  const existing = byTrade(tradeId);
  if (existing) {
    // Un segundo click en la web no abre otra ventana: trae al frente la que ya está esperando.
    if (existing[1].windowId !== undefined) await chrome.windows.update(existing[1].windowId, {focused: true}).catch(() => undefined);
    return new Promise((resolve, reject) => existing[1].waiters.push({resolve, reject}));
  }
  const requestId = crypto.randomUUID();
  const approval: Approval = {tradeId, origin, waiters: []};
  const result = new Promise<OfferReport>((resolve, reject) => approval.waiters.push({resolve, reject}));
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

export function getApproval(requestId: string): {tradeId: string; origin: string} {
  const approval = approvals.get(requestId);
  if (!approval) throw new Error('Este pedido de entrega venció. Volvé a Skincito y tocá "Entregar con la extensión" de nuevo.');
  return {tradeId: approval.tradeId, origin: approval.origin};
}

/** Aprobado: entrega y avisa a la web. Si la entrega falla, el pedido sigue abierto para reintentar o rechazar. */
export async function approve(requestId: string, deliver: (tradeId: string) => Promise<OfferReport>): Promise<OfferReport> {
  const {tradeId} = getApproval(requestId);
  const report = await deliver(tradeId);
  const approval = approvals.get(requestId);
  approvals.delete(requestId);
  approval?.waiters.forEach(w => w.resolve(report));
  return report;
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
  approval?.waiters.forEach(w => w.reject(new Error('Rechazaste la entrega en la extensión.')));
}

// Cerrar la ventana sin aprobar equivale a rechazar.
chrome.windows.onRemoved.addListener(windowId => {
  for (const [requestId, approval] of approvals) if (approval.windowId === windowId) settleRejected(requestId);
});
