import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';

export const LOCALES = ['de', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'de';
export const LOCALE_COOKIE = 'NEXT_LOCALE';

/** Locale ohne URL-Routing: aus Cookie (Umschalter im Header), Default Deutsch. */
export default getRequestConfig(async () => {
  const wert = cookies().get(LOCALE_COOKIE)?.value;
  const locale: Locale = wert === 'en' ? 'en' : DEFAULT_LOCALE;
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
