'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Ampel, Card, keur, prozent } from '@/components/ui';

interface Zeile {
  regionCode: string;
  bezeichnung: string;
  istYtd: number;
  forecastRest: number;
  yee: number;
  budget: number;
  abweichungEur: number;
  abweichungProzent: number | null;
}
interface Kons {
  jahr: number;
  stichtag: string;
  zeilen: Zeile[];
  gesamt: { istYtd: number; forecastRest: number; yee: number; budget: number; abweichungEur: number };
}

function ampel(p: number | null): 'gruen' | 'rot' | 'grau' {
  if (p === null) return 'grau';
  return Math.abs(p) > 10 ? 'rot' : 'gruen';
}

export default function KonsolidierungPage() {
  const jahr = new Date().getFullYear();
  const { data, isLoading, error } = useQuery({ queryKey: ['kons', jahr], queryFn: () => api.get<Kons>(`/dashboard/konsolidierung?jahr=${jahr}`) });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-ez-primary">Konsolidierung {jahr}</h1>
      {isLoading && <p className="text-gray-500">Lädt…</p>}
      {error && <p className="text-ez-accent">{(error as Error).message}</p>}
      {data && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="p-3">Region</th>
                <th className="p-3 text-right">Ist YTD</th>
                <th className="p-3 text-right">Forecast Rest</th>
                <th className="p-3 text-right">YEE</th>
                <th className="p-3 text-right">Budget</th>
                <th className="p-3 text-right">∆ %</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {data.zeilen.map((z) => (
                <tr key={z.regionCode} className="border-t">
                  <td className="p-3 font-medium">{z.bezeichnung}</td>
                  <td className="p-3 text-right">{keur(z.istYtd)}</td>
                  <td className="p-3 text-right">{keur(z.forecastRest)}</td>
                  <td className="p-3 text-right">{keur(z.yee)}</td>
                  <td className="p-3 text-right">{keur(z.budget)}</td>
                  <td className="p-3 text-right">{prozent(z.abweichungProzent)}</td>
                  <td className="p-3">
                    <Ampel farbe={ampel(z.abweichungProzent)} />
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 bg-gray-50 font-bold">
                <td className="p-3">BU-Gesamt</td>
                <td className="p-3 text-right">{keur(data.gesamt.istYtd)}</td>
                <td className="p-3 text-right">{keur(data.gesamt.forecastRest)}</td>
                <td className="p-3 text-right">{keur(data.gesamt.yee)}</td>
                <td className="p-3 text-right">{keur(data.gesamt.budget)}</td>
                <td className="p-3" />
                <td className="p-3" />
              </tr>
            </tbody>
          </table>
          <p className="p-3 text-xs text-gray-400">Werte in kEUR · Stichtag {data.stichtag}</p>
        </Card>
      )}
    </div>
  );
}
