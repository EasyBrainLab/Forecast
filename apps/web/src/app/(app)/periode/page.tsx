'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Ampel, Button, Card, keur } from '@/components/ui';

const MON = ['', 'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
type AmpelFarbe = 'gruen' | 'gelb' | 'rot' | 'grau';

interface Monat {
  jahr: number;
  monat: number;
  zukunft: boolean;
  gl: { vorhanden: boolean; kumuliertEur: number };
  salesFlash: { vorhanden: boolean; actualsErfasst: boolean; totalEur: number | null };
  absatz: { vorhanden: boolean; seeds: number };
  abgleich: { deltaEur: number | null; deltaProzent: number | null; imToleranz: boolean | null };
  abgeschlossen: boolean;
  abgeschlossenVon: string | null;
  abgeschlossenAm: string | null;
  notiz: string | null;
  ampel: AmpelFarbe;
}
interface Board {
  jahr: number;
  toleranzProzent: number;
  monate: Monat[];
}
interface DetailRow {
  regionCode: string;
  bezeichnung: string;
  glIst: number;
  salesFlashIst: number | null;
  offiziellIst: number;
  deltaEur: number | null;
  deltaProzent: number | null;
  imToleranz: boolean | null;
  units: number | null;
  aspEur: number | null;
  budget: number;
  abwBudgetEur: number;
  abwBudgetProzent: number | null;
}
interface Detail {
  jahr: number;
  monat: number;
  toleranzProzent: number;
  zeilen: DetailRow[];
  gesamt: { glIst: number; salesFlashIst: number | null; offiziellIst: number; deltaEur: number; units: number; aspEur: number | null; budget: number; abwBudgetEur: number };
}

const fmtK = (v: number | null): string => (v === null ? '—' : keur(v));
const fmtN = (v: number | null): string => (v === null ? '—' : v.toLocaleString('de-DE'));
const fmtP = (v: number | null): string => (v === null ? '—' : `${v.toLocaleString('de-DE', { maximumFractionDigits: 1 })} %`);

function Quelle({ ok, label }: { ok: boolean; label: string }) {
  return <span className={`text-xs ${ok ? 'text-ez-ampelGruen' : 'text-gray-400'}`}>{ok ? '✓' : '○'} {label}</span>;
}

export default function PeriodePage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const darfAbschliessen = user?.rolle === 'BU_LEITER' || user?.rolle === 'ADMIN';
  const [jahr, setJahr] = useState(2026);
  const [sel, setSel] = useState<number | null>(null);

  const { data: board } = useQuery({ queryKey: ['periode-board', jahr], queryFn: () => api.get<Board>(`/periode/uebersicht?jahr=${jahr}`) });
  const { data: detail } = useQuery({ queryKey: ['periode-detail', jahr, sel], queryFn: () => api.get<Detail>(`/periode/detail?jahr=${jahr}&monat=${sel}`), enabled: sel !== null });
  const { data: einstellungen } = useQuery({ queryKey: ['einstellungen'], queryFn: () => api.get<{ key: string; value: string }[]>('/stammdaten/einstellungen') });
  const istQuelle = einstellungen?.find((e) => e.key === 'IST_QUELLE')?.value ?? 'SALES_FLASH';
  const setIstQuelle = async (value: string) => {
    await api.patch('/stammdaten/admin/einstellungen/IST_QUELLE', { value });
    qc.invalidateQueries({ queryKey: ['einstellungen'] });
    qc.invalidateQueries({ queryKey: ['periode-board'] });
    qc.invalidateQueries({ queryKey: ['periode-detail'] });
    qc.invalidateQueries({ queryKey: ['kpi'] });
    qc.invalidateQueries({ queryKey: ['konsolidierung'] });
  };

  const reload = () => {
    qc.invalidateQueries({ queryKey: ['periode-board'] });
    qc.invalidateQueries({ queryKey: ['periode-detail'] });
  };
  const abschliessen = async (m: number) => {
    await api.post(`/periode/${jahr}/${m}/abschliessen`, {});
    reload();
  };
  const wiederOeffnen = async (m: number) => {
    await api.post(`/periode/${jahr}/${m}/wieder-oeffnen`, {});
    reload();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ez-primary">Monatsabschluss</h1>
          <p className="text-sm text-gray-500">
            Status je Monat: sind alle drei Quellen da (GL · Sales Flash · Stückzahlen), liegen Ist und Controlling im Toleranzband (±{board?.toleranzProzent ?? 2} %)? Werte in kEUR.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 text-xs text-gray-500">
            <span>Offizielle Ist-Quelle:</span>
            {user?.rolle === 'ADMIN' ? (
              <select className="rounded border border-gray-300 px-2 py-1 text-xs" value={istQuelle} onChange={(e) => setIstQuelle(e.target.value)}>
                <option value="SALES_FLASH">Sales Flash (Controlling)</option>
                <option value="GL">GL External Revenue</option>
              </select>
            ) : (
              <span className="font-medium text-ez-primary">{istQuelle === 'GL' ? 'GL External Revenue' : 'Sales Flash (Controlling)'}</span>
            )}
          </div>
          <select className="rounded border border-gray-300 px-3 py-1.5 text-sm" value={jahr} onChange={(e) => { setJahr(Number(e.target.value)); setSel(null); }}>
            {[2024, 2025, 2026].map((j) => (
              <option key={j} value={j}>
                {j}
              </option>
            ))}
          </select>
        </div>
      </div>

      <Card className="p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-3 py-2">Monat</th>
              <th className="px-3 py-2">Quellen</th>
              <th className="px-3 py-2 text-right">GL kum.</th>
              <th className="px-3 py-2 text-right">Sales Flash</th>
              <th className="px-3 py-2 text-right">Delta</th>
              <th className="px-3 py-2 text-center">Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {board?.monate.map((m) => (
              <tr
                key={m.monat}
                className={`border-t hover:bg-gray-50 ${sel === m.monat ? 'bg-ez-primary/5' : ''} ${m.zukunft ? 'opacity-50' : 'cursor-pointer'}`}
                onClick={() => !m.zukunft && setSel(sel === m.monat ? null : m.monat)}
              >
                <td className="px-3 py-2">
                  <span className="flex items-center gap-2">
                    <Ampel farbe={m.ampel} />
                    {MON[m.monat]}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span className="flex flex-col gap-0.5">
                    <Quelle ok={m.gl.vorhanden} label="GL" />
                    <Quelle ok={m.salesFlash.actualsErfasst} label="Sales Flash" />
                    <Quelle ok={m.absatz.vorhanden} label="Stückzahlen" />
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{m.gl.vorhanden ? fmtK(m.gl.kumuliertEur) : '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtK(m.salesFlash.totalEur)}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${m.abgleich.imToleranz === false ? 'text-ez-accent' : ''}`}>
                  {m.abgleich.deltaEur === null ? '—' : `${fmtK(m.abgleich.deltaEur)} (${fmtP(m.abgleich.deltaProzent)})`}
                </td>
                <td className="px-3 py-2 text-center">
                  {m.zukunft ? <span className="text-xs text-gray-400">—</span> : m.abgeschlossen ? <span className="text-xs text-ez-ampelGruen">freigegeben</span> : <span className="text-xs text-gray-500">offen</span>}
                </td>
                <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                  {darfAbschliessen && !m.zukunft && (
                    m.abgeschlossen ? (
                      <button className="text-xs text-gray-500 underline" onClick={() => wiederOeffnen(m.monat)}>
                        öffnen
                      </button>
                    ) : (
                      <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => abschliessen(m.monat)}>
                        freigeben
                      </Button>
                    )
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {sel !== null && detail && (
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-ez-primary">
            Abgleich {MON[sel]} {jahr} — je Region (kEUR; Units in Stück, ASP in €)
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-gray-500">
                <tr>
                  <th className="py-1">Region</th>
                  <th className="py-1 text-right">GL-Ist</th>
                  <th className="py-1 text-right">Sales-Flash-Ist</th>
                  <th className="py-1 text-right">Delta</th>
                  <th className="py-1 text-right">Units</th>
                  <th className="py-1 text-right">ASP €</th>
                  <th className="py-1 text-right">Budget</th>
                  <th className="py-1 text-right">Abw. Budget</th>
                </tr>
              </thead>
              <tbody>
                {detail.zeilen.map((z) => (
                  <tr key={z.regionCode} className="border-t">
                    <td className="py-1">{z.regionCode} · {z.bezeichnung}</td>
                    <td className="py-1 text-right tabular-nums">{fmtK(z.glIst)}</td>
                    <td className="py-1 text-right tabular-nums font-medium">{fmtK(z.salesFlashIst)}</td>
                    <td className={`py-1 text-right tabular-nums ${z.imToleranz === false ? 'text-ez-accent' : 'text-gray-500'}`}>
                      {z.deltaEur === null ? '—' : `${fmtK(z.deltaEur)} (${fmtP(z.deltaProzent)})`}
                    </td>
                    <td className="py-1 text-right tabular-nums">{fmtN(z.units)}</td>
                    <td className="py-1 text-right tabular-nums">{z.aspEur === null ? '—' : z.aspEur.toLocaleString('de-DE', { maximumFractionDigits: 0 })}</td>
                    <td className="py-1 text-right tabular-nums">{fmtK(z.budget)}</td>
                    <td className={`py-1 text-right tabular-nums ${z.abwBudgetEur < 0 ? 'text-ez-accent' : 'text-ez-ampelGruen'}`}>
                      {fmtK(z.abwBudgetEur)} ({fmtP(z.abwBudgetProzent)})
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 font-semibold">
                  <td className="py-1">Gesamt</td>
                  <td className="py-1 text-right tabular-nums">{fmtK(detail.gesamt.glIst)}</td>
                  <td className="py-1 text-right tabular-nums">{fmtK(detail.gesamt.salesFlashIst)}</td>
                  <td className="py-1 text-right tabular-nums">{fmtK(detail.gesamt.deltaEur)}</td>
                  <td className="py-1 text-right tabular-nums">{fmtN(detail.gesamt.units)}</td>
                  <td className="py-1 text-right tabular-nums">{detail.gesamt.aspEur === null ? '—' : detail.gesamt.aspEur.toLocaleString('de-DE', { maximumFractionDigits: 0 })}</td>
                  <td className="py-1 text-right tabular-nums">{fmtK(detail.gesamt.budget)}</td>
                  <td className={`py-1 text-right tabular-nums ${detail.gesamt.abwBudgetEur < 0 ? 'text-ez-accent' : 'text-ez-ampelGruen'}`}>{fmtK(detail.gesamt.abwBudgetEur)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-gray-500">
            Maßgebliche Ist-Zahl = Sales Flash (Controlling). GL dient als Detail/Drill-down; Stückzahlen aus dem Power-BI-Export liefern Units &amp; den impliziten ASP (offizielle EUR ÷ Units).
            Units erscheinen je Region, sobald die Kunden unter „Kunden → Region" zugeordnet sind.
          </p>
        </Card>
      )}
    </div>
  );
}
