import fs from 'node:fs/promises';
import {build} from 'esbuild';

const config = JSON.parse(await fs.readFile('extension.config.json', 'utf8'));
// HTTP sólo se admite contra localhost, para probar con `npm run dev` de Skincito.
const isLocal = u => u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname);
for (const key of ['apiBaseUrl', 'websiteOrigin']) {
  const u = new URL(config[key]);
  if ((u.protocol !== 'https:' && !isLocal(u)) || u.username || u.password) throw new Error(`${key} debe ser HTTPS (o http://localhost)`);
}
const api = new URL(config.apiBaseUrl);
const web = new URL(config.websiteOrigin);
// La web puede redirigir entre skincito.com y www.skincito.com: aceptamos ambos orígenes.
const alternate = new URL(web.origin);
alternate.hostname = web.hostname.startsWith('www.') ? web.hostname.slice(4) : `www.${web.hostname}`;
config.websiteOrigins = isLocal(web) ? [web.origin] : [web.origin, alternate.origin];
// `--firefox` arma dist-firefox: página de fondo en vez de service worker, sin offscreen y con un
// content script en la web en lugar de externally_connectable (Firefox no deja que la página le hable a la extensión).
const firefox = process.argv.includes('--firefox');
const target = firefox ? 'firefox128' : 'chrome109';
const output = firefox ? 'dist-firefox' : 'dist';
await fs.rm(output, {recursive: true, force: true});
await fs.mkdir(output, {recursive: true});
const manifest = JSON.parse(await fs.readFile('manifest.json', 'utf8'));
manifest.host_permissions.push(`${api.origin}/*`);
manifest.externally_connectable.matches = config.websiteOrigins.map(origin => `${origin}/*`);
if (firefox) {
  manifest.background = {scripts: ['background.js']};
  manifest.permissions = manifest.permissions.filter(p => p !== 'offscreen');
  delete manifest.externally_connectable;
  delete manifest.minimum_chrome_version;
  manifest.content_scripts.push({matches: config.websiteOrigins.map(origin => `${origin}/*`), js: ['web-bridge.js'], run_at: 'document_start'});
  // 128: content scripts con world MAIN (page.js). Desde 127 los host_permissions se otorgan al instalar.
  manifest.browser_specific_settings = {gecko: {id: 'trade-assistant@skincito.com', strict_min_version: '128.0',
    data_collection_permissions: {required: ['websiteActivity', 'websiteContent']}}};
}
await fs.writeFile(`${output}/manifest.json`, JSON.stringify(manifest, null, 2));
await fs.copyFile('src/popup.html', `${output}/popup.html`);
if (!firefox) await fs.copyFile('src/offscreen.html', `${output}/offscreen.html`);
const define = {'__SKINCITO_CONFIG__': JSON.stringify(config)};
const entryPoints = {'background': 'src/background.ts', 'content': 'src/bridge/content.ts', 'page': 'src/bridge/page.ts', 'popup': 'src/popup.ts',
  ...(firefox ? {'web-bridge': 'src/bridge/web.ts'} : {'offscreen': 'src/proof/offscreen.ts'})};
await build({entryPoints, outdir: output, bundle: true, format: 'iife', target, define, logLevel: 'info'});
await fs.cp('node_modules/@csfloat/tlsn-wasm', `${output}/vendor/tlsn-wasm`, {recursive: true});
await build({entryPoints: {'notary-worker': 'src/proof/worker.ts'}, outdir: output, bundle: false, format: 'esm', target, logLevel: 'info'});
const worker = await fs.readFile(`${output}/notary-worker.js`, 'utf8');
await fs.writeFile(`${output}/notary-worker.js`, worker.replaceAll('"@csfloat/tlsn-wasm"', '"./vendor/tlsn-wasm/tlsn_wasm.js"'));
