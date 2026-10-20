/** Endereço do app do GHL. A ZOI loga pelo white label; AUTOMASTER_APP troca, se precisar. */
export const APP_GHL = (process.env.AUTOMASTER_APP ?? "https://app.zoitech.com.br").replace(/\/$/, "");
