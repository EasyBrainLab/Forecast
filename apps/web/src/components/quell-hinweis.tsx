'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface Quelle {
  dateiname: string;
  stand: string;
}
interface Quellen {
  ist: Quelle | null;
  budget: Quelle | null;
  salesFlash: (Quelle & { jahr: number; monat: number }) | null;
}

const LABEL: Record<string, string> = { ist: 'GL-Ist', budget: 'Budget', salesFlash: 'Sales-Flash' };
const datum = (s: string): string => new Date(s).toLocaleDateString('de-DE');

/**
 * Dezenter Herkunfts-Hinweis unter einer Tabelle: „Quelle · GL-Ist: datei.csv (21.07.2026)".
 * Zeigt je gewählter Datenart die zuletzt importierte Datei + Datenstand. Rein informativ.
 */
export function QuellHinweis({ arten, className = '' }: { arten: Array<'ist' | 'budget' | 'salesFlash'>; className?: string }) {
  const { data } = useQuery({ queryKey: ['daten-quellen'], queryFn: () => api.get<Quellen>('/dashboard/quellen'), staleTime: 5 * 60 * 1000 });
  if (!data) return null;
  const teile = arten
    .map((a) => {
      const q = data[a];
      return q ? `${LABEL[a]}: ${q.dateiname} (${datum(q.stand)})` : null;
    })
    .filter(Boolean);
  if (teile.length === 0) return null;
  return <p className={`text-xs text-gray-400 ${className}`}>Quelle · {teile.join(' · ')}</p>;
}
