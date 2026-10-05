# Arquitectura

`src/steam` contiene sesión, token, ofertas e historial. `src/marketplace` encapsula el API y el matching. `src/bridge` comunica la web/página Steam con el service worker. `src/background` controla el sondeo de 3 minutos. `src/proof` integra TLSNotary mediante un documento offscreen y worker.

El popup lee operaciones del backend con cookies de sesión. La extensión compara el SteamID logueado con el vendedor antes de actuar. La página de trade usa variables de Steam (`UserThem`, `UserYou.findAsset`, `MoveItemToTrade`) como CSFloat; sus cambios pueden romper el autofill y requieren mantenimiento.

El `tradeofferid` capturado en la página proviene del AJAX de Steam. Ese mensaje puede falsificarse en una máquina controlada por el usuario; sólo sirve para correlación inicial. El backend debe obtener/verificar evidencia de Steam antes de cambiar estados financieros.

La prueba TLSNotary usa `@csfloat/tlsn-wasm` en modo Proxy. Se revela respuesta y identidad del servidor, y se oculta el token de la transcripción enviada. El backend necesita un verificador/notario compatible, con identidad y claves confiables configuradas fuera de la extensión. El `notarySessionUrl` es el endpoint `/session` y `notaryVerifierUrl` el endpoint `/verifier` de ese servicio.
