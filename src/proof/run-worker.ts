export type ProveMessage = {url: string; token: string; sessionUrl: string; verifierUrl: string};
export type ProveResult = {ok: boolean; proof?: string; error?: string};
/** Corre la prueba en notary-worker.js. En Chrome se llama desde el documento offscreen; en Firefox, desde la página de fondo. */
export function runProofWorker(message: ProveMessage): Promise<ProveResult> {
  return new Promise(resolve => {
    const worker = new Worker(chrome.runtime.getURL('notary-worker.js'), {type: 'module'});
    const timer = setTimeout(() => {worker.terminate(); resolve({ok: false, error: 'TLSNotary agotó el tiempo de espera.'})}, 120_000);
    worker.onmessage = event => {clearTimeout(timer); worker.terminate(); resolve(event.data)};
    worker.onerror = event => {clearTimeout(timer); worker.terminate(); resolve({ok: false, error: event.message})};
    worker.postMessage(message);
  });
}
