'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { useAuth, type Rolle } from '@/lib/auth';
import { LocaleSwitch } from '@/components/locale-switch';

const NAV: { href: string; key: string; rollen: Rolle[] }[] = [
  { href: '/uebersicht', key: 'uebersicht', rollen: ['AGM', 'VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN', 'SUPPORT'] },
  { href: '/forecast', key: 'forecast', rollen: ['AGM', 'VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN'] },
  { href: '/forecast-monatlich', key: 'forecastMonat', rollen: ['AGM', 'VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN'] },
  { href: '/forecast-vergleich', key: 'forecastVergleich', rollen: ['AGM', 'VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN'] },
  { href: '/vertriebs-kpi', key: 'vertriebsKpi', rollen: ['VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN'] },
  { href: '/report', key: 'report', rollen: ['AGM', 'VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN', 'SUPPORT'] },
  { href: '/report-board', key: 'reportBoard', rollen: ['VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN', 'SUPPORT'] },
  { href: '/tender', key: 'tender', rollen: ['AGM', 'VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN', 'SUPPORT'] },
  { href: '/konsolidierung', key: 'konsolidierung', rollen: ['VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN'] },
  { href: '/absatz', key: 'absatz', rollen: ['AGM', 'VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN', 'SUPPORT'] },
  { href: '/liefermengen', key: 'liefermengen', rollen: ['AGM', 'VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN', 'SUPPORT'] },
  { href: '/reconciliation', key: 'reconciliation', rollen: ['VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN', 'SUPPORT'] },
  { href: '/sales-flash', key: 'salesFlash', rollen: ['VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN', 'SUPPORT'] },
  { href: '/sales-analytik', key: 'salesAnalytik', rollen: ['VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN'] },
  { href: '/periode', key: 'periode', rollen: ['VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN', 'SUPPORT'] },
  { href: '/daten', key: 'daten', rollen: ['AGM', 'VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN', 'SUPPORT'] },
  { href: '/status-board', key: 'statusBoard', rollen: ['VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN', 'SUPPORT'] },
  { href: '/export', key: 'export', rollen: ['AGM', 'VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN', 'SUPPORT'] },
  { href: '/import', key: 'import', rollen: ['BU_LEITER', 'ADMIN'] },
  { href: '/admin/quarantaene', key: 'quarantaene', rollen: ['BU_LEITER', 'ADMIN', 'SUPPORT'] },
  { href: '/admin/kunde-region', key: 'kundeRegion', rollen: ['ADMIN', 'SUPPORT'] },
  { href: '/admin/competitor', key: 'competitor', rollen: ['ADMIN', 'SUPPORT'] },
  { href: '/admin/customer-site', key: 'customerSite', rollen: ['ADMIN', 'SUPPORT'] },
  { href: '/admin/kundenabgleich', key: 'kundenabgleich', rollen: ['BU_LEITER', 'ADMIN', 'SUPPORT'] },
  { href: '/admin/users', key: 'users', rollen: ['ADMIN', 'SUPPORT'] },
  { href: '/admin/ki', key: 'ki', rollen: ['ADMIN', 'SUPPORT'] },
  { href: '/hilfe', key: 'hilfe', rollen: ['AGM', 'VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN', 'SUPPORT'] },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const { user, laden, logout } = useAuth();
  const router = useRouter();
  const path = usePathname();
  const t = useTranslations('nav');

  useEffect(() => {
    if (!laden && !user) router.replace('/login');
  }, [laden, user, router]);

  if (laden || !user) return <div className="p-8 text-gray-500">…</div>;
  const nav = NAV.filter((n) => n.rollen.includes(user.rolle));

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between bg-ez-primary px-4 py-3 text-white">
        <div className="font-bold">{t('titel')}</div>
        <div className="flex items-center gap-3 text-sm">
          <LocaleSwitch className="text-xs" />
          <span className="opacity-90">
            {user.name} · {t(`rollen.${user.rolle}`)}
          </span>
          <Link href="/passwort-aendern" className="rounded bg-white/20 px-2 py-1 hover:bg-white/30">
            {t('passwort')}
          </Link>
          <button
            onClick={() => {
              logout();
              router.replace('/login');
            }}
            className="rounded bg-white/20 px-2 py-1 hover:bg-white/30"
          >
            {t('abmelden')}
          </button>
        </div>
      </header>
      {user.passwortWechselPflicht && (
        <Link href="/passwort-aendern" className="block bg-ez-accent/10 px-4 py-2 text-center text-sm text-ez-accent hover:bg-ez-accent/20">
          {t('pflichtHinweis')}
        </Link>
      )}
      <div className="mx-auto flex max-w-[1700px] gap-6 p-4">
        <nav className="w-52 shrink-0 space-y-1">
          {nav.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`block rounded px-3 py-2 text-sm ${path === n.href ? 'bg-ez-primary text-white' : 'text-gray-700 hover:bg-gray-100'}`}
            >
              {t(n.key)}
            </Link>
          ))}
        </nav>
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
