import {runProofWorker, type ProveMessage} from './run-worker';
chrome.runtime.onMessage.addListener((message: Partial<ProveMessage> & {target?: string; type?: string}, _sender, sendResponse) => {
  if (message.target !== 'offscreen' || message.type !== 'PROVE') return;
  void runProofWorker(message as ProveMessage).then(sendResponse);
  return true;
});
