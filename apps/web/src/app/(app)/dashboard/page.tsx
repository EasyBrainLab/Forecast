'use client';
import Link from 'next/link';
import { useAuth, ROLLEN_LABEL } from '@/lib/auth';
import { Card } from '@/components/ui';

const KACHELN: Record<string, { href: string; titel: string; text: string }[]> = {
  AGM: [{ href: '/forecast', titel: 'Mein Forecast', text: 'Monatlichen Forecast bestätigen oder anpassen.' }],
  VERTRIEBSLEITER: [
    { href: '/status-board', titel: 'Status-Board', text: 'Bestätigungsstatus aller Regionen.' },
    { href: '/konsolidierung', titel: 'Konsolidierung', text: 'Ist / YEE / Budget je Region.' },
  ],
  BU_LEITER: [
    { href: '/konsolidierung', titel: 'Konsolidierung', text: 'BU-Gesamtsicht & Abweichungen.' },
    { href: '/import', titel: 'Import', text: 'Ist- und Budget-Daten einspielen.' },
    { href: '/status-board', titel: 'Status-Board', text: 'Forecast-Status je Region.' },
  ],
  ADMIN: [
    { href: '/admin/users', titel: 'Nutzerverwaltung', text: 'Einladungen & Rollen.' },
    { href: '/import', titel: 'Import', text: 'Datenimport & Monitoring.' },
    { href: '/konsolidierung', titel: 'Konsolidierung', text: 'Gesamtsicht.' },
  ],
  SUPPORT: [{ href: '/status-board', titel: 'Status-Board', text: 'Monitoring (lesend).' }],
};

export default function DashboardPage() {
  const { user } = useAuth();
  if (!user) return null;
  const kacheln = KACHELN[user.rolle] ?? [];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ez-primary">Willkommen, {user.name}</h1>
        <p className="text-sm text-gray-500">{ROLLEN_LABEL[user.rolle]}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {kacheln.map((k) => (
          <Link key={k.href} href={k.href}>
            <Card className="h-full transition hover:border-ez-primary hover:shadow">
              <h2 className="font-semibold text-ez-primary">{k.titel}</h2>
              <p className="mt-1 text-sm text-gray-600">{k.text}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
