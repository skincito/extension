# Contrato propuesto para `https://api.skincito.com/api`

Implementado en `fedebogovic/skincito` (`apps/api/src/modules/extension`). La URL base se configura en `extension.config.json`. Todos los endpoints requieren sesión de vendedor autenticada con cookie `HttpOnly; Secure; SameSite=None` si la extensión hace requests desde `chrome-extension://`. El backend debe permitir ese origen mediante CORS con credenciales; el ID de extensión cambia entre builds sin clave fija. Una alternativa más robusta es un token de sesión de alcance limitado emitido por la web. Nunca aceptar el Steam access token como autenticación de Skincito.

## `GET /extension/trades/pending`

Respuesta `200`: `{ "trades": PendingTrade[] }`. `PendingTrade`: `id`, `sellerSteamId`, `buyerSteamId`, `assetId`, `marketHashName`, `acceptedAt` ISO-8601, `buyerTradeUrl`; opcionales `steamTradeOfferId`, `proofAcceptedAt`. El backend devuelve sólo órdenes del vendedor autenticado. Si no hay sesión, `401` (Skincito responde `403`; la extensión trata ambos como "sin sesión").

## `POST /extension/trades/{id}/offer`

Body: `{marketplaceTradeId, steamTradeOfferId, otherSteamId, givenAssetIds: string[], receivedAssetIds: string[]}`. Respuesta `200`: `{accepted: true}` si se registró como dato provisional. El backend comprueba dueño, trade, comprador y asset; no marca completado. Repeticiones del mismo ID deben ser idempotentes. Conflictos `409`.

## `POST /extension/trades/{id}/steam-status`

Body: `{marketplaceTradeId, steamTradeOfferId?, offerState?, historyTradeId?, historyStatus?, candidate, rolledBack, checkedAt}`. Respuesta `200`: `{accepted: true}`. Datos de telemetría no confiables; no autorizan `VERIFIED`. Limitación de frecuencia y deduplicación por trade/estado.

## `POST /extension/trades/{id}/proof`

Body: `{marketplaceTradeId, steamTradeId, proof, proofFormat: "tlsnotary-csfloat-v1"}`. Respuesta `200`: `{accepted: true}` significa **recibido para validación**, no verificado. El backend verifica firma/attestation del notario, identidad del servidor Steam, respuesta HTTP íntegra, token oculto, sujeto/vendedor, comprador, asset enviado, tiempo, settlement, estado y rollback. Guarda el tradeid probado e impide replay. Puede responder `202` si la verificación es asíncrona, `422` si la prueba falla.

## Servicio notarial

Configurar dos URLs HTTPS/WSS compatibles con el protocolo de CSFloat: registro de sesión (`/session`) y canal verifier (`/verifier?sessionId=...`). El backend o servicio de confianza debe guardar claves del verificador y devolver el payload de `session_completed`. No usar un notario controlado por el vendedor para aprobar pagos. Faltan despliegue, claves, política de attestation y validación de payload en el backend; son trabajo obligatorio antes de producción.
