# Contrato propuesto para `https://api.skincito.com/api`

Implementado en `fedebogovic/skincito` (`apps/api/src/modules/extension`). La URL base se configura en `extension.config.json`. Todos los endpoints requieren sesión autenticada (del vendedor o del comprador de la orden) con cookie `HttpOnly; Secure; SameSite=None` si la extensión hace requests desde `chrome-extension://`. El backend debe permitir ese origen mediante CORS con credenciales; el ID de extensión cambia entre builds sin clave fija. Una alternativa más robusta es un token de sesión de alcance limitado emitido por la web. Nunca aceptar el Steam access token como autenticación de Skincito.

## `GET /extension/trades/pending`

Respuesta `200`: `{ "trades": PendingTrade[] }`. `PendingTrade`: `id`, `role` (`SELLER` o `BUYER`), `status`, `sellerSteamId`, `buyerSteamId`, `assetId`, `marketHashName`, `acceptedAt` ISO-8601; opcionales `buyerTradeUrl` (solo en ventas), `steamTradeOfferId`, `proofAcceptedAt` (esta parte ya probó la entrega). El backend devuelve las ventas y las compras del usuario autenticado en `AWAITING_TRADE`, `TRADE_REPORTED`, `SETTLEMENT_PENDING` y `DISPUTED`. Sin `role` (API anterior) es una venta. Si no hay sesión, `401` (Skincito responde `403`; la extensión trata ambos como "sin sesión").

## `POST /extension/trades/{id}/offer`

Body: `{marketplaceTradeId, steamTradeOfferId, otherSteamId, givenAssetIds: string[], receivedAssetIds: string[], needsConfirmation?: boolean}`. `needsConfirmation` es `true` cuando Steam respondió `needs_mobile_confirmation` o `needs_email_confirmation`: la oferta existe pero el vendedor todavía tiene que confirmarla en la app o por email. Respuesta `200`: `{accepted: true}` si se registró como dato provisional. Solo el vendedor. El backend comprueba dueño, trade, comprador y asset; no marca completado. Repeticiones del mismo ID deben ser idempotentes. Conflictos `409`.

## `POST /extension/trades/{id}/steam-status`

Body: `{marketplaceTradeId, steamTradeOfferId?, offerState?, historyTradeId?, historyStatus?, newAssetId?, candidate, rolledBack, checkedAt}`. Respuesta `200`: `{accepted: true}`. Lo manda cada parte con lo que ve en su propio historial de Steam: el vendedor busca el ítem entre lo que dio al comprador; el comprador, entre lo que recibió del vendedor. Datos no confiables: se guardan por parte y solo cuando cambian. Un trade completado no confirma la entrega (para eso está la prueba). Un rollback abre una disputa de reversión; si lo ve la extensión del vendedor, además se lo banea. `newAssetId` es el asset ID del ítem en el inventario del comprador, que Steam informa al terminar la protección.

## `POST /extension/trades/{id}/notary-ticket`

Respuesta `200`: `{ticket}`. Ticket de un solo uso, válido 5 minutos, firmado con `NOTARY_HMAC_SECRET` (dominio `skincito-notary-ticket.`) y atado a la orden y al SteamID de quien prueba: el del vendedor en una venta, el del comprador en una compra. El notario no abre sesiones sin él. Límite de 30 por hora por usuario. `503` si el notario no está configurado.

## `POST /extension/trades/{id}/proof`

Body: `{marketplaceTradeId, steamTradeId?, proof, proofFormat: "skincito-notary-v1"}`. Respuesta `202`: `{accepted: true, status: "VERIFIED" | "REJECTED" | "RECEIVED", outcome?: "COMPLETED" | "ROLLED_BACK", reason?}`. La sube cualquiera de las dos partes con su propio historial. El backend primero verifica la prueba completa: firma HMAC del notario, que sea de esta orden (`order_id` del ticket) y del historial de la cuenta de quien la sube (`steam_id`), que sea `GetTradeHistory` de `api.steampowered.com` con `include_failed=true`, sin `start_after_time`, `start_after_tradeid`, `navigating_back` ni parámetros repetidos, y con antigüedad menor a 2 horas. Las rechazadas no se almacenan. Después busca en la página el trade de la orden: con la otra parte, con el asset vendido (dado por el vendedor o recibido por el comprador) y posterior al pago. `steamTradeId` es opcional: el trade se busca. Un mismo trade de Steam puede probar varias órdenes si trae el ítem de cada una. Guarda solo los trades con la otra parte, el hash de la prueba (no la prueba firmada), quién la subió y lo que muestra.

- `COMPLETED` (estado 2/3): confirma la entrega y la protección termina en `time_settlement` (sin él, 7 días); si la entrega ya estaba confirmada, corrige esa fecha mientras no se haya avisado al comprador. Cierra una queja abierta durante el envío.
- `ROLLED_BACK` (estado 12 o un trade posterior con `rollback_trade`): abre la disputa de reversión y banea al vendedor (solo quien envía puede revertir).

`RECEIVED` significa que la API no tiene configurado el secreto del notario; en ese caso no se guarda la prueba.

## Servicio notarial

El notario es `services/notary` del repo `fedebogovic/skincito`: `/session` registra la sesión (mensaje `register` con el ticket) y `/verifier?sessionId=...` es el canal TLSNotary en modo proxy. El servicio de Skincito controla el notario y comparte con la API el secreto `NOTARY_HMAC_SECRET`; la extensión nunca lo ve. El payload de `session_completed` es `base64url(json).base64url(hmac)`.
