'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { berechneGuvForecast } from '@forecast/shared';
import { api, downloadDatei } from '@/lib/api';
import { useAuth } from '@/lib/auth';
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
interface GuvFMonat {
  monat: number;
  quelle: 'IST' | 'FORECAST';
  editierbar: boolean;
  istVorhanden: boolean;
  revenueEur: number | null;
  grossMarginPct: number | null;
  grossMarginEur: number | null;
  cogsEur: number | null;
  otherCostsEur: number | null;
  operatingResultEur: number | null;
  fte: number | null;
  revenueProFteEur: number | null;
}
interface GuvFIstYtd {
  bisMonat: number;
  revenueEur: number;
  grossMarginPct: number | null;
  grossMarginEur: number | null;
  otherCostsEur: number;
  operatingResultEur: number | null;
}
interface GuvFFy {
  revenueEur: number;
  grossMarginPct: number | null;
  grossMarginEur: number | null;
  cogsEur: number | null;
  otherCostsEur: number;
  operatingResultEur: number | null;
  fte: number | null;
  revenueProFteEur: number | null;
}
interface GuvForecast {
  istBoundary: number;
  letzterGuvMonat: number | null;
  planungVollstaendig: boolean;
  istYtd: GuvFIstYtd | null;
  monate: GuvFMonat[];
  fy: GuvFFy;
}
interface KonsMonat {
  jahr: number;
  stichtag: string;
  monate: string[];
  restAbMonat: number; // Monate mit Nummer >= restAbMonat sind Forecast, < sind Ist
  zeilen: Zeile[];
  guvPanel: GuvPanel | null;
  guvForecast: GuvForecast | null;
}

const monatNr = (p: string) => Number(p.slice(5));
// Anzeige in kEUR (Tausend EUR), ganzzahlig, mit Tausenderpunkt: 300.500 € -> "301".
const f0 = (v: number) => Math.round(v / 1000).toLocaleString('de-DE');
const f0n = (v: number | null) => (v == null ? '' : f0(v));
const pctFmt = (v: number | null) => (v == null ? '' : `${v.toFixed(1)} %`);
const fteFmt = (v: number | null) => (v == null ? '' : v.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const parseNum = (s?: string): number | null => {
  if (s == null || s.trim() === '') return null;
  const n = Number(s.replace(/\./g, '').replace(',', '.').replace(/\s/g, ''));
  return Number.isFinite(n) ? n : null;
};

export default function KonsolidierungPage() {
  const t = useTranslations('forecastMonat');
  const locale = useLocale();
  const MONATS_KURZ = monKurz(locale);
  const jahr = new Date().getFullYear();
  const { user } = useAuth();
  const darfPlanen = !!user && (user.rolle === 'BU_LEITER' || user.rolle === 'ADMIN');

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

      {data?.guvForecast && <GuvPlanung jahr={jahr} guvF={data.guvForecast} monatsKurz={MONATS_KURZ} jj={jj} darfPlanen={darfPlanen} />}

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
            Authoritative Controlling-GuV (Jahr-zu-Datum). Δ = IST − Vergleich. Ergänzt die G&amp;V-Planung oben (Ist-Marge &amp; Operating result decken sich). Monatlicher Import: „Import → GuV (Controlling)".
          </p>
        </Card>
      )}
    </div>
  );
}

// ─────────────────────────── G&V-Planung (Ertragsvorschau) ───────────────────────────
const SEEDS_ZEILEN = ['Scrap Implant (Quantity)', 'Scrap Implant (%)', 'Production Line 1', 'Sales Line 1', 'Production Line 2', 'Sales Line 2', 'Scrap Ru-106 (Quantity)', 'Scrap Ru-106 (%)', 'Production Ru-106', 'Sales Ru-106'];

function GuvPlanung({ jahr, guvF, monatsKurz, jj, darfPlanen }: { jahr: number; guvF: GuvForecast; monatsKurz: string[]; jj: string; darfPlanen: boolean }) {
  const istCols = guvF.monate.filter((m) => m.quelle === 'IST');
  const fcCols = guvF.monate.filter((m) => m.quelle === 'FORECAST');
  const byMonat = useMemo(() => new Map(guvF.monate.map((m) => [m.monat, m])), [guvF]);

  // Editierbare Eingaben (roher Text je Feld) — Live-Recalc lokal, Persistenz onBlur.
  const [feld, setFeld] = useState<Record<string, string>>({});
  const [seedsOffen, setSeedsOffen] = useState(false);
  const [planFehler, setPlanFehler] = useState('');

  // Initialbelegung aus Serverdaten (bei Jahres-/Datenwechsel neu).
  useEffect(() => {
    const init: Record<string, string> = {};
    for (const m of guvF.monate) {
      if (m.fte != null) init[`${m.monat}:fte`] = fteFmt(m.fte);
      if (m.quelle === 'FORECAST') {
        if (m.grossMarginPct != null) init[`${m.monat}:gm`] = m.grossMarginPct.toLocaleString('de-DE', { maximumFractionDigits: 3 });
        if (m.otherCostsEur != null) init[`${m.monat}:oc`] = Math.round(Math.abs(m.otherCostsEur) / 1000).toLocaleString('de-DE');
      }
    }
    setFeld(init);
  }, [jahr, guvF]);

  const gmPctFc = (m: number) => parseNum(feld[`${m}:gm`]);
  const ocKeurFc = (m: number) => parseNum(feld[`${m}:oc`]);
  const ocEurFc = (m: number) => {
    const k = ocKeurFc(m);
    return k == null ? null : -Math.abs(k) * 1000;
  };
  const fteOf = (m: number) => parseNum(feld[`${m}:fte`]);
  const revOf = (m: number) => byMonat.get(m)?.revenueEur ?? 0;
  const fcCalc = (m: number) => berechneGuvForecast({ revenueEur: revOf(m), grossMarginPct: gmPctFc(m), otherCostsEur: ocEurFc(m) });

  const persist = async (monat: number, body: Record<string, number | null>) => {
    if (!darfPlanen) return;
    setPlanFehler('');
    try {
      await api.patch(`/pl-kosten/guv-plan?jahr=${jahr}&monat=${monat}`, body);
    } catch (e) {
      setPlanFehler((e as Error).message);
    }
  };

  // Live-FY = Ist-YTD (aus GuV-Marge) + geplanter Rest.
  const fy = useMemo(() => {
    const fyRevenue = guvF.fy.revenueEur;
    const istGm = guvF.istYtd?.grossMarginEur ?? null;
    const istOther = guvF.istYtd?.otherCostsEur ?? 0;
    const fcGm = fcCols.reduce((s, c) => s + (fcCalc(c.monat).grossMarginEur ?? 0), 0);
    const fcOther = fcCols.reduce((s, c) => s + (ocEurFc(c.monat) ?? 0), 0);
    const gm = istGm == null ? null : istGm + fcGm;
    const other = istOther + fcOther;
    const op = gm == null ? null : gm + other;
    const gmPct = gm != null && fyRevenue ? (gm / fyRevenue) * 100 : null;
    const cogs = gm == null ? null : gm - fyRevenue;
    const fteVals = guvF.monate.map((m) => fteOf(m.monat)).filter((v): v is number => v != null && v > 0);
    const fte = fteVals.length ? fteVals.reduce((s, v) => s + v, 0) / fteVals.length : null;
    const revPerFte = fte ? fyRevenue / fte : null;
    return { revenue: fyRevenue, gm, gmPct, cogs, other, op, fte, revPerFte };
  }, [feld, guvF]);

  // Zell-Eingabe (Zahl). `which` ∈ gm | oc | fte. persistKey = API-Feldname.
  const EditCell = ({ monat, which, persistKey, faktor = 1, suffix }: { monat: number; which: string; persistKey: string; faktor?: number; suffix?: string }) => {
    const key = `${monat}:${which}`;
    if (!darfPlanen) {
      // Nur-Lese-Anzeige für Nicht-Planer.
      const raw = feld[key];
      return <span className="text-gray-500">{raw ? `${raw}${suffix ?? ''}` : ''}</span>;
    }
    return (
      <input
        inputMode="decimal"
        value={feld[key] ?? ''}
        onChange={(e) => setFeld((f) => ({ ...f, [key]: e.target.value }))}
        onBlur={() => {
          const n = parseNum(feld[key]);
          persist(monat, { [persistKey]: n == null ? null : n * faktor });
        }}
        className="w-14 rounded border border-gray-200 bg-white px-1 py-0.5 text-right text-xs focus:border-ez-primary focus:outline-none focus:ring-1 focus:ring-ez-primary"
        placeholder="–"
      />
    );
  };

  const nCols = 1 + istCols.length + 1 + fcCols.length + 1;
  const tdNum = 'border-l border-gray-100 p-1 text-right';

  return (
    <Card className="space-y-2 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ez-primary">G&amp;V-Planung {jahr} — Ertragsvorschau (Operating Result)</h2>
        <span className="text-xs text-gray-400">Ist 1:1 aus GuV · Forecast: Tool-Umsatz × geplante GM % · Werte in kEUR</span>
      </div>
      {darfPlanen ? (
        <p className="text-xs text-gray-500">
          Trage in den <b>offenen Monaten</b> die <b>Gross Margin %</b> und die <b>Sonstigen Kosten</b> (kEUR) ein sowie die <b>FTE</b> je Monat — Gross Margin absolut, COGS und <b>Operating Result</b> werden live berechnet.
        </p>
      ) : (
        <p className="text-xs text-gray-500">Nur die BU-/Bereichsleitung kann die Forecast-Annahmen (GM %, Sonstige Kosten, FTE) bearbeiten.</p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse whitespace-nowrap text-xs tabular-nums">
          <thead>
            <tr className="text-gray-600">
              <th className="sticky left-0 z-10 bg-white" />
              <th colSpan={istCols.length + 1} className="border border-gray-300 bg-gray-100 p-1 text-center font-semibold">
                Actual (Ist)
              </th>
              <th colSpan={fcCols.length} className="border border-gray-300 bg-yellow-50 p-1 text-center font-semibold">
                Forecast (Planung)
              </th>
              <th className="border border-gray-300 bg-purple-50 p-1 text-center font-semibold">FY {jj}</th>
            </tr>
            <tr className="bg-gray-50 text-gray-500">
              <th className="sticky left-0 z-10 w-[150px] bg-gray-50 p-1 text-left">Kennzahl</th>
              {istCols.map((c) => (
                <th key={c.monat} className="border-l border-gray-200 p-1 text-right">{`${monatsKurz[c.monat - 1]}. ${jj}`}</th>
              ))}
              <th className="border-l border-gray-300 bg-gray-100 p-1 text-right font-semibold">∑ YTD</th>
              {fcCols.map((c) => (
                <th key={c.monat} className="border-l border-gray-200 bg-yellow-50 p-1 text-right">{`${monatsKurz[c.monat - 1]}. ${jj}`}</th>
              ))}
              <th className="border-l border-gray-300 bg-purple-50 p-1 text-right font-semibold">Projektion</th>
            </tr>
          </thead>
          <tbody>
            {/* Revenue */}
            <tr className="border-t border-gray-100 font-medium">
              <td className="sticky left-0 z-10 bg-white p-1">Umsatz</td>
              {istCols.map((c) => (
                <td key={c.monat} className={`${tdNum} text-gray-500`}>{f0n(c.revenueEur)}</td>
              ))}
              <td className="border-l border-gray-300 bg-gray-50 p-1 text-right">{f0n(guvF.istYtd?.revenueEur ?? null)}</td>
              {fcCols.map((c) => (
                <td key={c.monat} className={`${tdNum} bg-yellow-50/40`}>{f0n(c.revenueEur)}</td>
              ))}
              <td className="border-l border-gray-300 bg-purple-50/40 p-1 text-right">{f0(fy.revenue)}</td>
            </tr>
            {/* COGS */}
            <tr className="border-t border-gray-100 text-gray-600">
              <td className="sticky left-0 z-10 bg-white p-1 pl-3">COGS</td>
              {istCols.map((c) => (
                <td key={c.monat} className={tdNum}>{f0n(c.cogsEur)}</td>
              ))}
              <td className="border-l border-gray-300 bg-gray-50 p-1 text-right">{f0n(guvF.istYtd?.grossMarginEur != null ? guvF.istYtd.grossMarginEur - guvF.istYtd.revenueEur : null)}</td>
              {fcCols.map((c) => (
                <td key={c.monat} className={`${tdNum} bg-yellow-50/40`}>{f0n(fcCalc(c.monat).cogsEur)}</td>
              ))}
              <td className="border-l border-gray-300 bg-purple-50/40 p-1 text-right">{f0n(fy.cogs)}</td>
            </tr>
            {/* Gross Margin */}
            <tr className="border-t border-gray-100 font-medium">
              <td className="sticky left-0 z-10 bg-white p-1">Gross Margin</td>
              {istCols.map((c) => (
                <td key={c.monat} className={tdNum}>{f0n(c.grossMarginEur)}</td>
              ))}
              <td className="border-l border-gray-300 bg-gray-50 p-1 text-right">{f0n(guvF.istYtd?.grossMarginEur ?? null)}</td>
              {fcCols.map((c) => (
                <td key={c.monat} className={`${tdNum} bg-yellow-50/40`}>{f0n(fcCalc(c.monat).grossMarginEur)}</td>
              ))}
              <td className="border-l border-gray-300 bg-purple-50/40 p-1 text-right">{f0n(fy.gm)}</td>
            </tr>
            {/* Gross Margin % (editierbar in Forecast) */}
            <tr className="border-t border-gray-100 text-gray-600">
              <td className="sticky left-0 z-10 bg-white p-1 pl-3">Gross Margin %</td>
              {istCols.map((c) => (
                <td key={c.monat} className={tdNum}>{pctFmt(c.grossMarginPct)}</td>
              ))}
              <td className="border-l border-gray-300 bg-gray-50 p-1 text-right">{pctFmt(guvF.istYtd?.grossMarginPct ?? null)}</td>
              {fcCols.map((c) => (
                <td key={c.monat} className="border-l border-gray-100 bg-yellow-50/40 p-1 text-right">
                  <EditCell monat={c.monat} which="gm" persistKey="grossMarginPct" suffix=" %" />
                </td>
              ))}
              <td className="border-l border-gray-300 bg-purple-50/40 p-1 text-right">{pctFmt(fy.gmPct)}</td>
            </tr>
            {/* Other Costs (editierbar in Forecast) */}
            <tr className="border-t border-gray-100 text-gray-600">
              <td className="sticky left-0 z-10 bg-white p-1 pl-3">Sonstige Kosten</td>
              {istCols.map((c) => (
                <td key={c.monat} className={tdNum}>{f0n(c.otherCostsEur)}</td>
              ))}
              <td className="border-l border-gray-300 bg-gray-50 p-1 text-right">{f0n(guvF.istYtd?.otherCostsEur ?? null)}</td>
              {fcCols.map((c) => (
                <td key={c.monat} className="border-l border-gray-100 bg-yellow-50/40 p-1 text-right">
                  <EditCell monat={c.monat} which="oc" persistKey="otherCostsKeur" suffix="" />
                </td>
              ))}
              <td className="border-l border-gray-300 bg-purple-50/40 p-1 text-right">{f0n(fy.other)}</td>
            </tr>
            {/* Operating Result */}
            <tr className="border-t-2 border-gray-400 bg-gray-50 font-bold text-ez-primary">
              <td className="sticky left-0 z-10 bg-gray-50 p-1">Operating Result</td>
              {istCols.map((c) => (
                <td key={c.monat} className="border-l border-gray-200 p-1 text-right">{f0n(c.operatingResultEur)}</td>
              ))}
              <td className="border-l border-gray-300 p-1 text-right">{f0n(guvF.istYtd?.operatingResultEur ?? null)}</td>
              {fcCols.map((c) => (
                <td key={c.monat} className="border-l border-gray-200 p-1 text-right">{f0n(fcCalc(c.monat).operatingResultEur)}</td>
              ))}
              <td className="border-l border-gray-300 p-1 text-right">{f0n(fy.op)}</td>
            </tr>
            {/* Seeds — auf-/zuklappbar, aktuell nicht befüllbar */}
            <tr className="border-t border-gray-100">
              <td colSpan={nCols} className="p-1">
                <button type="button" onClick={() => setSeedsOffen((o) => !o)} className="text-xs text-gray-500 hover:text-ez-primary">
                  {seedsOffen ? '▾' : '▸'} Mengen (Seeds) — aktuell nicht befüllbar
                </button>
              </td>
            </tr>
            {seedsOffen &&
              SEEDS_ZEILEN.map((label) => (
                <tr key={label} className="border-t border-gray-50 text-gray-400">
                  <td className="sticky left-0 z-10 bg-white p-1 pl-3">{label}</td>
                  {istCols.map((c) => (
                    <td key={c.monat} className={tdNum} />
                  ))}
                  <td className="border-l border-gray-300 bg-gray-50" />
                  {fcCols.map((c) => (
                    <td key={c.monat} className="border-l border-gray-100 bg-yellow-50/40" />
                  ))}
                  <td className="border-l border-gray-300 bg-purple-50/40" />
                </tr>
              ))}
            {/* FTE (editierbar alle Monate) */}
            <tr className="border-t-2 border-gray-300 text-gray-600">
              <td className="sticky left-0 z-10 bg-white p-1">FTE</td>
              {istCols.map((c) => (
                <td key={c.monat} className="border-l border-gray-100 p-1 text-right">
                  <EditCell monat={c.monat} which="fte" persistKey="fteAnzahl" suffix="" />
                </td>
              ))}
              <td className="border-l border-gray-300 bg-gray-50 p-1 text-right">{fteFmt(fy.fte)}</td>
              {fcCols.map((c) => (
                <td key={c.monat} className="border-l border-gray-100 bg-yellow-50/40 p-1 text-right">
                  <EditCell monat={c.monat} which="fte" persistKey="fteAnzahl" suffix="" />
                </td>
              ))}
              <td className="border-l border-gray-300 bg-purple-50/40 p-1 text-right">{fteFmt(fy.fte)}</td>
            </tr>
            {/* Revenue / FTE (annualisiert) */}
            <tr className="border-t border-gray-100 text-gray-600">
              <td className="sticky left-0 z-10 bg-white p-1 pl-3">Revenue / FTE (annual.)</td>
              {istCols.map((c) => {
                const fte = fteOf(c.monat);
                return (
                  <td key={c.monat} className={tdNum}>
                    {fte && c.revenueEur != null ? f0((c.revenueEur * 12) / fte) : ''}
                  </td>
                );
              })}
              <td className="border-l border-gray-300 bg-gray-50 p-1 text-right">{f0n(fy.revPerFte)}</td>
              {fcCols.map((c) => {
                const fte = fteOf(c.monat);
                return (
                  <td key={c.monat} className={`${tdNum} bg-yellow-50/40`}>
                    {fte && c.revenueEur != null ? f0((c.revenueEur * 12) / fte) : ''}
                  </td>
                );
              })}
              <td className="border-l border-gray-300 bg-purple-50/40 p-1 text-right">{f0n(fy.revPerFte)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {planFehler && <p className="text-xs text-ez-accent">✗ {planFehler}</p>}
      <p className="text-xs text-gray-400">
        Abgeschlossene Monate: 1:1 aus der Controlling-GuV (Operating Result deckt sich mit dem GuV-Panel). Offene Monate: Tool-Forecast-Umsatz × geplante GM % − Sonstige Kosten.
        {guvF.letzterGuvMonat == null
          ? ' Noch keine GuV importiert — Ist-Kennzahlen erscheinen nach dem GuV-Import.'
          : ` Die einzelnen Ist-Monatsspalten füllen sich, sobald die Monats-GuVs (Jan…${monatsKurz[guvF.letzterGuvMonat - 1]}) vorliegen; die ∑-YTD-Spalte zeigt bereits den aktuellen GuV-Stand.`}
        {' '}FY = Ist-YTD + geplanter Rest{guvF.planungVollstaendig ? '' : ' (Planung noch unvollständig)'}.
      </p>
    </Card>
  );
}
