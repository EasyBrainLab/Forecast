'use client';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { api, downloadDatei } from '@/lib/api';
import { Button, Card } from '@/components/ui';
import Link from 'next/link';
import { QuellHinweis } from '@/components/quell-hinweis';
import { monKurz } from '@/lib/monate';

interface Zeile {
  e1Id: string;
  bezeichnung: string;
  istMonate: Record<string, number>;
  forecastMonate: Record<string, number>;
  budgetMonate: Record<string, number>;
}
interface GuvPanelPos {
  key: string;
  label: string;
  ebene: number;
  ist: number;
  py: number;
  bud: number;
}
interface GuvPanel {
  stichtagMonat: number;
  positionen: GuvPanelPos[];
}
interface KonsMonat {
  jahr: number;
  stichtag: string;
  monate: string[];
  restAbMonat: number; // Monate mit Nummer >= restAbMonat sind Forecast, < sind Ist
  zeilen: Zeile[];
  guvPanel: GuvPanel | null;
}

const monatNr = (p: string) => Number(p.slice(5));
// Anzeige in kEUR (Tausend EUR), ganzzahlig, mit Tausenderpunkt: 300.500 € -> "301".
const f0 = (v: number) => Math.round(v / 1000).toLocaleString('de-DE');

export default function KonsolidierungPage() {
  const t = useTranslations('forecastMonat');
  const locale = useLocale();
  const MONATS_KURZ = monKurz(locale);
  const jahr = new Date().getFullYear();

  const { data, isLoading, error } = useQuery({
    queryKey: ['kons-monatlich', jahr],
    queryFn: () => api.get<KonsMonat>(`/dashboard/konsolidierung-monatlich?jahr=${jahr}`),
  });

  const jj = data ? String(data.jahr).slice(2, 4) : '';
  const istMonate = useMemo(() => (data ? data.monate.filter((p) => monatNr(p) < data.restAbMonat) : []), [data]);
  const fcMonate = useMemo(() => (data ? data.monate.filter((p) => monatNr(p) >= data.restAbMonat) : []), [data]);

  // Kennzahlen je Zeile (Produktgruppe / P&L-Zeile): identische Logik wie die Forecast-Monatsansicht.
  const metrik = (z: { istMonate: Record<string, number>; forecastMonate: Record<string, number>; budgetMonate: Record<string, number> }) => {
    const summeActual = istMonate.reduce((s, p) => s + (z.istMonate[p] ?? 0), 0);
    const summeForecast = fcMonate.reduce((s, p) => s + (z.forecastMonate[p] ?? 0), 0);
    const bud = (data?.monate ?? []).reduce((s, p) => s + (z.budgetMonate[p] ?? 0), 0);
    const budRest = fcMonate.reduce((s, p) => s + (z.budgetMonate[p] ?? 0), 0);
    const actBud = summeActual + budRest;
    const actFc = summeActual + summeForecast;
    return { summeActual, summeForecast, bud, actBud, actFc, dBudActBud: actBud - bud, dBudActFc: actFc - bud };
  };

  // Summenzeile "Umsatz" über alle Produktgruppen.
  const totals = useMemo(() => {
    if (!data) return null;
    const acc = {
      ist: Object.fromEntries(istMonate.map((p) => [p, 0])) as Record<string, number>,
      fc: Object.fromEntries(fcMonate.map((p) => [p, 0])) as Record<string, number>,
      summeActual: 0,
      summeForecast: 0,
      bud: 0,
      actBud: 0,
      actFc: 0,
      dBudActBud: 0,
      dBudActFc: 0,
    };
    for (const z of data.zeilen) {
      for (const p of istMonate) acc.ist[p] += z.istMonate[p] ?? 0;
      for (const p of fcMonate) acc.fc[p] += z.forecastMonate[p] ?? 0;
      const m = metrik(z);
      acc.summeActual += m.summeActual;
      acc.summeForecast += m.summeForecast;
      acc.bud += m.bud;
      acc.actBud += m.actBud;
      acc.actFc += m.actFc;
      acc.dBudActBud += m.dBudActBud;
      acc.dBudActFc += m.dBudActFc;
    }
    return acc;
  }, [data, istMonate, fcMonate]);

  const delta = (v: number) => <span className={v >= 0 ? 'text-ez-ampelGruen' : 'text-ez-ampelRot'}>{f0(v)}</span>;

  const [exportBusy, setExportBusy] = useState(false);
  const [exportFehler, setExportFehler] = useState('');
  const exportExcel = async () => {
    setExportBusy(true);
    setExportFehler('');
    try {
      await downloadDatei(`/export/konsolidierung-monatlich?jahr=${jahr}`, 'POST', `konsolidierung-monatlich-${jahr}.xlsx`);
    } catch (e) {
      setExportFehler((e as Error).message);
    } finally {
      setExportBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ez-primary">Konsolidierung {jahr} — Monatssicht</h1>
          <p className="text-sm text-gray-500">
            Umsatz je Produktgruppe über alle Regionen. Abgeschlossene Monate = <b>Actual</b>, offene Monate ={' '}
            <b>Forecast</b>. Werte in <b>kEUR</b>.
          </p>
          <p className="mt-1 text-sm text-ez-primary">
            🔎 <b>Drilldown:</b> Auf einen <b>Produktgruppen-Namen</b> (linke Spalte) oder einen <b>Ist-Monatswert</b> klicken, um zu den zugrunde liegenden Rohdaten-Buchungen zu springen.
          </p>
        </div>
        <div className="text-right">
          <Button onClick={exportExcel} disabled={exportBusy || !data}>
            {exportBusy ? t('exportErzeuge') : t('exportExcel')}
          </Button>
          {exportFehler && <p className="mt-1 text-xs text-ez-accent">✗ {exportFehler}</p>}
        </div>
      </div>

      {isLoading && <p className="text-gray-500">Lädt…</p>}
      {error && !data && <p className="text-ez-accent">{(error as Error).message}</p>}

      {data && totals && (
        <Card className="space-y-3 p-4">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse whitespace-nowrap text-xs tabular-nums">
              <thead>
                <tr className="text-gray-600">
                  <th className="sticky left-0 z-10 bg-white" />
                  <th colSpan={istMonate.length + 1} className="border border-gray-300 bg-gray-100 p-1 text-center font-semibold">
                    {t('actual')}
                  </th>
                  <th colSpan={fcMonate.length + 1} className="border border-gray-300 bg-yellow-50 p-1 text-center font-semibold">
                    {t('forecast')}
                  </th>
                  <th colSpan={5} className="border border-gray-300 bg-purple-50 p-1 text-center font-semibold">
                    {t('fy', { jj })}
                  </th>
                </tr>
                <tr className="bg-gray-50 text-gray-500">
                  <th className="sticky left-0 z-10 w-[150px] bg-gray-50 p-1 text-left">{t('spalteProduktgruppe')}</th>
                  {istMonate.map((p) => (
                    <th key={p} className="border-l border-gray-200 p-1 text-right">{`${MONATS_KURZ[monatNr(p) - 1]}. ${jj}`}</th>
                  ))}
                  <th className="border-l border-gray-300 bg-gray-100 p-1 text-right font-semibold">{t('sumActual')}</th>
                  {fcMonate.map((p) => (
                    <th key={p} className="border-l border-gray-200 bg-yellow-50 p-1 text-right">{`${MONATS_KURZ[monatNr(p) - 1]}. ${jj}`}</th>
                  ))}
                  <th className="border-l border-gray-300 bg-yellow-100 p-1 text-right font-semibold">{t('sumForecast')}</th>
                  <th className="border-l border-gray-300 bg-purple-50 p-1 text-right">{t('bud')}</th>
                  <th className="p-1 text-right">{t('actualBud')}</th>
                  <th className="p-1 text-right">{t('actualFc')}</th>
                  <th className="p-1 text-right">{t('deltaBudActBud')}</th>
                  <th className="p-1 text-right">{t('deltaBudActFc')}</th>
                </tr>
              </thead>
              <tbody>
                {data.zeilen.map((z) => {
                  const m = metrik(z);
                  return (
                    <tr key={z.e1Id} className="border-t border-gray-100">
                      <td className="sticky left-0 z-10 w-[150px] bg-white p-1 font-semibold">
                        <Link href={`/daten?tab=ist&jahr=${jahr}&e1Id=${z.e1Id}`} className="text-ez-primary underline decoration-dotted underline-offset-2 hover:decoration-solid" title={t('zuRohdaten')}>
                          {z.bezeichnung}
                        </Link>
                      </td>
                      {istMonate.map((p) => (
                        <td key={p} className="border-l border-gray-100 p-1 text-right text-gray-500">
                          {z.istMonate[p] ? (
                            <Link href={`/daten?tab=ist&jahr=${jahr}&e1Id=${z.e1Id}&monat=${monatNr(p)}`} className="hover:text-ez-primary hover:underline" title={t('zuRohdaten')}>
                              {f0(z.istMonate[p])}
                            </Link>
                          ) : (
                            ''
                          )}
                        </td>
                      ))}
                      <td className="border-l border-gray-300 bg-gray-50 p-1 text-right font-medium">{f0(m.summeActual)}</td>
                      {fcMonate.map((p) => (
                        <td key={p} className="border-l border-gray-100 bg-yellow-50/40 p-1 text-right">
                          {z.forecastMonate[p] ? f0(z.forecastMonate[p]) : ''}
                        </td>
                      ))}
                      <td className="border-l border-gray-300 bg-yellow-50 p-1 text-right font-medium">{f0(m.summeForecast)}</td>
                      <td className="border-l border-gray-300 bg-purple-50/40 p-1 text-right text-gray-500">{f0(m.bud)}</td>
                      <td className="p-1 text-right text-gray-500">{f0(m.actBud)}</td>
                      <td className="p-1 text-right font-medium">{f0(m.actFc)}</td>
                      <td className="p-1 text-right">{delta(m.dBudActBud)}</td>
                      <td className="p-1 text-right">{delta(m.dBudActFc)}</td>
                    </tr>
                  );
                })}
                <tr className="border-t-2 border-gray-400 bg-gray-50 font-bold">
                  <td className="sticky left-0 z-10 bg-gray-50 p-1">Umsatz</td>
                  {istMonate.map((p) => (
                    <td key={p} className="border-l border-gray-200 p-1 text-right">{f0(totals.ist[p])}</td>
                  ))}
                  <td className="border-l border-gray-300 p-1 text-right">{f0(totals.summeActual)}</td>
                  {fcMonate.map((p) => (
                    <td key={p} className="border-l border-gray-200 p-1 text-right">{f0(totals.fc[p])}</td>
                  ))}
                  <td className="border-l border-gray-300 p-1 text-right">{f0(totals.summeForecast)}</td>
                  <td className="border-l border-gray-300 p-1 text-right">{f0(totals.bud)}</td>
                  <td className="p-1 text-right">{f0(totals.actBud)}</td>
                  <td className="p-1 text-right">{f0(totals.actFc)}</td>
                  <td className="p-1 text-right">{delta(totals.dBudActBud)}</td>
                  <td className="p-1 text-right">{delta(totals.dBudActFc)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-400">Werte in kEUR · Stichtag {data.stichtag}</p>
          <QuellHinweis arten={['ist', 'budget']} />
        </Card>
      )}

      {data?.guvPanel && (
        <Card className="space-y-2 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-ez-primary">
              GuV — Controlling (YTD Jan–{MONATS_KURZ[data.guvPanel.stichtagMonat - 1]} {data.jahr})
            </h2>
            <span className="text-xs text-gray-400">Detaillierte Controlling-P&amp;L · Werte in kEUR</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs tabular-nums">
              <thead>
                <tr className="border-b border-gray-200 text-gray-500">
                  <th className="py-1 text-left">Position</th>
                  <th className="py-1 text-right">IST</th>
                  <th className="py-1 text-right">Vorjahr</th>
                  <th className="py-1 text-right">Δ VJ</th>
                  <th className="py-1 text-right">Budget</th>
                  <th className="py-1 text-right">Δ BUD</th>
                </tr>
              </thead>
              <tbody>
                {data.guvPanel.positionen.map((p) => {
                  const sub = p.ebene === 0;
                  const stark = p.key === 'OPERATING_RESULT' || p.key === 'EBIT';
                  return (
                    <tr key={p.key} className={`border-t border-gray-100 ${sub ? 'font-semibold' : 'text-gray-600'} ${stark ? 'border-t-2 border-gray-400' : ''} ${p.key === 'OPERATING_RESULT' ? 'text-ez-primary' : ''}`}>
                      <td className={`py-1 ${sub ? '' : 'pl-3'}`}>{p.label}</td>
                      <td className="py-1 text-right">{f0(p.ist)}</td>
                      <td className="py-1 text-right text-gray-500">{f0(p.py)}</td>
                      <td className="py-1 text-right">{delta(p.ist - p.py)}</td>
                      <td className="py-1 text-right text-gray-500">{f0(p.bud)}</td>
                      <td className="py-1 text-right">{delta(p.ist - p.bud)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-400">
            Authoritative Controlling-GuV (Jahr-zu-Datum). Δ = IST − Vergleich. Ergänzt die Monatssicht oben (Ist-COGS &amp; Operating result decken sich). Monatlicher Import: „Import → GuV (Controlling)".
          </p>
        </Card>
      )}
    </div>
  );
}
