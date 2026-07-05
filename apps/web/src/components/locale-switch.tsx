'use client';
import { useLocale } from 'next-intl';

/** DE/EN-Umschalter: setzt das Locale-Cookie und lädt neu (Server liefert dann die anderen Messages). */
export function LocaleSwitch({ className }: { className?: string }) {
  const locale = useLocale();
  const wechseln = (ziel: 'de' | 'en'): void => {
    if (ziel === locale) return;
    document.cookie = `NEXT_LOCALE=${ziel}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    window.location.reload();
  };
  return (
    <span className={className}>
      {(['de', 'en'] as const).map((l, i) => (
        <span key={l}>
          {i > 0 && <span className="opacity-50"> | </span>}
          <button
            onClick={() => wechseln(l)}
            className={locale === l ? 'font-bold underline' : 'opacity-80 hover:opacity-100'}
            aria-label={l === 'de' ? 'Deutsch' : 'English'}
          >
            {l.toUpperCase()}
          </button>
        </span>
      ))}
    </span>
  );
}
