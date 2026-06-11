'use client';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Ampel, Button, Card, Input, keur, prozent } from '@/components/ui';

interface Periode {
  id: string;
  periode: string;
  regionCode: string;
  status: string;
}
interface Zelle {
  landId: string;
  landName: string;
  e1Id: string;
  e1Name: string;
  status: string;
  budgetRest: number;
  istYtd: number;
  forecastRest: number;
  yee: number;
  abweichungProzent: number | null;
  ampel: 'gruen' | 'rot' | 'grau';
  monatswerteRest: Record<string, { eur: number; units?: number | null }>;
}
interface Matrix {
  periode: string;
  regionCode: string;
  status: string;
  deadline: string;
  schwellwertProzent: number;
  zellen: Zelle[];
}

export default function ForecastPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [sel, setSel] = useState<{ periode: string; regionCode: string } | null>(null);
  const [edits, setEdits] = useState<Record<string, number>>({}); // key -> neuer Forecast-Gesamtwert
  const [kommentar, setKommentar] = useState('');

  const { data: perioden } = useQuery({ queryKey: ['meine'], queryFn: () => api.get<Periode[]>('/forecast/meine') });
  const [neuePeriode, setNeuePeriode] = useState('2026-06');
  const oeffnen = useMutation({
    mutationFn: () => api.post('/forecast/oeffnen', { periode: neuePeriode }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meine'] }),
  });
  const kannOeffnen = user?.rolle === 'ADMIN' || user?.rolle === 'BU_LEITER';
  const aktiv = sel ?? (perioden && perioden[0] ? { periode: perioden[0].periode, regionCode: perioden[0].regionCode } : null);
  const { data: matrix } = useQuery({
    queryKey: ['matrix', aktiv?.periode, aktiv?.regionCode],
    queryFn: () => api.get<Matrix>(`/forecast/${aktiv!.periode}/${aktiv!.regionCode}/matrix`),
    enabled: !!aktiv,
  });

  const editierbar = !!matrix && matrix.status === 'OFFEN' && user?.rolle === 'AGM';

  const bestaetigen = useMutation({
    mutationFn: () => api.post(`/forecast/${aktiv!.periode}/${aktiv!.regionCode}/bestaetigen`),
    onSuccess: () => qc.invalidateQueries(),
  });

  const anpassen = useMutation({
    mutationFn: () => {
      const zellen = Object.entries(edits)
        .map(([key, neu]) => {
          const z = matrix!.zellen.find((c) => `${c.landId}|${c.e1Id}` === key);
          if (!z) return null;
          const alt = z.forecastRest;
          const monate = Object.keys(z.monatswerteRest);
          const neuMw: Record<string, { eur: number; units?: number | null }> = {};
          if (alt > 0) {
            for (const m of monate) neuMw[m] = { eur: Math.round(z.monatswerteRest[m].eur * (neu / alt) * 100) / 100, units: z.monatswerteRest[m].units };
          } else {
            const proMonat = monate.length ? Math.round((neu / monate.length) * 100) / 100 : 0;
            for (const m of monate) neuMw[m] = { eur: proMonat, units: null };
          }
          return { landId: z.landId, e1Id: z.e1Id, monatswerteRest: neuMw };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
      return api.post(`/forecast/${aktiv!.periode}/${aktiv!.regionCode}/anpassen`, { kommentar: kommentar || undefined, zellen });
    },
    onSuccess: () => {
      setEdits({});
      setKommentar('');
      qc.invalidateQueries();
    },
  });

  const summen = useMemo(() => {
    const z = matrix?.zellen ?? [];
    const fc = (k: string, fallback: (c: Zelle) => number) => z.reduce((s, c) => s + (edits[`${c.landId}|${c.e1Id}`] !== undefined && k === 'forecastRest' ? edits[`${c.landId}|${c.e1Id}`] : fallback(c)), 0);
    return {
      budget: z.reduce((s, c) => s + c.budgetRest, 0),
      ist: z.reduce((s, c) => s + c.istYtd, 0),
      forecast: fc('forecastRest', (c) => c.forecastRest),
    };
  }, [matrix, edits]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-ez-primary">Forecast — Gegenüberstellung &amp; Erfassung</h1>

      {kannOeffnen && (
        <Card className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium">Forecast-Periode öffnen (alle Regionen)</label>
            <input type="month" className="rounded border border-gray-300 px-3 py-2 text-sm" value={neuePeriode} onChange={(e) => setNeuePeriode(e.target.value)} />
          </div>
          <Button onClick={() => oeffnen.mutate()} disabled={oeffnen.isPending}>
            {oeffnen.isPending ? 'Öffne…' : 'Periode öffnen'}
          </Button>
          {oeffnen.isSuccess && <span className="text-sm text-ez-ampelGruen">Geöffnet ✓</span>}
          {oeffnen.isError && <span className="text-sm text-ez-accent">{(oeffnen.error as Error).message}</span>}
          <p className="w-full text-xs text-gray-400">Voraussetzung: Budget &amp; Ist für das Jahr sind importiert (Menü „Import"). Die Restmonate werden aus dem Budget vorbelegt.</p>
        </Card>
      )}

      {perioden && perioden.length === 0 && (
        <Card>
          <p className="text-gray-600">Es ist noch keine Forecast-Periode geöffnet. {kannOeffnen ? 'Öffne oben eine Periode.' : 'Eine Periode wird vom BU-Leiter/Admin nach dem Ist-Import geöffnet.'}</p>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        {perioden?.map((p) => (
          <button
            key={p.id}
            onClick={() => {
              setSel({ periode: p.periode, regionCode: p.regionCode });
              setEdits({});
            }}
            className={`rounded border px-3 py-1 text-sm ${aktiv?.periode === p.periode && aktiv?.regionCode === p.regionCode ? 'border-ez-primary bg-ez-primary text-white' : 'bg-white'}`}
          >
            {p.regionCode} · {p.periode} ({p.status})
          </button>
        ))}
      </div>

      {matrix && (
        <Card className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="font-semibold">
                {matrix.regionCode} · {matrix.periode}
              </span>
              <span className="ml-2 rounded bg-gray-100 px-2 py-0.5 text-xs">{matrix.status}</span>
              <span className="ml-2 text-xs text-gray-400">Schwellwert {matrix.schwellwertProzent} %</span>
            </div>
            {matrix.status === 'OFFEN' && user?.rolle === 'AGM' && Object.keys(edits).length === 0 && (
              <Button onClick={() => bestaetigen.mutate()} disabled={bestaetigen.isPending}>
                {bestaetigen.isPending ? 'Bestätige…' : 'Unverändert bestätigen (1 Klick)'}
              </Button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-600">
                <tr>
                  <th className="p-2">Produktgruppe</th>
                  <th className="p-2">Land</th>
                  <th className="p-2 text-right">Budget Rest (kEUR)</th>
                  <th className="p-2 text-right">Ist YTD (kEUR)</th>
                  <th className="p-2 text-right">Forecast Rest (kEUR)</th>
                  <th className="p-2 text-right">YEE (kEUR)</th>
                  <th className="p-2 text-right">∆ Bud %</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {matrix.zellen.map((z) => {
                  const key = `${z.landId}|${z.e1Id}`;
                  const fcWert = edits[key] !== undefined ? edits[key] : z.forecastRest;
                  return (
                    <tr key={key} className="border-t">
                      <td className="p-2 font-medium">{z.e1Name}</td>
                      <td className="p-2">{z.landName}</td>
                      <td className="p-2 text-right">{keur(z.budgetRest)}</td>
                      <td className="p-2 text-right text-gray-500">{keur(z.istYtd)}</td>
                      <td className="p-2 text-right">
                        {editierbar ? (
                          <input
                            type="number"
                            className="w-28 rounded border border-gray-300 px-2 py-1 text-right text-sm focus:border-ez-primary focus:outline-none"
                            value={Math.round(fcWert)}
                            onChange={(e) => setEdits({ ...edits, [key]: Number(e.target.value) })}
                          />
                        ) : (
                          keur(z.forecastRest)
                        )}
                      </td>
                      <td className="p-2 text-right">{keur(z.istYtd + fcWert)}</td>
                      <td className="p-2 text-right">{prozent(z.abweichungProzent)}</td>
                      <td className="p-2">
                        <Ampel farbe={z.ampel} />
                      </td>
                    </tr>
                  );
                })}
                <tr className="border-t-2 bg-gray-50 font-bold">
                  <td className="p-2" colSpan={2}>
                    Summe Region
                  </td>
                  <td className="p-2 text-right">{keur(summen.budget)}</td>
                  <td className="p-2 text-right">{keur(summen.ist)}</td>
                  <td className="p-2 text-right">{keur(summen.forecast)}</td>
                  <td className="p-2 text-right">{keur(summen.ist + summen.forecast)}</td>
                  <td className="p-2" colSpan={2} />
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-400">
            Beträge sind die Restmonate {matrix.periode.slice(5)}–12 in kEUR. Forecast-Wert anpassen → wird proportional auf die Restmonate verteilt.
          </p>

          {editierbar && Object.keys(edits).length > 0 && (
            <div className="space-y-2 rounded border border-ez-primary/30 bg-ez-primary/5 p-3">
              <label className="block text-sm font-medium">Kommentar (Pflicht bei Abweichung &gt; {matrix.schwellwertProzent} %)</label>
              <Input value={kommentar} onChange={(e) => setKommentar(e.target.value)} placeholder="z. B. Großauftrag Q3, Lieferverschiebung …" />
              {anpassen.isError && <p className="text-sm text-ez-accent">{(anpassen.error as Error).message}</p>}
              <div className="flex gap-2">
                <Button onClick={() => anpassen.mutate()} disabled={anpassen.isPending}>
                  {anpassen.isPending ? 'Speichere…' : `${Object.keys(edits).length} Anpassung(en) speichern`}
                </Button>
                <Button variant="ghost" onClick={() => setEdits({})}>
                  Verwerfen
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
