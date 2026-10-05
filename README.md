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

## Uso

1. Iniciá sesión en Steam Community y en la web de Skincito.
2. Abrí el popup: muestra SteamID, estado del token local y operaciones pendientes del endpoint `GET /extension/trades/pending`.
3. En una operación, **Abrir Steam** abre la Trade URL. El recuadro muestra comprador y Asset ID; **Agregar asset vendido** sólo busca `appid=730`, `contextid=2` y ese Asset ID.
4. Si Steam devuelve un `tradeofferid`, la extensión registra la oferta. Cada tres minutos consulta ofertas e historial y reporta estados observados.

El popup permite pegar una operación de prueba en JSON. Queda sólo en `chrome.storage.local`; el `tradeofferid` capturado queda en `demoOfferReport`. La opción **Crear oferta directa** envía una oferta real a Steam y debe usarse con cuidado.

El build incluye el cliente TLSNotary. Para generar pruebas se requiere configurar `notarySessionUrl` y `notaryVerifierUrl` con un servicio compatible con el protocolo usado por CSFloat. El backend debe verificar el payload y la política descrita en [el contrato](docs/backend-contract.md). Hasta desplegar ese servicio, la generación de pruebas no está operativa.

## Documentación

- [Arquitectura](docs/architecture.md)
- [Seguridad](docs/security.md)
- [Flujo Steam](docs/steam-flow.md)
- [Contrato backend](docs/backend-contract.md)
- [Avisos de terceros](THIRD_PARTY_NOTICES.md)
