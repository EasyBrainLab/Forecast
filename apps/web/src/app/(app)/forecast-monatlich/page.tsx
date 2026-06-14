'use client';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, Card } from '@/components/ui';

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
}

const MONATS_KURZ = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const monatNr = (p: string) => Number(p.slice(5));
const ek = (landId: string, e1Id: string, p: string) => `${landId}|${e1Id}|${p}`;
// Anzeige in kEUR (Tausend EUR), ganzzahlig, mit Tausenderpunkt: 300.500 € -> "301", 1.209.500 € -> "1.210".
const f0 = (v: number) => Math.round(v / 1000).toLocaleString('de-DE');

export default function ForecastMonatlichPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [sel, setSel] = useState<{ periode: string; regionCode: string } | null>(null);
  const [edits, setEdits] = useState<Record<string, number>>({}); // key land|e1|periode -> EUR
  const [comments, setComments] = useState<Record<string, string>>({}); // key land|e1|periode -> Begründung

  const { data: perioden } = useQuery({ queryKey: ['meine'], queryFn: () => api.get<Periode[]>('/forecast/meine') });
  const aktiv = sel ?? (perioden && perioden[0] ? { periode: perioden[0].periode, regionCode: perioden[0].regionCode } : null);
  const { data: matrix } = useQuery({
    queryKey: ['matrix', aktiv?.periode, aktiv?.regionCode],
    queryFn: () => api.get<Matrix>(`/forecast/${aktiv!.periode}/${aktiv!.regionCode}/matrix`),
    enabled: !!aktiv,
  });

  const editierbar = !!matrix && matrix.status === 'OFFEN' && user?.rolle === 'AGM';
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

  const fehlendeBegruendungen = useMemo(() => {
    if (!matrix) return [] as { z: Zelle; p: string }[];
    const out: { z: Zelle; p: string }[] = [];
    for (const z of matrix.zellen) {
      if (!editierteZellen.has(`${z.landId}|${z.e1Id}`)) continue;
      for (const p of fcMonate) {
        if (!verletzt(z, p)) continue;
        const komm = comments[ek(z.landId, z.e1Id, p)] ?? z.monatswerteRest[p]?.kommentar ?? '';
        if (!komm.trim()) out.push({ z, p });
      }
    }
    return out;
  }, [matrix, edits, comments, editierteZellen, fcMonate]);

  const bestaetigen = useMutation({
    mutationFn: () => api.post(`/forecast/${aktiv!.periode}/${aktiv!.regionCode}/bestaetigen`),
    onSuccess: () => qc.invalidateQueries(),
  });

  const anpassen = useMutation({
    mutationFn: () => {
      const zellen = matrix!.zellen
        .filter((z) => editierteZellen.has(`${z.landId}|${z.e1Id}`))
        .map((z) => {
          const mw: Record<string, { eur: number; units?: number | null; kommentar?: string | null }> = {};
          for (const p of fcMonate) {
            const key = ek(z.landId, z.e1Id, p);
            const komm = (comments[key] ?? z.monatswerteRest[p]?.kommentar ?? '').trim();
            mw[p] = { eur: fcEur(z, p), units: z.monatswerteRest[p]?.units ?? null, ...(komm ? { kommentar: komm } : {}) };
          }
          return { landId: z.landId, e1Id: z.e1Id, monatswerteRest: mw };
        });
      // Per-Monats-Begründungen liegen in zelle.monatswerteRest[m].kommentar; der Top-Level-Kommentar
      // (für die Zellen-Schwellwert-Prüfung, MaxLength 2000) ist nur eine kurze Zusammenfassung.
      const anzBegr = Object.values(comments).filter((c) => c.trim()).length;
      const kommentar = anzBegr ? `Monatsbegründungen (${anzBegr}) — Details je Monat gespeichert` : undefined;
      return api.post(`/forecast/${aktiv!.periode}/${aktiv!.regionCode}/anpassen`, { kommentar, monatsModus: true, zellen });
    },
    onSuccess: () => {
      setEdits({});
      setComments({});
      qc.invalidateQueries();
    },
  });

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

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-ez-primary">Forecast — Monatssicht (Produktgruppe / Land)</h1>
      <p className="text-sm text-gray-500">
        Abgeschlossene Monate = <b>Actual</b> (realisierte Umsätze), offene Monate = <b>Forecast</b> (aus Budget vorbelegt,
        überschreibbar). Werte in <b>kEUR</b> (Tausend EUR). Bei Monatsabweichung &gt; {schwelle} % gegenüber Budget ist eine Begründung Pflicht.
      </p>

      {perioden && perioden.length === 0 && (
        <Card>
          <p className="text-gray-600">Es ist noch keine Forecast-Periode geöffnet.</p>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        {perioden?.map((p) => (
          <button
            key={p.id}
            onClick={() => {
              setSel({ periode: p.periode, regionCode: p.regionCode });
              setEdits({});
              setComments({});
            }}
            className={`rounded border px-3 py-1 text-sm ${aktiv?.periode === p.periode && aktiv?.regionCode === p.regionCode ? 'border-ez-primary bg-ez-primary text-white' : 'bg-white'}`}
          >
            {p.regionCode} · {p.periode} ({p.status})
          </button>
        ))}
      </div>

      {matrix && totals && (
        <Card className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="font-semibold">
                {matrix.regionCode} · {matrix.periode}
              </span>
              <span className="ml-2 rounded bg-gray-100 px-2 py-0.5 text-xs">{matrix.status}</span>
              <span className="ml-2 text-xs text-gray-400">Monats-Schwellwert {schwelle} %</span>
            </div>
            {matrix.status === 'OFFEN' && user?.rolle === 'AGM' && Object.keys(edits).length === 0 && (
              <Button onClick={() => bestaetigen.mutate()} disabled={bestaetigen.isPending}>
                {bestaetigen.isPending ? 'Bestätige…' : 'Unverändert bestätigen (1 Klick)'}
              </Button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse whitespace-nowrap text-xs tabular-nums">
              <thead>
                <tr className="text-gray-600">
                  <th className="sticky left-0 z-10 bg-white" colSpan={2} />
                  <th colSpan={istMonate.length + 1} className="border border-gray-300 bg-gray-100 p-1 text-center font-semibold">
                    Actual
                  </th>
                  <th colSpan={fcMonate.length + 1} className="border border-gray-300 bg-yellow-50 p-1 text-center font-semibold">
                    Forecast
                  </th>
                  <th colSpan={5} className="border border-gray-300 bg-purple-50 p-1 text-center font-semibold">
                    FY 20{jj}
                  </th>
                </tr>
                <tr className="bg-gray-50 text-gray-500">
                  <th className="sticky left-0 z-10 w-[110px] bg-gray-50 p-1 text-left">Produktgruppe</th>
                  <th className="sticky left-[110px] z-10 w-[110px] bg-gray-50 p-1 text-left">{matrix.regionCode}</th>
                  {istMonate.map((p) => (
                    <th key={p} className="border-l border-gray-200 p-1 text-right">{`${MONATS_KURZ[monatNr(p) - 1]}. ${jj}`}</th>
                  ))}
                  <th className="border-l border-gray-300 bg-gray-100 p-1 text-right font-semibold">∑ Actual</th>
                  {fcMonate.map((p) => (
                    <th key={p} className="border-l border-gray-200 bg-yellow-50 p-1 text-right">{`${MONATS_KURZ[monatNr(p) - 1]}. ${jj}`}</th>
                  ))}
                  <th className="border-l border-gray-300 bg-yellow-100 p-1 text-right font-semibold">∑ Forecast</th>
                  <th className="border-l border-gray-300 bg-purple-50 p-1 text-right">BUD</th>
                  <th className="p-1 text-right">Actual+BUD</th>
                  <th className="p-1 text-right">Actual+FC</th>
                  <th className="p-1 text-right">ΔBud/Act+Bud</th>
                  <th className="p-1 text-right">ΔBud/Act+FC</th>
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
                        return (
                          <td key={p} className={`border-l border-gray-100 p-0 text-right ${rot ? 'bg-ez-ampelRot/10' : 'bg-yellow-50/40'}`}>
                            {editierbar ? (
                              <input
                                type="number"
                                className={`w-14 bg-transparent px-1 py-1 text-right tabular-nums focus:outline-none ${rot ? 'font-semibold text-ez-ampelRot' : ''}`}
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
                              <span className={`px-1 py-1 ${rot ? 'font-semibold text-ez-ampelRot' : ''}`}>{f ? f0(f) : ''}</span>
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
                    Summe {matrix.regionCode}
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

          {editierbar && editierteZellen.size > 0 && (
            <div className="space-y-2 rounded border border-ez-primary/30 bg-ez-primary/5 p-3">
              {fehlendeBegruendungen.length > 0 && (
                <p className="text-sm font-medium text-ez-ampelRot">
                  Begründung erforderlich für {fehlendeBegruendungen.length} Monat(e) mit Abweichung &gt; {schwelle} %.
                </p>
              )}
              {zeilen
                .filter(({ z }) => editierteZellen.has(`${z.landId}|${z.e1Id}`))
                .flatMap(({ z }) =>
                  fcMonate.filter((p) => verletzt(z, p)).map((p) => {
                    const key = ek(z.landId, z.e1Id, p);
                    const val = comments[key] ?? z.monatswerteRest[p]?.kommentar ?? '';
                    return (
                      <div key={key} className="flex items-center gap-2">
                        <span className="w-48 shrink-0 text-xs text-gray-600">
                          {z.e1Name} · {z.landName} · {MONATS_KURZ[monatNr(p) - 1]}. {jj}
                        </span>
                        <input
                          className={`flex-1 rounded border px-2 py-1 text-sm focus:outline-none ${val.trim() ? 'border-gray-300' : 'border-ez-ampelRot'}`}
                          placeholder="Begründung der Abweichung (Pflicht)…"
                          value={val}
                          onChange={(e) => setComments({ ...comments, [key]: e.target.value })}
                        />
                      </div>
                    );
                  }),
                )}
              {anpassen.isError && <p className="text-sm text-ez-accent">{(anpassen.error as Error).message}</p>}
              <div className="flex gap-2 pt-1">
                <Button onClick={() => anpassen.mutate()} disabled={anpassen.isPending || fehlendeBegruendungen.length > 0}>
                  {anpassen.isPending ? 'Speichere…' : `${editierteZellen.size} Zelle(n) speichern`}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setEdits({});
                    setComments({});
                  }}
                >
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
