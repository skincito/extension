import type {WebBridgeMessage} from './protocol';
// Sólo se carga en el build de Firefox, en la web de Skincito. Firefox no implementa externally_connectable, así que la web
// manda los mismos mensajes SKINCITO_* por postMessage y este content script los pasa al fondo.
document.documentElement.dataset.skincitoExtension = chrome.runtime.getManifest().version;
window.addEventListener('message', event => {
  if (event.source !== window || event.origin !== location.origin) return;
  const m = event.data as WebBridgeMessage;
  if (m?.source !== 'skincito-web' || typeof m.id !== 'string' || !m.request) return;
  const reply = (response: unknown) => window.postMessage({source: 'skincito-extension', id: m.id, response} satisfies WebBridgeMessage, location.origin);
  chrome.runtime.sendMessage({type: 'WEB_REQUEST', request: m.request}).then(reply, error => reply({ok: false, error: String(error)}));
});
