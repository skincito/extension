# Skincito Trade Assistant

Extensión Chrome Manifest V3 para ayudar a vendedores a enviar el asset CS2 exacto al comprador indicado y recopilar evidencia de Steam. El backend toma todas las decisiones de verificación.

## Construcción

Requisitos: Node.js 20+ y Chrome 109+. Editá `extension.config.json` con el origen de tu web, URL base del API y, para pruebas TLSNotary, URLs del servicio notarial. El origen de la web y del API se incorporan al manifest durante el build.

```bash
npm install
npm run build
```

Abrí `chrome://extensions`, activá **Developer mode**, elegí **Load unpacked** y seleccioná la carpeta `dist` de este proyecto. Después de cambiar la configuración, corré `npm run build` y recargá la extensión.

`npm run typecheck` y `npm test` verifican tipos y reglas de matching.

### Integración con Skincito

La API (`/api/extension/trades/*`) y el asistente de la web están en el repo `fedebogovic/skincito` (ver `docs/extension-integration.md` allí). Para que la web encuentre la extensión, copiá el ID que muestra `chrome://extensions` en `NEXT_PUBLIC_SKINCITO_EXTENSION_ID` de la web. Ese ID cambia entre instalaciones sin empaquetar salvo que fijes `key` en el manifest o publiques la extensión.

Para probar en local con `npm run dev` de Skincito, usá `"apiBaseUrl": "http://localhost:3001/api"` y `"websiteOrigin": "http://localhost:3000"`; el build sólo acepta HTTP para `localhost`.

## Uso

1. Iniciá sesión en Steam Community y en la web de Skincito.
2. Abrí el popup: muestra SteamID, estado del token local, si hay sesión de Skincito y operaciones pendientes del endpoint `GET /extension/trades/pending`. Desde la orden en la web, el vendedor puede usar los mismos botones.
3. En una operación, **Abrir Steam** abre la Trade URL. Un panel arriba del área de intercambio muestra el item, el comprador y el Asset ID; **Agregar item vendido** sólo busca `appid=730`, `contextid=2` y ese Asset ID. Si ya hay una oferta enviada para esa venta (activa, aceptada, esperando confirmación en el celular o en escrow), la extensión lo avisa y no deja agregar el asset ni crear otra oferta directa. También detecta ofertas armadas a mano al mismo comprador con el mismo asset.
4. Si Steam devuelve un `tradeofferid`, la extensión registra la oferta. Cada tres minutos consulta ofertas e historial y reporta estados observados.

El popup permite pegar una operación de prueba en JSON. Queda sólo en `chrome.storage.local`; el `tradeofferid` capturado queda en `demoOfferReport`. La opción **Crear oferta directa** envía una oferta real a Steam y debe usarse con cuidado.

El build incluye el cliente TLSNotary. `notarySessionUrl` y `notaryVerifierUrl` apuntan al notario propio de Skincito (`services/notary` en `fedebogovic/skincito`, publicado en `notary.skincito.com`). Cuando la extensión ve el trade completo en el historial, prueba `GetTradeHistory` con el notario y manda el payload firmado a la API, que lo valida (ver [el contrato](docs/backend-contract.md)). Para probar en local, usá `ws://localhost:7047/session` y `ws://localhost:7047/verifier`.

## Documentación

- [Arquitectura](docs/architecture.md)
- [Seguridad](docs/security.md)
- [Flujo Steam](docs/steam-flow.md)
- [Contrato backend](docs/backend-contract.md)
- [Avisos de terceros](THIRD_PARTY_NOTICES.md)
