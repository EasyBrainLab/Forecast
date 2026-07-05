'use client';
import { useTranslations } from 'next-intl';
import { useAuth, type Rolle } from '@/lib/auth';
import { Card } from '@/components/ui';

const KAPITEL = ['ersteSchritte', 'forecast', 'report', 'diktat', 'tender', 'leitung', 'admin', 'faq'] as const;

/** Sichtbarkeit je Kapitel: rollen-String aus den Messages ("alle" | kommagetrennte Rollen). */
function sichtbar(rollen: string, rolle: Rolle): boolean {
  if (rollen === 'alle') return true;
  const set = rollen.split(',').map((r) => r.trim());
  if (set.includes(rolle)) return true;
  // Leitung/Admin/Support sehen auch die AGM-Kapitel (Schulungs-/Support-Zweck).
  if (set.includes('AGM') && rolle !== 'AGM') return rolle === 'VERTRIEBSLEITER' || rolle === 'BU_LEITER' || rolle === 'ADMIN' || rolle === 'SUPPORT';
  if (rolle === 'ADMIN' || rolle === 'SUPPORT') return true;
  return false;
}

export default function HilfePage() {
  const t = useTranslations('hilfe');
  const { user } = useAuth();
  const rolle = user?.rolle ?? 'AGM';
  const schnellstart = t.raw('schnellstart') as string[];

  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-ez-primary">{t('titel')}</h1>
        <p className="text-sm text-gray-500">{t('untertitel')}</p>
      </div>

      {(rolle === 'AGM' || rolle === 'ADMIN' || rolle === 'SUPPORT') && (
        <Card className="border-ez-primary/40 bg-ez-primary/5">
          <h2 className="mb-2 font-semibold text-ez-primary">⚡ {t('schnellstartTitel')}</h2>
          <ol className="space-y-2 text-sm text-gray-700">
            {schnellstart.map((s, i) => (
              <li key={i} className="rounded bg-white p-2">
                {s}
              </li>
            ))}
          </ol>
        </Card>
      )}

      {KAPITEL.map((k) => {
        const rollen = t(`kapitel.${k}.rollen`);
        if (!sichtbar(rollen, rolle)) return null;
        const intro = t(`kapitel.${k}.intro`);
        const schritte = t.raw(`kapitel.${k}.schritte`) as string[];
        return (
          <Card key={k} className="p-0">
            <details className="group" open={k === 'ersteSchritte'}>
              <summary className="flex cursor-pointer items-center justify-between px-5 py-3 font-semibold text-ez-primary">
                {t(`kapitel.${k}.titel`)}
                <span className="text-gray-400 transition group-open:rotate-90">›</span>
              </summary>
              <div className="space-y-2 border-t border-gray-100 px-5 py-3">
                {intro && <p className="text-sm text-gray-600">{intro}</p>}
                <ul className="space-y-2">
                  {schritte.map((s, i) => (
                    <li key={i} className="flex gap-2 text-sm text-gray-700">
                      <span className="mt-0.5 shrink-0 text-ez-primary">▸</span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </details>
          </Card>
        );
      })}
    </div>
  );
}
