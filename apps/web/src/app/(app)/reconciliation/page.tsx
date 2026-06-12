'use client';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, getToken } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, Card, keur } from '@/components/ui';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const MON = ['', 'Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

interface Doc {
  id: string;
  jahr: number;
  monat: number;
  dateiname: string;
  groesseBytes: number;
  hochgeladenVon: string;
  erstelltAm: string;
  actualsErfasst: boolean;
}
interface ReconRow {
  regionCode: string;
  bezeichnung: string;
  toolIst: number;
  controllingActual: number | null;
  deltaEur: number | null;
  deltaProzent: number | null;
}
interface Recon {
  jahr: number;
  monat: number;
  belegVorhanden: boolean;
  actualsErfasst: boolean;
  kommentar: string | null;
  zeilen: ReconRow[];
  gesamt: { toolIst: number; controllingActual: number | null; deltaEur: number | null; deltaProzent: number | null };
  hinweis: string;
}

const fmtEur = (v: number | null): string => (v === null ? '—' : keur(v));

async function downloadBeleg(id: string, dateiname: string) {
  const res = await fetch(`${BASE}/sales-flash/${id}/download`, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) return;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener';
  a.download = dateiname;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export default function ReconciliationPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const darfBearbeiten = user?.rolle === 'BU_LEITER' || user?.rolle === 'ADMIN';
  const [jahr, setJahr] = useState(2026);
  const [monat, setMonat] = useState(5);

  const { data: docs } = useQuery({ queryKey: ['sales-flash-docs'], queryFn: () => api.get<Doc[]>('/sales-flash') });
  const { data: recon } = useQuery({ queryKey: ['recon', jahr, monat], queryFn: () => api.get<Recon>(`/sales-flash/reconciliation?jahr=${jahr}&monat=${monat}`) });

  // Upload
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadPhase, setUploadPhase] = useState<'idle' | 'upload' | 'fertig' | 'fehler'>('idle');
  const [uploadMsg, setUploadMsg] = useState('');

  const uploadPdf = (file: File) => {
    setUploadPhase('upload');
    setUploadMsg('');
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE}/sales-flash/upload?jahr=${jahr}&monat=${monat}`);
    xhr.setRequestHeader('Authorization', `Bearer ${getToken()}`);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        setUploadPhase('fertig');
        setUploadMsg('Beleg gespeichert.');
        qc.invalidateQueries({ queryKey: ['sales-flash-docs'] });
        qc.invalidateQueries({ queryKey: ['recon'] });
      } else {
        setUploadPhase('fehler');
        try {
          setUploadMsg(JSON.parse(xhr.responseText)?.message ?? `Fehler ${xhr.status}`);
        } catch {
          setUploadMsg(`Fehler ${xhr.status}`);
        }
      }
    };
    xhr.onerror = () => {
      setUploadPhase('fehler');
      setUploadMsg('Netzwerkfehler.');
    };
    const fd = new FormData();
    fd.append('file', file);
    xhr.send(fd);
  };

  // Actuals
  const [actuals, setActuals] = useState<Record<string, string>>({});
  const [total, setTotal] = useState('');
  const [kommentar, setKommentar] = useState('');
  const [actualsMsg, setActualsMsg] = useState('');

  useEffect(() => {
    if (!recon) return;
    const next: Record<string, string> = {};
    for (const z of recon.zeilen) next[z.regionCode] = z.controllingActual === null ? '' : String(z.controllingActual);
    setActuals(next);
    setTotal(recon.gesamt.controllingActual === null ? '' : String(recon.gesamt.controllingActual));
    setKommentar(recon.kommentar ?? '');
  }, [recon]);

  const speichernActuals = async () => {
    setActualsMsg('');
    const regionen = Object.entries(actuals)
      .filter(([, v]) => v.trim() !== '')
      .map(([regionCode, v]) => ({ regionCode, eur: Number(v.replace(/\./g, '').replace(',', '.')) }));
    try {
      await api.put(`/sales-flash/actuals?jahr=${jahr}&monat=${monat}`, {
        total: total.trim() === '' ? null : Number(total.replace(/\./g, '').replace(',', '.')),
        regionen,
        kommentar,
      });
      setActualsMsg('Controlling-Werte gespeichert.');
      qc.invalidateQueries({ queryKey: ['recon'] });
      qc.invalidateQueries({ queryKey: ['sales-flash-docs'] });
    } catch (e) {
      setActualsMsg(e instanceof ApiError ? e.message : 'Fehler.');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ez-primary">Sales-Flash &amp; Abgleich</h1>
          <p className="text-sm text-gray-500">Monatlicher Controlling-Beleg ablegen und Tool-Ist (GL) gegen den Sales-Flash-Actual abgleichen. Werte in kEUR.</p>
        </div>
        <div className="flex items-center gap-2">
          <select className="rounded border border-gray-300 px-2 py-1 text-sm" value={monat} onChange={(e) => setMonat(Number(e.target.value))}>
            {MON.slice(1).map((m, i) => (
              <option key={i + 1} value={i + 1}>
                Jan–{m}
              </option>
            ))}
          </select>
          <select className="rounded border border-gray-300 px-2 py-1 text-sm" value={jahr} onChange={(e) => setJahr(Number(e.target.value))}>
            {[2025, 2026].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Reconciliation-Tabelle */}
      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold text-ez-primary">
          Abgleich Jan–{MON[monat]} {jahr}
        </h2>
        {!recon ? (
          <p className="text-sm text-gray-500">Lädt…</p>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead className="text-left text-gray-500">
                <tr>
                  <th className="py-1">Region</th>
                  <th className="py-1 text-right">Tool-Ist (GL)</th>
                  <th className="py-1 text-right">Controlling-Actual</th>
                  <th className="py-1 text-right">Delta</th>
                  <th className="py-1 text-right">Delta %</th>
                </tr>
              </thead>
              <tbody>
                {recon.zeilen.map((z) => (
                  <tr key={z.regionCode} className="border-t">
                    <td className="py-1">
                      {z.regionCode} · {z.bezeichnung}
                    </td>
                    <td className="py-1 text-right tabular-nums">{fmtEur(z.toolIst)}</td>
                    <td className="py-1 text-right tabular-nums">{fmtEur(z.controllingActual)}</td>
                    <td className={`py-1 text-right tabular-nums ${(z.deltaEur ?? 0) < 0 ? 'text-ez-accent' : (z.deltaEur ?? 0) > 0 ? 'text-ez-ampelGruen' : ''}`}>{fmtEur(z.deltaEur)}</td>
                    <td className="py-1 text-right tabular-nums">{z.deltaProzent === null ? '—' : `${z.deltaProzent.toLocaleString('de-DE', { maximumFractionDigits: 1 })} %`}</td>
                  </tr>
                ))}
                <tr className="border-t-2 font-semibold">
                  <td className="py-1">Gesamt</td>
                  <td className="py-1 text-right tabular-nums">{fmtEur(recon.gesamt.toolIst)}</td>
                  <td className="py-1 text-right tabular-nums">{fmtEur(recon.gesamt.controllingActual)}</td>
                  <td className={`py-1 text-right tabular-nums ${(recon.gesamt.deltaEur ?? 0) < 0 ? 'text-ez-accent' : (recon.gesamt.deltaEur ?? 0) > 0 ? 'text-ez-ampelGruen' : ''}`}>{fmtEur(recon.gesamt.deltaEur)}</td>
                  <td className="py-1 text-right tabular-nums">{recon.gesamt.deltaProzent === null ? '—' : `${recon.gesamt.deltaProzent.toLocaleString('de-DE', { maximumFractionDigits: 1 })} %`}</td>
                </tr>
              </tbody>
            </table>
            {!recon.actualsErfasst && <p className="mt-2 text-xs text-gray-500">ℹ️ Noch keine Controlling-Actuals erfasst — bitte unten eintragen, dann erscheint das Delta.</p>}
            <p className="mt-3 rounded bg-gray-50 p-2 text-xs text-gray-600">{recon.hinweis}</p>
          </>
        )}
      </Card>

      {/* Beleg-Upload + Actuals (nur BU/Admin) */}
      {darfBearbeiten && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="space-y-3">
            <h2 className="text-sm font-semibold text-ez-primary">
              Sales-Flash-Beleg hochladen (Jan–{MON[monat]} {jahr})
            </h2>
            <input ref={fileRef} type="file" accept=".pdf" className="hidden" onChange={(e) => e.target.files?.[0] && uploadPdf(e.target.files[0])} />
            <Button variant="ghost" onClick={() => fileRef.current?.click()} disabled={uploadPhase === 'upload'}>
              {uploadPhase === 'upload' ? 'Lädt…' : 'PDF auswählen & hochladen'}
            </Button>
            {uploadMsg && <p className={`text-sm ${uploadPhase === 'fehler' ? 'text-ez-accent' : 'text-ez-ampelGruen'}`}>{uploadMsg}</p>}
          </Card>

          <Card className="space-y-3">
            <h2 className="text-sm font-semibold text-ez-primary">Controlling-Actuals erfassen (voller EUR)</h2>
            <div className="space-y-2">
              {recon?.zeilen.map((z) => (
                <div key={z.regionCode} className="flex items-center gap-2">
                  <span className="w-40 text-sm text-gray-600">
                    {z.regionCode} · {z.bezeichnung}
                  </span>
                  <input
                    className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
                    inputMode="decimal"
                    placeholder="z. B. 1500000"
                    value={actuals[z.regionCode] ?? ''}
                    onChange={(e) => setActuals((a) => ({ ...a, [z.regionCode]: e.target.value }))}
                  />
                </div>
              ))}
              <div className="flex items-center gap-2 border-t pt-2">
                <span className="w-40 text-sm font-medium">Gesamt (optional)</span>
                <input className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm" inputMode="decimal" placeholder="überschreibt Summe" value={total} onChange={(e) => setTotal(e.target.value)} />
              </div>
              <textarea className="w-full rounded border border-gray-300 px-2 py-1 text-sm" rows={2} placeholder="Kommentar (z. B. Quelle/Abgrenzung)" value={kommentar} onChange={(e) => setKommentar(e.target.value)} />
            </div>
            <div className="flex items-center gap-3">
              <Button onClick={speichernActuals}>Speichern</Button>
              {actualsMsg && <span className="text-sm text-ez-ampelGruen">{actualsMsg}</span>}
            </div>
          </Card>
        </div>
      )}

      {/* Beleg-Liste */}
      <Card>
        <h2 className="mb-3 text-sm font-semibold text-ez-primary">Hinterlegte Belege</h2>
        {!docs || docs.length === 0 ? (
          <p className="text-sm text-gray-500">Noch keine Belege hochgeladen.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-gray-500">
              <tr>
                <th className="py-1">Periode</th>
                <th className="py-1">Datei</th>
                <th className="py-1 text-right">Größe</th>
                <th className="py-1">Actuals</th>
                <th className="py-1">Hochgeladen</th>
                <th className="py-1"></th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id} className="border-t">
                  <td className="py-1">
                    Jan–{MON[d.monat]} {d.jahr}
                  </td>
                  <td className="py-1">{d.dateiname}</td>
                  <td className="py-1 text-right tabular-nums">{(d.groesseBytes / 1024).toLocaleString('de-DE', { maximumFractionDigits: 0 })} KB</td>
                  <td className="py-1">{d.actualsErfasst ? '✓' : '—'}</td>
                  <td className="py-1 text-xs text-gray-500">{new Date(d.erstelltAm).toLocaleDateString('de-DE')}</td>
                  <td className="py-1 text-right">
                    <button className="text-ez-primary underline" onClick={() => downloadBeleg(d.id, d.dateiname)}>
                      öffnen
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
