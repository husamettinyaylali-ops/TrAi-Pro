/**
 * E-posta bağlantılarının kök adresi. İstekteki Host başlığı sahtelenebildiği için
 * (sıfırlama bağlantısını saldırganın sitesine yönlendirme) yayında yalnız
 * PUBLIC_URL kullanılır; yoksa null döner ve e-posta gönderilmez.
 * Geliştirmede PUBLIC_URL yoksa isteğin kökeni kabul edilir.
 */
export function resolveAppUrl(
  publicUrl: string | undefined,
  requestUrl: string,
  production: boolean,
): string | null {
  if (publicUrl) return publicUrl.replace(/\/+$/, "");
  return production ? null : new URL(requestUrl).origin;
}
