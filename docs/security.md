# Modelo de confianza

- Extensión, navegador, computadora y JSON remitido por la extensión: **no confiables**.
- Respuesta de Steam autenticada por TLSNotary: evidencia, sujeta a verificación criptográfica, análisis semántico y política temporal del backend.
- Backend: autoridad única para `VERIFIED`, `FAILED` y `ROLLED_BACK`.

El access token de Steam se almacena en `chrome.storage.local`, sólo en el equipo del usuario. Nunca se incluye en requests al backend. La prueba oculta la firma del JWT en todas sus apariciones del transcript; header y payload (con el SteamID en `sub`) quedan visibles, y sin la firma el token no sirve. Como la firma tiene largo fijo, lo oculto no puede esconder parámetros extra para Steam. Un usuario con control del equipo puede leerlo, por lo que no debe tratarse como secreto del backend.

El backend debe verificar la prueba TLSNotary, el dominio autenticado `api.steampowered.com`, el endpoint `IEconService/GetTradeHistory/v1/`, parámetros que acoten la respuesta, el SteamID vendedor asociado al token (el notario lee `sub` del JWT y lo compara con el ticket emitido por la API), el comprador, Asset ID enviado, tiempo posterior a `acceptedAt`, settlement y ausencia de rollback. Debe rechazar reutilización de prueba entre órdenes. Para protegerse de un rollback posterior, mantener la operación abierta durante la ventana de protección y volver a consultar/probar el historial antes de liberación final. Una prueba histórica aislada no demuestra ausencia de rollback futuro.

El parser HTML de ofertas sólo reporta ID/estado aproximado y nunca alimenta la decisión de verificación. El CSS que bloquea el inventario es prevención de errores, no control de seguridad. El bridge externo restringe origen y sólo acepta dos mensajes tipados: `SKINCITO_GET_STATUS` y `SKINCITO_REQUEST_DELIVERY`. La web no puede crear ofertas: la entrega se aprueba en `approve.html`, una ventana propia de la extensión que la página no puede leer ni cliquear, y los mensajes de aprobación sólo se aceptan desde páginas de la extensión. El backend vuelve a validar el trade solicitado.

El endpoint `/steam-status` recibe observaciones no confiables. **No** debe existir `/mark-complete` ni transiciones a `VERIFIED` por `candidate: true`.
