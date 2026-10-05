export interface Config {apiBaseUrl: string; websiteOrigin: string; /** websiteOrigin y su variante con/sin www, calculado en el build. */ websiteOrigins: string[]; notarySessionUrl: string; notaryVerifierUrl: string; notaryProxyUrl: string}
declare const __SKINCITO_CONFIG__: Config;
export const config = __SKINCITO_CONFIG__;
