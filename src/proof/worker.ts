import initWasm, {initialize, Prover, type IoChannel, type Reveal} from '@csfloat/tlsn-wasm';

class SocketChannel implements IoChannel {
  private queue: Uint8Array[] = [];
  private waiting: ((data: Uint8Array | null) => void)[] = [];
  private closed = false;
  private constructor(private socket: WebSocket) {
    socket.binaryType = 'arraybuffer';
    socket.onmessage = e => {const data = new Uint8Array(e.data as ArrayBuffer); const next = this.waiting.shift(); if (next) next(data); else this.queue.push(data)};
    socket.onclose = () => {this.closed = true; for (const next of this.waiting.splice(0)) next(null)};
  }
  static async connect(url: string): Promise<SocketChannel> {
    return new Promise((resolve, reject) => {const ws = new WebSocket(url); ws.onopen = () => resolve(new SocketChannel(ws)); ws.onerror = () => reject(new Error('No se pudo abrir canal TLSNotary.'))});
  }
  read(): Promise<Uint8Array | null> {const data = this.queue.shift(); if (data) return Promise.resolve(data); if (this.closed) return Promise.resolve(null); return new Promise(resolve => this.waiting.push(resolve))}
  async write(data: Uint8Array): Promise<void> {this.socket.send(data)}
  async close(): Promise<void> {this.socket.close()}
}
function wsUrl(url: string): string {return url.replace(/^https:/, 'wss:')}
async function session(url: string, maxRecvData: number, maxSentData: number): Promise<{socket: WebSocket; id: string; completion: Promise<string>}> {
  const socket = new WebSocket(wsUrl(url));
  await new Promise<void>((resolve, reject) => {socket.onopen = () => resolve(); socket.onerror = () => reject(new Error('No se pudo abrir sesión TLSNotary.'))});
  let registered!: (id: string) => void; let completed!: (proof: string) => void; let failed!: (error: Error) => void;
  const id = new Promise<string>(resolve => {registered = resolve});
  const completion = new Promise<string>((resolve, reject) => {completed = resolve; failed = reject});
  socket.onmessage = e => {const m = JSON.parse(String(e.data)) as {type: string; sessionId?: string; payload?: string; message?: string};
    if (m.type === 'session_registered' && m.sessionId) registered(m.sessionId);
    if (m.type === 'session_completed' && m.payload) completed(m.payload);
    if (m.type === 'error') failed(new Error(m.message || 'TLSNotary falló.'))};
  socket.send(JSON.stringify({type: 'register', maxRecvData, maxSentData}));
  return {socket, id: await Promise.race([id, new Promise<string>((_, reject) => setTimeout(() => reject(new Error('TLSNotary session timeout')), 10_000))]), completion};
}
async function prove(message: {url: string; token: string; sessionUrl: string; verifierUrl: string}): Promise<string> {
  // La wasm usa memoria compartida entre hilos; sin SharedArrayBuffer (página sin aislamiento cross-origin) no puede arrancar.
  if (typeof SharedArrayBuffer === 'undefined') throw new Error('El navegador no habilita SharedArrayBuffer en la extensión; TLSNotary no puede correr.');
  await initWasm();
  await initialize({level: 'Warn', crate_filters: [], span_events: undefined}, navigator.hardwareConcurrency || 4);
  const headers = new Map<string, number[]>([['Connection', [...new TextEncoder().encode('close')]], ['Host', [...new TextEncoder().encode('api.steampowered.com')]], ['Accept-Encoding', [...new TextEncoder().encode('gzip')]]]);
  const estimate = await fetch(message.url, {headers: {'Accept-Encoding': 'gzip'}});
  if (!estimate.ok) throw new Error(`Steam respondió ${estimate.status} al estimar la prueba.`);
  const body = await estimate.arrayBuffer();
  const maxRecvData = Math.max(50_000, body.byteLength * 4 + 16_384);
  const maxSentData = new TextEncoder().encode(message.url).length + 4096;
  const registration = await session(message.sessionUrl, maxRecvData, maxSentData);
  const verifier = await SocketChannel.connect(`${wsUrl(message.verifierUrl)}?sessionId=${encodeURIComponent(registration.id)}`);
  try {
    const prover = new Prover({server_name: 'api.steampowered.com', mode: 'Proxy', max_recv_data: maxRecvData, max_sent_data: maxSentData,
      max_sent_records: undefined, max_recv_data_online: undefined, max_recv_records_online: undefined,
      defer_decryption_from_start: true, network: 'Latency', client_auth: undefined, root_certs: undefined});
    await prover.setup(verifier);
    await prover.send_request(undefined, {uri: message.url, method: 'GET', headers, body: undefined});
    const transcript = await prover.transcript();
    const sent = new TextDecoder().decode(new Uint8Array(transcript.sent));
    const secret = message.token; const hidden: {start: number; end: number}[] = [];
    let index = 0; while ((index = sent.indexOf(secret, index)) >= 0) {hidden.push({start: index, end: index + secret.length}); index += secret.length}
    if (!hidden.length) throw new Error('El token no aparece en el transcript; no se enviará la prueba.');
    const ranges: {start: number; end: number}[] = []; let start = 0;
    for (const h of hidden) {if (h.start > start) ranges.push({start, end: h.start}); start = h.end}
    if (start < transcript.sent.length) ranges.push({start, end: transcript.sent.length});
    const reveal: Reveal = {sent: ranges, recv: [{start: 0, end: transcript.recv.length}], server_identity: true};
    await prover.reveal(reveal);
    return await registration.completion;
  } finally {verifier.close(); registration.socket.close()}
}
self.onmessage = (event: MessageEvent<{url: string; token: string; sessionUrl: string; verifierUrl: string}>) => {
  void prove(event.data).then(proof => self.postMessage({ok: true, proof})).catch(error => self.postMessage({ok: false, error: String(error)}));
};
