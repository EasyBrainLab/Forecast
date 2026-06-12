'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useAuth, ROLLEN_LABEL, type Rolle } from '@/lib/auth';

const NAV: { href: string; label: string; rollen: Rolle[] }[] = [
  { href: '/uebersicht', label: 'Übersicht & KPIs', rollen: ['AGM', 'VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN', 'SUPPORT'] },
  { href: '/forecast', label: 'Forecast / Erfassung', rollen: ['AGM', 'VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN'] },
  { href: '/statement', label: 'Vertriebs-Statement', rollen: ['AGM', 'VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN', 'SUPPORT'] },
  { href: '/konsolidierung', label: 'Konsolidierung', rollen: ['VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN'] },
  { href: '/absatz', label: 'Absatz / Stückzahlen', rollen: ['AGM', 'VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN', 'SUPPORT'] },
  { href: '/reconciliation', label: 'Sales-Flash & Abgleich', rollen: ['VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN', 'SUPPORT'] },
  { href: '/periode', label: 'Monatsabschluss', rollen: ['VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN', 'SUPPORT'] },
  { href: '/daten', label: 'Rohdaten', rollen: ['AGM', 'VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN', 'SUPPORT'] },
  { href: '/status-board', label: 'Status-Board', rollen: ['VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN', 'SUPPORT'] },
  { href: '/import', label: 'Import', rollen: ['BU_LEITER', 'ADMIN'] },
  { href: '/admin/kunde-region', label: 'Kunden → Region', rollen: ['ADMIN', 'SUPPORT'] },
  { href: '/admin/users', label: 'Nutzerverwaltung', rollen: ['ADMIN', 'SUPPORT'] },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const { user, laden, logout } = useAuth();
  const router = useRouter();
  const path = usePathname();

  useEffect(() => {
    if (!laden && !user) router.replace('/login');
  }, [laden, user, router]);

  if (laden || !user) return <div className="p-8 text-gray-500">Lädt…</div>;
  const nav = NAV.filter((n) => n.rollen.includes(user.rolle));

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between bg-ez-primary px-4 py-3 text-white">
        <div className="font-bold">Forecast-Portal BU Brachytherapie</div>
        <div className="flex items-center gap-3 text-sm">
          <span className="opacity-90">
            {user.name} · {ROLLEN_LABEL[user.rolle]}
          </span>
          <Link href="/passwort-aendern" className="rounded bg-white/20 px-2 py-1 hover:bg-white/30">
            Passwort
          </Link>
          <button
            onClick={() => {
              logout();
              router.replace('/login');
            }}
            className="rounded bg-white/20 px-2 py-1 hover:bg-white/30"
          >
            Abmelden
          </button>
        </div>
      </header>
      {user.passwortWechselPflicht && (
        <Link href="/passwort-aendern" className="block bg-ez-accent/10 px-4 py-2 text-center text-sm text-ez-accent hover:bg-ez-accent/20">
          Hinweis: Bitte ändern Sie Ihr Initialpasswort → jetzt ändern
        </Link>
      )}
      <div className="mx-auto flex max-w-6xl gap-6 p-4">
        <nav className="w-52 shrink-0 space-y-1">
          {nav.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`block rounded px-3 py-2 text-sm ${path === n.href ? 'bg-ez-primary text-white' : 'text-gray-700 hover:bg-gray-100'}`}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
