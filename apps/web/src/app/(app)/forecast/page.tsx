'use client';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Ampel, Button, Card, Input, keur, prozent } from '@/components/ui';
import { PeriodenAktionen } from '@/components/perioden-aktionen';

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
  const t = useTranslations('forecast');
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
      <h1 className="text-2xl font-bold text-ez-primary">{t('titel')}</h1>

      {kannOeffnen && (
        <Card className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium">{t('periodeOeffnen')}</label>
            <input type="month" className="rounded border border-gray-300 px-3 py-2 text-sm" value={neuePeriode} onChange={(e) => setNeuePeriode(e.target.value)} />
          </div>
          <Button onClick={() => oeffnen.mutate()} disabled={oeffnen.isPending}>
            {oeffnen.isPending ? t('oeffnet') : t('oeffnen')}
          </Button>
          {oeffnen.isSuccess && <span className="text-sm text-ez-ampelGruen">{t('geoeffnet')}</span>}
          {oeffnen.isError && <span className="text-sm text-ez-accent">{(oeffnen.error as Error).message}</span>}
          <p className="w-full text-xs text-gray-400">{t('oeffnenHinweis')}</p>
        </Card>
      )}

      {perioden && perioden.length === 0 && (
        <Card>
          <p className="text-gray-600">
            {t('keinePeriode')} {kannOeffnen ? t('keinePeriodeAdmin') : t('keinePeriodeAgm')}
          </p>
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
              <span className="ml-2 text-xs text-gray-400">{t('schwellwert', { prozent: matrix.schwellwertProzent })}</span>
            </div>
            <div className="flex flex-wrap items-start gap-2">
              {matrix.status === 'OFFEN' && user?.rolle === 'AGM' && Object.keys(edits).length === 0 && (
                <Button onClick={() => bestaetigen.mutate()} disabled={bestaetigen.isPending}>
                  {bestaetigen.isPending ? t('bestaetigt') : t('bestaetigen')}
                </Button>
              )}
              <PeriodenAktionen periode={matrix.periode} regionCode={matrix.regionCode} status={matrix.status} />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-600">
                <tr>
                  <th className="p-2">{t('spalteProduktgruppe')}</th>
                  <th className="p-2">{t('spalteLand')}</th>
                  <th className="p-2 text-right">{t('spalteBudgetRest')}</th>
                  <th className="p-2 text-right">{t('spalteIstYtd')}</th>
                  <th className="p-2 text-right">{t('spalteForecastRest')}</th>
                  <th className="p-2 text-right">{t('spalteYee')}</th>
                  <th className="p-2 text-right">{t('spalteAbw')}</th>
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
                    {t('summeRegion')}
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
          <p className="text-xs text-gray-400">{t('fussnote', { von: matrix.periode.slice(5) })}</p>

          {editierbar && Object.keys(edits).length > 0 && (
            <div className="space-y-2 rounded border border-ez-primary/30 bg-ez-primary/5 p-3">
              <label className="block text-sm font-medium">{t('kommentarLabel', { prozent: matrix.schwellwertProzent })}</label>
              <Input value={kommentar} onChange={(e) => setKommentar(e.target.value)} placeholder={t('kommentarPlaceholder')} />
              {anpassen.isError && <p className="text-sm text-ez-accent">{(anpassen.error as Error).message}</p>}
              <div className="flex gap-2">
                <Button onClick={() => anpassen.mutate()} disabled={anpassen.isPending}>
                  {anpassen.isPending ? t('speichert') : t('speichern', { anzahl: Object.keys(edits).length })}
                </Button>
                <Button variant="ghost" onClick={() => setEdits({})}>
                  {t('verwerfen')}
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
