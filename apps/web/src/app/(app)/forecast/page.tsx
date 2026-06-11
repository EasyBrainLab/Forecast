'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Ampel, Button, Card, keur, prozent } from '@/components/ui';

interface Periode {
  id: string;
  periode: string;
  regionCode: string;
  status: string;
  deadline: string;
}
interface Zelle {
  landId: string;
  e1Id: string;
  status: string;
  budgetRest: number;
  forecastRest: number;
  abweichungProzent: number | null;
  ampel: 'gruen' | 'rot' | 'grau';
}
interface Matrix {
  periode: string;
  regionCode: string;
  status: string;
  deadline: string;
  schwellwertProzent: number;
  zellen: Zelle[];
}
interface E1 {
  id: string;
  nameDe: string;
}

export default function ForecastPage() {
  const qc = useQueryClient();
  const [aktiv, setAktiv] = useState<{ periode: string; regionCode: string } | null>(null);
  const { data: perioden } = useQuery({ queryKey: ['meine'], queryFn: () => api.get<Periode[]>('/forecast/meine') });
  const { data: pg } = useQuery({ queryKey: ['pg'], queryFn: () => api.get<{ e1: E1[] }>('/stammdaten/produktgruppen') });
  const sel = aktiv ?? (perioden && perioden[0] ? { periode: perioden[0].periode, regionCode: perioden[0].regionCode } : null);
  const { data: matrix } = useQuery({
    queryKey: ['matrix', sel?.periode, sel?.regionCode],
    queryFn: () => api.get<Matrix>(`/forecast/${sel!.periode}/${sel!.regionCode}/matrix`),
    enabled: !!sel,
  });
  const bestaetigen = useMutation({
    mutationFn: () => api.post(`/forecast/${sel!.periode}/${sel!.regionCode}/bestaetigen`),
    onSuccess: () => qc.invalidateQueries(),
  });

  const e1Name = (id: string): string => pg?.e1.find((e) => e.id === id)?.nameDe ?? id.slice(0, 6);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-ez-primary">Mein Forecast</h1>
      {perioden && perioden.length === 0 && <p className="text-gray-500">Aktuell keine offene Forecast-Periode.</p>}
      <div className="flex flex-wrap gap-2">
        {perioden?.map((p) => (
          <button
            key={p.id}
            onClick={() => setAktiv({ periode: p.periode, regionCode: p.regionCode })}
            className={`rounded border px-3 py-1 text-sm ${sel?.periode === p.periode && sel?.regionCode === p.regionCode ? 'border-ez-primary bg-ez-primary text-white' : 'bg-white'}`}
          >
            {p.regionCode} · {p.periode} ({p.status})
          </button>
        ))}
      </div>

      {matrix && (
        <Card className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <span className="font-semibold">
                Forecast {matrix.periode} — {matrix.regionCode}
              </span>
              <span className="ml-2 rounded bg-gray-100 px-2 py-0.5 text-xs">{matrix.status}</span>
            </div>
            {matrix.status === 'OFFEN' && (
              <Button onClick={() => bestaetigen.mutate()} disabled={bestaetigen.isPending}>
                {bestaetigen.isPending ? 'Bestätige…' : 'Forecast bestätigen (1 Klick)'}
              </Button>
            )}
          </div>
          {bestaetigen.isError && <p className="text-sm text-ez-accent">{(bestaetigen.error as Error).message}</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-600">
                <tr>
                  <th className="p-2">Land</th>
                  <th className="p-2">Produktgruppe</th>
                  <th className="p-2 text-right">Budget Rest (kEUR)</th>
                  <th className="p-2 text-right">Forecast Rest (kEUR)</th>
                  <th className="p-2 text-right">∆ %</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {matrix.zellen.map((z, i) => (
                  <tr key={i} className="border-t">
                    <td className="p-2">{z.landId}</td>
                    <td className="p-2">{e1Name(z.e1Id)}</td>
                    <td className="p-2 text-right">{keur(z.budgetRest)}</td>
                    <td className="p-2 text-right">{keur(z.forecastRest)}</td>
                    <td className="p-2 text-right">{prozent(z.abweichungProzent)}</td>
                    <td className="p-2">
                      <Ampel farbe={z.ampel} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-400">
            Schwellwert {matrix.schwellwertProzent} % · Frist {new Date(matrix.deadline).toLocaleDateString('de-DE')}
          </p>
        </Card>
      )}
    </div>
  );
}
