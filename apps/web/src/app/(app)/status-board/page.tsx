'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card } from '@/components/ui';

interface Periode {
  id: string;
  periode: string;
  regionCode: string;
  status: string;
  deadline: string;
}

const STATUS_FARBE: Record<string, string> = {
  OFFEN: 'bg-gray-200 text-gray-700',
  BESTAETIGT: 'bg-ez-ampelGruen/20 text-ez-ampelGruen',
  ANGEPASST: 'bg-ez-ampelGelb/20 text-yellow-700',
  ZURUECKGEWIESEN: 'bg-ez-accent/15 text-ez-accent',
  ABGESCHLOSSEN: 'bg-ez-primary/15 text-ez-primary',
};

export default function StatusBoardPage() {
  const { data, isLoading, error } = useQuery({ queryKey: ['statusboard'], queryFn: () => api.get<Periode[]>('/forecast/status-board') });
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-ez-primary">Status-Board</h1>
      {isLoading && <p className="text-gray-500">Lädt…</p>}
      {error && <p className="text-ez-accent">{(error as Error).message}</p>}
      {data && data.length === 0 && <p className="text-gray-500">Noch keine Forecast-Perioden geöffnet.</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data?.map((p) => (
          <Card key={p.id}>
            <div className="flex items-center justify-between">
              <span className="font-semibold">{p.regionCode}</span>
              <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_FARBE[p.status] ?? 'bg-gray-100'}`}>{p.status}</span>
            </div>
            <p className="mt-1 text-sm text-gray-500">Periode {p.periode}</p>
            <p className="text-xs text-gray-400">Frist: {new Date(p.deadline).toLocaleDateString('de-DE')}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
