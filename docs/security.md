# Modelo de confianza

- Extensión, navegador, computadora y JSON remitido por la extensión: **no confiables**.
- Respuesta de Steam autenticada por TLSNotary: evidencia, sujeta a verificación criptográfica, análisis semántico y política temporal del backend.
- Backend: autoridad única para `VERIFIED`, `FAILED` y `ROLLED_BACK`.

El access token de Steam se almacena en `chrome.storage.local`, sólo en el equipo del usuario. Nunca se incluye en requests al backend. La prueba debe ocultar todas sus apariciones en el transcript. Un usuario con control del equipo puede leerlo, por lo que no debe tratarse como secreto del backend.

El backend debe verificar la prueba TLSNotary, el dominio autenticado `api.steampowered.com`, el endpoint `IEconService/GetTradeHistory/v1/`, parámetros que acoten la respuesta, el SteamID vendedor asociado al token/sesión por un mecanismo confiable, el comprador, Asset ID enviado, tiempo posterior a `acceptedAt`, settlement y ausencia de rollback. Debe rechazar reutilización de prueba entre órdenes. Para protegerse de un rollback posterior, mantener la operación abierta durante la ventana de protección y volver a consultar/probar el historial antes de liberación final. Una prueba histórica aislada no demuestra ausencia de rollback futuro.

El parser HTML de ofertas sólo reporta ID/estado aproximado y nunca alimenta la decisión de verificación. El CSS que bloquea el inventario es prevención de errores, no control de seguridad. El bridge externo restringe origen y sólo acepta tres mensajes tipados; el backend vuelve a validar el trade solicitado.

El endpoint `/steam-status` recibe observaciones no confiables. **No** debe existir `/mark-complete` ni transiciones a `VERIFIED` por `candidate: true`.
