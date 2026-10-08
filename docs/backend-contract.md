# Contrato propuesto para `https://api.skincito.com/api`

Implementado en `fedebogovic/skincito` (`apps/api/src/modules/extension`). La URL base se configura en `extension.config.json`. Todos los endpoints requieren sesión de vendedor autenticada con cookie `HttpOnly; Secure; SameSite=None` si la extensión hace requests desde `chrome-extension://`. El backend debe permitir ese origen mediante CORS con credenciales; el ID de extensión cambia entre builds sin clave fija. Una alternativa más robusta es un token de sesión de alcance limitado emitido por la web. Nunca aceptar el Steam access token como autenticación de Skincito.

## `GET /extension/trades/pending`

Respuesta `200`: `{ "trades": PendingTrade[] }`. `PendingTrade`: `id`, `sellerSteamId`, `buyerSteamId`, `assetId`, `marketHashName`, `acceptedAt` ISO-8601, `buyerTradeUrl`; opcionales `steamTradeOfferId`, `proofAcceptedAt`. El backend devuelve sólo órdenes del vendedor autenticado. Si no hay sesión, `401` (Skincito responde `403`; la extensión trata ambos como "sin sesión").

## `POST /extension/trades/{id}/offer`

Body: `{marketplaceTradeId, steamTradeOfferId, otherSteamId, givenAssetIds: string[], receivedAssetIds: string[], needsConfirmation?: boolean}`. `needsConfirmation` es `true` cuando Steam respondió `needs_mobile_confirmation` o `needs_email_confirmation`: la oferta existe pero el vendedor todavía tiene que confirmarla en la app o por email. Respuesta `200`: `{accepted: true}` si se registró como dato provisional. El backend comprueba dueño, trade, comprador y asset; no marca completado. Repeticiones del mismo ID deben ser idempotentes. Conflictos `409`.

## `POST /extension/trades/{id}/steam-status`

Body: `{marketplaceTradeId, steamTradeOfferId?, offerState?, historyTradeId?, historyStatus?, newAssetId?, candidate, rolledBack, checkedAt}`. Respuesta `200`: `{accepted: true}`. Datos de telemetría no confiables; no autorizan `VERIFIED`. Cuando `candidate` es `true`, la API encola una revisión del inventario público del comprador; la entrega se confirma sólo si Steam muestra el item por float y seed. `newAssetId` es sólo telemetría: un item sin float (caja, sticker) es indistinguible de otro igual que el comprador haya recibido de otro vendedor, así que esa entrega sólo se confirma con la prueba del notario o con "Recibí el item". Limitación de frecuencia y deduplicación por trade/estado.

## `POST /extension/trades/{id}/notary-ticket`

Respuesta `200`: `{ticket}`. Ticket de un solo uso, válido 5 minutos, firmado con `NOTARY_HMAC_SECRET` (dominio `skincito-notary-ticket.`) y atado a la orden y al SteamID del vendedor. El notario no abre sesiones sin él. Límite de 30 por hora por vendedor. `503` si el notario no está configurado.

## `POST /extension/trades/{id}/proof`

Body: `{marketplaceTradeId, steamTradeId, proof, proofFormat: "skincito-notary-v1"}`. Respuesta `202`: `{accepted: true, status: "VERIFIED" | "REJECTED" | "RECEIVED", reason?}`. El backend verifica la firma HMAC del notario y antes de guardar nada: las pruebas rechazadas no se almacenan. Comprueba que la prueba sea de esta orden (`order_id` del ticket) y del historial de la cuenta del vendedor (`steam_id`, el `sub` del access token), que sea `GetTradeHistory` de `api.steampowered.com` con `include_failed=true` y sin `start_after_time`, `start_after_tradeid`, `navigating_back` ni parámetros repetidos (la página tiene que empezar en el trade más reciente), antigüedad menor a 2 horas, comprador, asset enviado, que sea el intento más reciente, posterior al pago, en estado 2/3 con `time_settlement`, sin rollback y con `new_assetid` si la protección sigue activa. Guarda el tradeid probado e impide replay. Si es válida, la orden pasa a `SETTLEMENT_PENDING`. `RECEIVED` significa que la API no tiene configurado el secreto del notario; en ese caso no se guarda la prueba.

## Servicio notarial

El notario es `services/notary` del repo `fedebogovic/skincito`: `/session` registra la sesión (mensaje `register` con el ticket) y `/verifier?sessionId=...` es el canal TLSNotary en modo proxy. El servicio de Skincito controla el notario y comparte con la API el secreto `NOTARY_HMAC_SECRET`; la extensión nunca lo ve. El payload de `session_completed` es `base64url(json).base64url(hmac)`.
