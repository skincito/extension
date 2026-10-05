# Flujo Steam

1. `steamcommunity.com` expone `g_steamID`, `g_sessionID` y `data-loyalty_webapi_token` en el HTML de la sesión. El token se reutiliza 30 minutos tras comprobar el SteamID actual.
2. La Trade URL debe tener `partner` que convierta al `buyerSteamId`. En la página, `UserThem.strSteamId` y `g_steamID` deben coincidir. Se busca sólo `UserYou.findAsset(730, 2, assetId)`.
3. La creación directa usa `/tradeoffer/new/send`, `json_tradeoffer` y una regla DNR temporal para `Referer`, con el iniciador limitado a la extensión.
4. Se captura el ID de respuesta AJAX y el payload enviado. `GetTradeOffers/v1/` informa estados 1 a 11. Si falla o devuelve vacío, el parser HTML de `/id/me/tradeoffers/sent` sólo recupera IDs/estados aproximados.
5. `GetTradeHistory/v1/` con `include_failed=true` aporta `tradeid`, `steamid_other`, assets, `time_init`, `time_settlement` y `rollback_trade`. Estados relevantes: 2 Committed, 3 Complete, 4 Failed, 12 TradeProtectionRollback (observado por CSFloat, no documentado públicamente por Steam).
6. El intento más reciente con comprador y asset enviado coincidentes prevalece. Un rollback vinculado invalida el candidato. El backend vuelve a verificar todo mediante prueba criptográfica y seguimiento posterior.
