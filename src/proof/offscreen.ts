chrome.runtime.onMessage.addListener((message: {target?: string; type?: string; url?: string; token?: string; ticket?: string; sessionUrl?: string; verifierUrl?: string}, _sender, sendResponse) => {
  if (message.target !== 'offscreen' || message.type !== 'PROVE') return;
  const worker = new Worker(chrome.runtime.getURL('notary-worker.js'), {type: 'module'});
  const timer = setTimeout(() => {worker.terminate(); sendResponse({ok: false, error: 'TLSNotary agotó el tiempo de espera.'})}, 120_000);
  worker.onmessage = event => {clearTimeout(timer); worker.terminate(); sendResponse(event.data)};
  worker.onerror = event => {clearTimeout(timer); worker.terminate(); sendResponse({ok: false, error: event.message})};
  worker.postMessage(message);
  return true;
});
