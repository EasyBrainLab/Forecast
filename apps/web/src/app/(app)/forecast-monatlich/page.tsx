'use client';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { api, downloadDatei } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, Card } from '@/components/ui';
import { PeriodenAktionen } from '@/components/perioden-aktionen';
import { monKurz } from '@/lib/monate';

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
  budgetMonate: Record<string, number>;
  istMonate: Record<string, number>;
  monatswerteRest: Record<string, { eur: number; units?: number | null; kommentar?: string | null }>;
}
interface Fremdaenderung {
  am: string;
  von: string | null;
  begruendung: string | null;
  quittiertAm: string | null;
}
interface Matrix {
  periode: string;
  regionCode: string;
  status: string;
  deadline: string;
  schwellwertProzent: number;
  monatsSchwellwertProzent: number;
  monate: string[];
  restAbMonat: number;
  zellen: Zelle[];
  fremdaenderung: Fremdaenderung | null;
}

const monatNr = (p: string) => Number(p.slice(5));
const ek = (landId: string, e1Id: string, p: string) => `${landId}|${e1Id}|${p}`;
// Anzeige in kEUR (Tausend EUR), ganzzahlig, mit Tausenderpunkt: 300.500 € -> "301", 1.209.500 € -> "1.210".
const f0 = (v: number) => Math.round(v / 1000).toLocaleString('de-DE');

// Statusfarbe für Zeitleisten-Punkt und Status-Pill (abgeschlossen=grün, offen=gelb, zurückgewiesen=rot, eingereicht=blau).
const statusDot = (s: string): string =>
  s === 'ABGESCHLOSSEN' ? 'bg-ez-ampelGruen' : s === 'OFFEN' ? 'bg-yellow-400' : s === 'ZURUECKGEWIESEN' ? 'bg-ez-ampelRot' : 'bg-ez-primary';
const statusPill = (s: string): string =>
  s === 'ABGESCHLOSSEN'
    ? 'bg-ez-ampelGruen/10 text-ez-ampelGruen'
    : s === 'OFFEN'
      ? 'bg-yellow-100 text-yellow-700'
      : s === 'ZURUECKGEWIESEN'
        ? 'bg-ez-accent/10 text-ez-accent'
        : 'bg-ez-primary/10 text-ez-primary';

export default function ForecastMonatlichPage() {
  const t = useTranslations('forecastMonat');
  const locale = useLocale();
  const MONATS_KURZ = monKurz(locale);
  const { user } = useAuth();
  const qc = useQueryClient();
  const [sel, setSel] = useState<{ periode: string; regionCode: string } | null>(null);
  const [edits, setEdits] = useState<Record<string, number>>({}); // key land|e1|periode -> EUR
  const [ueberBegr, setUeberBegr] = useState(''); // Pflicht-Begründung der Leitungs-Überschreibung

  const { data: perioden } = useQuery({ queryKey: ['meine'], queryFn: () => api.get<Periode[]>('/forecast/meine') });
  const aktiv = sel ?? (perioden && perioden[0] ? { periode: perioden[0].periode, regionCode: perioden[0].regionCode } : null);
  const { data: matrix } = useQuery({
    queryKey: ['matrix', aktiv?.periode, aktiv?.regionCode],
    queryFn: () => api.get<Matrix>(`/forecast/${aktiv!.periode}/${aktiv!.regionCode}/matrix`),
    enabled: !!aktiv,
  });

  const rolle = user?.rolle;
  const istLeitung = rolle === 'VERTRIEBSLEITER' || rolle === 'BU_LEITER';
  // AGM bearbeitet einen offenen Forecast; die Leitung darf offene Forecasts mitbearbeiten (Entwurf,
  // der AGM reicht final ein) und einen bereits fertiggemeldeten überschreiben.
  const agmEditierbar = !!matrix && matrix.status === 'OFFEN' && rolle === 'AGM';
  const leitungBearbeitetOffen = !!matrix && matrix.status === 'OFFEN' && istLeitung;
  const leitungUeberschreibt = !!matrix && istLeitung && (matrix.status === 'BESTAETIGT' || matrix.status === 'ANGEPASST');
  const offenBearbeitbar = agmEditierbar || leitungBearbeitetOffen;
  const editierbar = offenBearbeitbar || leitungUeberschreibt;
  // Offene Fremdüberschreibung, die der AGM dieser Periode noch zur Kenntnis nehmen muss.
  const offeneKenntnisnahme = !!matrix?.fremdaenderung && !matrix.fremdaenderung.quittiertAm && rolle === 'AGM';
  const schwelle = matrix?.monatsSchwellwertProzent ?? 5;
  const jj = matrix ? matrix.periode.slice(2, 4) : '';
  const istMonate = useMemo(() => (matrix ? matrix.monate.filter((p) => monatNr(p) < matrix.restAbMonat) : []), [matrix]);
  const fcMonate = useMemo(() => (matrix ? matrix.monate.filter((p) => monatNr(p) >= matrix.restAbMonat) : []), [matrix]);

  // Forecast-Wert (voller EUR) eines offenen Monats unter Berücksichtigung lokaler Edits (Edits sind in kEUR erfasst).
  const fcEur = (z: Zelle, p: string): number => {
    const key = ek(z.landId, z.e1Id, p);
    if (edits[key] !== undefined) return edits[key] * 1000;
    return z.monatswerteRest[p]?.eur ?? z.budgetMonate[p] ?? 0;
  };
  const verletzt = (z: Zelle, p: string): boolean => {
    const b = z.budgetMonate[p] ?? 0;
    const f = fcEur(z, p);
    if (b === 0) return f !== 0;
    return Math.abs((f - b) / Math.abs(b)) * 100 > schwelle;
  };

  // Kennzahlen je Zelle (gruppiert).
  const metrik = (z: Zelle) => {
    const summeActual = istMonate.reduce((s, p) => s + (z.istMonate[p] ?? 0), 0);
    const summeForecast = fcMonate.reduce((s, p) => s + fcEur(z, p), 0);
    const bud = matrix!.monate.reduce((s, p) => s + (z.budgetMonate[p] ?? 0), 0);
    const budRest = fcMonate.reduce((s, p) => s + (z.budgetMonate[p] ?? 0), 0);
    const actBud = summeActual + budRest;
    const actFc = summeActual + summeForecast;
    return { summeActual, summeForecast, bud, actBud, actFc, dBudActBud: actBud - bud, dBudActFc: actFc - bud };
  };

  const editierteZellen = useMemo(() => {
    const set = new Set<string>();
    for (const key of Object.keys(edits)) {
      const [land, e1] = key.split('|');
      set.add(`${land}|${e1}`);
    }
    return set;
  }, [edits]);

  // Optionale kurze Stellungnahme beim finalen Bestätigen (keine Pflicht).
  const [stellungnahme, setStellungnahme] = useState('');
  const bestaetigen = useMutation({
    mutationFn: () => api.post(`/forecast/${aktiv!.periode}/${aktiv!.regionCode}/bestaetigen`, { stellungnahme: stellungnahme.trim() || undefined }),
    onSuccess: () => {
      setStellungnahme('');
      qc.invalidateQueries();
    },
  });

  // Baut die geänderten Zellen (land|e1) mit ihren Forecast-Monatswerten; bestehende Kommentare bleiben erhalten.
  const baueZellen = () =>
    matrix!.zellen
      .filter((z) => editierteZellen.has(`${z.landId}|${z.e1Id}`))
      .map((z) => {
        const mw: Record<string, { eur: number; units?: number | null; kommentar?: string | null }> = {};
        for (const p of fcMonate) {
          const komm = z.monatswerteRest[p]?.kommentar ?? '';
          mw[p] = { eur: fcEur(z, p), units: z.monatswerteRest[p]?.units ?? null, ...(komm ? { kommentar: komm } : {}) };
        }
        return { landId: z.landId, e1Id: z.e1Id, monatswerteRest: mw };
      });

  const anpassen = useMutation({
    mutationFn: () => api.post(`/forecast/${aktiv!.periode}/${aktiv!.regionCode}/anpassen`, { monatsModus: true, zellen: baueZellen() }),
    onSuccess: () => {
      setEdits({});
      qc.invalidateQueries();
    },
  });

  // Leitung überschreibt einen fertiggemeldeten Forecast (Pflicht-Begründung, AGM wird informiert).
  const ueberschreiben = useMutation({
    mutationFn: () => api.post(`/forecast/${aktiv!.periode}/${aktiv!.regionCode}/ueberschreiben`, { begruendung: ueberBegr.trim(), monatsModus: false, zellen: baueZellen() }),
    onSuccess: () => {
      setEdits({});
      setUeberBegr('');
      qc.invalidateQueries();
    },
  });

  // AGM nimmt eine Fremdüberschreibung zur Kenntnis.
  const quittieren = useMutation({
    mutationFn: () => api.post(`/forecast/${aktiv!.periode}/${aktiv!.regionCode}/quittieren`),
    onSuccess: () => qc.invalidateQueries(),
  });

  // Excel-Export der eigenen Forecast-Matrix (Monats-Archiv der Region/Periode).
  const [exportBusy, setExportBusy] = useState(false);
  const [exportFehler, setExportFehler] = useState('');
  const exportMatrix = async () => {
    if (!aktiv) return;
    setExportBusy(true);
    setExportFehler('');
    try {
      await downloadDatei(`/export/forecast-matrix?periode=${aktiv.periode}&regionCode=${aktiv.regionCode}`, 'GET', `forecast-${aktiv.regionCode}-${aktiv.periode}.xlsx`);
    } catch (e) {
      setExportFehler((e as Error).message);
    } finally {
      setExportBusy(false);
    }
  };

  // Sortierung E1 -> Land + Gruppen-Markierung (E1-Label nur in erster Zeile der Gruppe).
  const zeilen = useMemo(() => {
    if (!matrix) return [] as { z: Zelle; groupStart: boolean }[];
    const sorted = [...matrix.zellen].sort((a, b) => a.e1Name.localeCompare(b.e1Name) || a.landName.localeCompare(b.landName));
    return sorted.map((z, i) => ({ z, groupStart: i === 0 || sorted[i - 1].e1Id !== z.e1Id }));
  }, [matrix]);

  const totals = useMemo(() => {
    if (!matrix) return null;
    const t = {
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
    for (const z of matrix.zellen) {
      for (const p of istMonate) t.ist[p] += z.istMonate[p] ?? 0;
      for (const p of fcMonate) t.fc[p] += fcEur(z, p);
      const m = metrik(z);
      t.summeActual += m.summeActual;
      t.summeForecast += m.summeForecast;
      t.bud += m.bud;
      t.actBud += m.actBud;
      t.actFc += m.actFc;
      t.dBudActBud += m.dBudActBud;
      t.dBudActFc += m.dBudActFc;
    }
    return t;
  }, [matrix, edits]);

  const delta = (v: number) => <span className={v >= 0 ? 'text-ez-ampelGruen' : 'text-ez-ampelRot'}>{f0(v)}</span>;

  // Auswahl-Modell: Region-Umschalter + Monats-Zeitleiste statt flacher Perioden-Buttonliste.
  const regionen = useMemo(() => [...new Set((perioden ?? []).map((p) => p.regionCode))].sort(), [perioden]);
  const selRegion = aktiv?.regionCode ?? regionen[0] ?? null;
  const regionPerioden = useMemo(
    () => (perioden ?? []).filter((p) => p.regionCode === selRegion).sort((a, b) => monatNr(a.periode) - monatNr(b.periode)),
    [perioden, selRegion],
  );
  const handlungsbedarf = useMemo(() => {
    const acc = { offen: 0, eingereicht: 0, zurueck: 0 };
    for (const p of perioden ?? []) {
      if (p.status === 'OFFEN') acc.offen++;
      else if (p.status === 'BESTAETIGT' || p.status === 'ANGEPASST') acc.eingereicht++;
      else if (p.status === 'ZURUECKGEWIESEN') acc.zurueck++;
    }
    return acc;
  }, [perioden]);

  // Region wählen -> aktivste Periode dieser Region (offen bevorzugt, sonst zurückgewiesen, sonst jüngste).
  const waehleRegion = (r: string) => {
    const ps = (perioden ?? []).filter((p) => p.regionCode === r);
    const ziel =
      ps.find((p) => p.status === 'OFFEN') ??
      ps.find((p) => p.status === 'ZURUECKGEWIESEN') ??
      [...ps].sort((a, b) => monatNr(b.periode) - monatNr(a.periode))[0];
    if (ziel) {
      setSel({ periode: ziel.periode, regionCode: r });
      setEdits({});
    }
  };
  const waehlePeriode = (periode: string) => {
    if (!selRegion) return;
    setSel({ periode, regionCode: selRegion });
    setEdits({});
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-ez-primary">{t('titel')}</h1>
      <p className="text-sm text-gray-500">{t.rich('beschreibung', { schwelle, b: (chunks) => <b>{chunks}</b> })}</p>

      {perioden && perioden.length === 0 && (
        <Card>
          <p className="text-gray-600">{t('keinePeriode')}</p>
        </Card>
      )}

      {/* Handlungsbedarf-Leiste: bündelt regionsübergreifend, was zu tun ist. */}
      {perioden && perioden.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-3 text-sm">
          <span className="mr-1 font-semibold">{t('handlungsbedarf')}</span>
          {handlungsbedarf.offen > 0 && (
            <span className="inline-flex items-center gap-2 rounded-full bg-yellow-50 px-3 py-1 text-xs font-semibold text-yellow-700">
              <span className="h-2 w-2 rounded-full bg-yellow-400" />
              {t('chipOffen', { n: handlungsbedarf.offen })}
            </span>
          )}
          {handlungsbedarf.eingereicht > 0 && (
            <span className="inline-flex items-center gap-2 rounded-full bg-ez-primary/10 px-3 py-1 text-xs font-semibold text-ez-primary">
              <span className="h-2 w-2 rounded-full bg-ez-primary" />
              {t('chipEingereicht', { n: handlungsbedarf.eingereicht })}
            </span>
          )}
          {handlungsbedarf.zurueck > 0 && (
            <span className="inline-flex items-center gap-2 rounded-full bg-ez-accent/10 px-3 py-1 text-xs font-semibold text-ez-accent">
              <span className="h-2 w-2 rounded-full bg-ez-ampelRot" />
              {t('chipZurueck', { n: handlungsbedarf.zurueck })}
            </span>
          )}
          {handlungsbedarf.offen + handlungsbedarf.eingereicht + handlungsbedarf.zurueck === 0 && (
            <span className="text-gray-500">{t('keinHandlungsbedarf')}</span>
          )}
        </div>
      )}

      {/* Region-Umschalter (nur eigene Regionen) + Monats-Zeitleiste mit Statusfarben. */}
      {regionen.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">{t('region')}</span>
            <div className="inline-flex flex-wrap gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1">
              {regionen.map((r) => (
                <button
                  key={r}
                  onClick={() => waehleRegion(r)}
                  aria-pressed={selRegion === r}
                  className={`rounded-md px-3 py-1 text-sm font-semibold ${selRegion === r ? 'bg-white text-ez-primary shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-1 overflow-x-auto pb-1">
            {regionPerioden.map((p) => {
              const aktivMo = aktiv?.periode === p.periode && aktiv?.regionCode === selRegion;
              return (
                <button
                  key={p.id}
                  onClick={() => waehlePeriode(p.periode)}
                  aria-current={aktivMo}
                  title={p.status}
                  className={`min-w-[64px] rounded-lg border px-2 py-2 text-center transition-colors ${aktivMo ? 'border-ez-primary bg-ez-primary/5' : 'border-gray-200 bg-white hover:border-gray-300'}`}
                >
                  <div className={`text-xs font-semibold ${aktivMo ? 'text-ez-primary' : 'text-gray-600'}`}>
                    {MONATS_KURZ[monatNr(p.periode) - 1]}. {p.periode.slice(2, 4)}
                  </div>
                  <span className={`mx-auto mt-1.5 block h-2 w-2 rounded-full ${statusDot(p.status)}`} />
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-3 text-[11px] text-gray-500">
            <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-ez-ampelGruen" />{t('legAbgeschlossen')}</span>
            <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-yellow-400" />{t('legOffen')}</span>
            <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-ez-primary" />{t('legEingereicht')}</span>
            <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-ez-ampelRot" />{t('legZurueck')}</span>
          </div>
        </div>
      )}

      {matrix && totals && (
        <Card className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="font-semibold">
                {matrix.regionCode} · {matrix.periode}
              </span>
              <span className={`ml-2 rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusPill(matrix.status)}`}>{matrix.status}</span>
              <span className="ml-2 text-xs text-gray-400">{t('monatsSchwellwert', { schwelle })}</span>
            </div>
            <div className="flex flex-wrap items-start gap-2">
              <div className="flex flex-col items-start">
                <Button variant="ghost" onClick={exportMatrix} disabled={exportBusy}>
                  {exportBusy ? t('exportErzeuge') : t('exportExcel')}
                </Button>
                {exportFehler && <span className="mt-1 text-xs text-ez-accent">✗ {exportFehler}</span>}
              </div>
              <PeriodenAktionen periode={matrix.periode} regionCode={matrix.regionCode} status={matrix.status} />
            </div>
          </div>

          {/* AGM: offene Fremdüberschreibung durch die Leitung zur Kenntnis nehmen. */}
          {offeneKenntnisnahme && matrix.fremdaenderung && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ez-accent/40 bg-ez-accent/5 p-3">
              <div className="text-sm">
                <p className="font-semibold text-ez-accent">{t('fremdBannerTitel')}</p>
                <p className="text-gray-600">
                  {t('fremdBannerText', { von: matrix.fremdaenderung.von ?? '—', datum: new Date(matrix.fremdaenderung.am).toLocaleString(locale) })}
                  {matrix.fremdaenderung.begruendung ? ` — „${matrix.fremdaenderung.begruendung}"` : ''}
                </p>
              </div>
              <Button onClick={() => quittieren.mutate()} disabled={quittieren.isPending}>
                {quittieren.isPending ? t('quittiereBusy') : t('quittieren')}
              </Button>
            </div>
          )}

          {/* Leitung bearbeitet einen offenen Forecast der Region mit. */}
          {leitungBearbeitetOffen && (
            <div className="rounded-lg border border-ez-primary/40 bg-ez-primary/5 p-3 text-sm text-ez-primary">{t('leitungOffenHinweis')}</div>
          )}

          {/* Leitung überschreibt einen bereits fertiggemeldeten Forecast. */}
          {leitungUeberschreibt && (
            <div className="rounded-lg border border-ez-primary/40 bg-ez-primary/5 p-3 text-sm text-ez-primary">{t('ueberschreibHinweis')}</div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full border-collapse whitespace-nowrap text-xs tabular-nums">
              <thead>
                <tr className="text-gray-600">
                  <th className="sticky left-0 z-10 bg-white" colSpan={2} />
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
                  <th className="sticky left-0 z-10 w-[110px] bg-gray-50 p-1 text-left">{t('spalteProduktgruppe')}</th>
                  <th className="sticky left-[110px] z-10 w-[110px] bg-gray-50 p-1 text-left">{matrix.regionCode}</th>
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
                {zeilen.map(({ z, groupStart }) => {
                  const m = metrik(z);
                  return (
                    <tr key={`${z.landId}|${z.e1Id}`} className={groupStart ? 'border-t-2 border-gray-300' : 'border-t border-gray-100'}>
                      <td className="sticky left-0 z-10 w-[110px] bg-white p-1 font-semibold">{groupStart ? z.e1Name : ''}</td>
                      <td className="sticky left-[110px] z-10 w-[110px] bg-white p-1">{z.landName}</td>
                      {istMonate.map((p) => (
                        <td key={p} className="border-l border-gray-100 p-1 text-right text-gray-500">
                          {z.istMonate[p] ? f0(z.istMonate[p]) : ''}
                        </td>
                      ))}
                      <td className="border-l border-gray-300 bg-gray-50 p-1 text-right font-medium">{f0(m.summeActual)}</td>
                      {fcMonate.map((p) => {
                        const rot = verletzt(z, p);
                        const key = ek(z.landId, z.e1Id, p);
                        const f = fcEur(z, p);
                        // Markierung: rot bei Schwellwert-Überschreitung, sonst blau bei Abweichung vom Budget (geändert).
                        const geaendert = !rot && Math.abs(f - (z.budgetMonate[p] ?? 0)) > 0.5;
                        const zellText = rot ? 'font-semibold text-ez-ampelRot' : geaendert ? 'font-semibold text-ez-primary' : '';
                        return (
                          <td key={p} className={`border-l border-gray-100 p-0 text-right ${rot ? 'bg-ez-ampelRot/10' : geaendert ? 'bg-ez-primary/10' : 'bg-yellow-50/40'}`}>
                            {editierbar ? (
                              <input
                                type="number"
                                className={`w-14 bg-transparent px-1 py-1 text-right tabular-nums focus:outline-none ${zellText}`}
                                value={edits[key] !== undefined ? edits[key] : Math.round(f / 1000)}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  if (v === '') {
                                    // Leeres Feld != 0 EUR: Edit verwerfen, Budget-Default bleibt aktiv.
                                    const { [key]: _drop, ...rest } = edits;
                                    setEdits(rest);
                                  } else {
                                    setEdits({ ...edits, [key]: Number(v) });
                                  }
                                }}
                              />
                            ) : (
                              <span className={`px-1 py-1 ${zellText}`}>{f ? f0(f) : ''}</span>
                            )}
                          </td>
                        );
                      })}
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
                  <td className="sticky left-0 z-10 bg-gray-50 p-1" colSpan={2}>
                    {t('summe', { region: matrix.regionCode })}
                  </td>
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

          {offenBearbeitbar && editierteZellen.size > 0 && (
            <div className="space-y-2 rounded border border-ez-primary/30 bg-ez-primary/5 p-3">
              {anpassen.isError && <p className="text-sm text-ez-accent">{(anpassen.error as Error).message}</p>}
              <p className="text-xs text-gray-500">{t('speichernHinweis')}</p>
              <div className="flex gap-2 pt-1">
                <Button onClick={() => anpassen.mutate()} disabled={anpassen.isPending}>
                  {anpassen.isPending ? t('speichert') : t('speichern', { anzahl: editierteZellen.size })}
                </Button>
                <Button variant="ghost" onClick={() => setEdits({})}>
                  {t('verwerfen')}
                </Button>
              </div>
            </div>
          )}

          {/* Fertigmelden: optionale Stellungnahme + finales Bestätigen (nur ohne ungespeicherte Änderungen). */}
          {agmEditierbar && editierteZellen.size === 0 && (
            <div className="space-y-2 rounded border border-ez-primary/30 bg-ez-primary/5 p-3">
              <label className="block text-sm font-medium text-ez-primary">{t('stellungnahmeLabel')}</label>
              <input
                className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none"
                placeholder={t('stellungnahmePlaceholder')}
                value={stellungnahme}
                onChange={(e) => setStellungnahme(e.target.value)}
              />
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button onClick={() => bestaetigen.mutate()} disabled={bestaetigen.isPending}>
                  {bestaetigen.isPending ? t('bestaetigt') : t('bestaetigen')}
                </Button>
                {anpassen.isSuccess && <span className="text-xs text-ez-ampelGruen">{t('gespeichert')}</span>}
                {bestaetigen.isError && <span className="text-xs text-ez-accent">✗ {(bestaetigen.error as Error).message}</span>}
              </div>
            </div>
          )}

          {leitungUeberschreibt && editierteZellen.size > 0 && (
            <div className="space-y-2 rounded border border-ez-primary/30 bg-ez-primary/5 p-3">
              <p className="text-sm font-medium text-ez-primary">{t('ueberschreibBegrTitel', { anzahl: editierteZellen.size })}</p>
              <input
                className={`w-full rounded border px-2 py-1 text-sm focus:outline-none ${ueberBegr.trim().length >= 3 ? 'border-gray-300' : 'border-ez-ampelRot'}`}
                placeholder={t('ueberschreibBegrPlaceholder')}
                value={ueberBegr}
                onChange={(e) => setUeberBegr(e.target.value)}
              />
              {ueberschreiben.isError && <p className="text-sm text-ez-accent">{(ueberschreiben.error as Error).message}</p>}
              <div className="flex gap-2 pt-1">
                <Button onClick={() => ueberschreiben.mutate()} disabled={ueberschreiben.isPending || ueberBegr.trim().length < 3}>
                  {ueberschreiben.isPending ? t('speichert') : t('ueberschreibSpeichern', { anzahl: editierteZellen.size })}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setEdits({});
                    setUeberBegr('');
                  }}
                >
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
