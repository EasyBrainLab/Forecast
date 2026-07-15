'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, getToken } from '@/lib/api';
import { Button, Card } from '@/components/ui';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

interface Bericht {
  zeilenGesamt?: number;
  zeilenNeu?: number;
  zeilenAktualisiert?: number;
  zeilenUebersprungen?: number;
  zeilenQuarantaene?: number;
  summeGesamtEur?: number;
  summenJeRegion?: { regionCode: string; summeEur: number }[];
  budgetZeilen?: number;
  reserveZeilen?: number;
  summenJeJahr?: { jahr: number; summeEur: number }[];
  seedsGesamt?: number;
  seedsVorjahr?: number;
  zeilenImportiert?: number;
  uebersprungeneZeilen?: { zeile: number; kunde: string; land: string; grund: string }[];
  typ?: string;
  detail?: Record<string, unknown>;
}
interface Uebersicht {
  ist: { zeilen: number; summeEur: number; jahre: { jahr: number; zeilen: number }[]; letzterImport: { dateiname: string; status: string; zeilenNeu: number; erstelltAm: string } | null };
  budget: { zeilen: number; letzterImport: { dateiname: string; status: string; erstelltAm: string } | null };
}

function upload(pfad: string, file: File, onProgress: (p: number) => void): Promise<{ bericht: Bericht }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE}${pfad}`);
    xhr.setRequestHeader('Authorization', `Bearer ${getToken()}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error(Array.isArray(data?.message) ? data.message.join(', ') : data?.message ?? `Fehler ${xhr.status}`));
      } catch {
        reject(new Error(`Unerwartete Antwort (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error('Netzwerkfehler beim Upload'));
    const fd = new FormData();
    fd.append('file', file);
    xhr.send(fd);
  });
}

const eur = (v?: number): string => (v ?? 0).toLocaleString('de-DE', { maximumFractionDigits: 0 });

function ImportKachel({ titel, beschreibung, endpoint, accept }: { titel: string; beschreibung: string; endpoint: string; accept: string }) {
  const qc = useQueryClient();
  const ref = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<'idle' | 'upload' | 'verarbeite' | 'fertig' | 'fehler'>('idle');
  const [progress, setProgress] = useState(0);
  const [bericht, setBericht] = useState<Bericht | null>(null);
  const [fehler, setFehler] = useState('');

  const start = async () => {
    if (!file) return;
    setFehler('');
    setBericht(null);
    setPhase('upload');
    setProgress(0);
    try {
      const res = await upload(endpoint, file, (p) => {
        setProgress(p);
        if (p >= 100) setPhase('verarbeite');
      });
      setBericht(res.bericht);
      setPhase('fertig');
      qc.invalidateQueries({ queryKey: ['uebersicht'] });
    } catch (e) {
      setFehler((e as Error).message);
      setPhase('fehler');
    }
  };

  const b = bericht;
  const nichtsNeu = b && (b.zeilenNeu ?? 0) === 0 && (b.zeilenAktualisiert ?? 0) === 0 && (b.zeilenGesamt ?? b.budgetZeilen ?? 0) > 0;

  return (
    <Card className="space-y-3">
      <div>
        <h2 className="font-semibold text-ez-primary">{titel}</h2>
        <p className="text-sm text-gray-500">{beschreibung}</p>
      </div>

      <div
        onClick={() => ref.current?.click()}
        className="cursor-pointer rounded-lg border-2 border-dashed border-gray-300 p-6 text-center hover:border-ez-primary"
      >
        <input ref={ref} type="file" accept={accept} className="hidden" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPhase('idle'); setBericht(null); setFehler(''); }} />
        {file ? (
          <span className="text-sm">
            📄 <strong>{file.name}</strong> ({(file.size / 1024).toLocaleString('de-DE', { maximumFractionDigits: 0 })} KB)
          </span>
        ) : (
          <span className="text-sm text-gray-500">Datei hierher ziehen oder klicken zum Auswählen ({accept})</span>
        )}
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={start} disabled={!file || phase === 'upload' || phase === 'verarbeite'}>
          {phase === 'upload' ? `Lädt… ${progress}%` : phase === 'verarbeite' ? 'Verarbeite…' : 'Hochladen & verarbeiten'}
        </Button>
        {(phase === 'upload' || phase === 'verarbeite') && (
          <div className="h-2 flex-1 overflow-hidden rounded bg-gray-200">
            <div className="h-full bg-ez-primary transition-all" style={{ width: `${phase === 'verarbeite' ? 100 : progress}%` }} />
          </div>
        )}
      </div>

      {phase === 'fehler' && <p className="rounded bg-ez-accent/10 p-2 text-sm text-ez-accent">✗ {fehler}</p>}

      {phase === 'fertig' && b && (
        <div className="space-y-2 rounded border border-ez-ampelGruen/40 bg-ez-ampelGruen/5 p-3 text-sm">
          <p className="font-semibold text-ez-ampelGruen">✓ Import erfolgreich verarbeitet</p>
          {b.seedsGesamt !== undefined ? (
            <>
              <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-gray-700 sm:grid-cols-3">
                <li>Zeilen importiert: <strong>{eur(b.zeilenImportiert)}</strong></li>
                <li>Übersprungen: <strong>{eur(b.zeilenUebersprungen)}</strong></li>
                <li>Seeds gesamt: <strong>{eur(b.seedsGesamt)}</strong></li>
                <li>Seeds Vorjahr: <strong>{eur(b.seedsVorjahr)}</strong></li>
              </ul>
              {b.uebersprungeneZeilen && b.uebersprungeneZeilen.length > 0 && (
                <details className="rounded border border-gray-200 bg-white p-2">
                  <summary className="cursor-pointer text-xs font-medium text-gray-600">
                    Aussortierte Zeilen anzeigen ({b.uebersprungeneZeilen.length}
                    {(b.zeilenUebersprungen ?? 0) > b.uebersprungeneZeilen.length ? ` von ${b.zeilenUebersprungen}` : ''}) — Summen-/Leer-/Metazeilen werden nicht als Kunden übernommen
                  </summary>
                  <table className="mt-2 w-full text-xs">
                    <thead className="text-left text-gray-500">
                      <tr>
                        <th className="py-0.5 pr-2">Zeile</th>
                        <th className="py-0.5 pr-2">Kunde</th>
                        <th className="py-0.5 pr-2">Land</th>
                        <th className="py-0.5">Grund</th>
                      </tr>
                    </thead>
                    <tbody>
                      {b.uebersprungeneZeilen.map((z, i) => (
                        <tr key={i} className="border-t border-gray-100">
                          <td className="py-0.5 pr-2 tabular-nums">{z.zeile}</td>
                          <td className="py-0.5 pr-2">{z.kunde}</td>
                          <td className="py-0.5 pr-2">{z.land}</td>
                          <td className="py-0.5 text-gray-600">{z.grund}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              )}
            </>
          ) : b.zeilenGesamt !== undefined ? (
            <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-gray-700 sm:grid-cols-3">
              <li>Zeilen gesamt: <strong>{eur(b.zeilenGesamt)}</strong></li>
              <li>Neu: <strong>{eur(b.zeilenNeu)}</strong></li>
              <li>Aktualisiert: <strong>{eur(b.zeilenAktualisiert)}</strong></li>
              <li>Übersprungen: <strong>{eur(b.zeilenUebersprungen)}</strong></li>
              <li>
                Quarantäne: <strong>{eur(b.zeilenQuarantaene)}</strong>
                {(b.zeilenQuarantaene ?? 0) > 0 && (
                  <>
                    {' '}
                    <Link href="/admin/quarantaene" className="text-ez-primary underline">
                      → klären
                    </Link>
                  </>
                )}
              </li>
              {b.summeGesamtEur !== undefined && <li>Σ Umsatz: <strong>{eur(b.summeGesamtEur)} €</strong></li>}
            </ul>
          ) : (
            <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-gray-700 sm:grid-cols-3">
              <li>Budget-Zeilen: <strong>{eur(b.budgetZeilen)}</strong></li>
              <li>Regionsreserve: <strong>{eur(b.reserveZeilen)}</strong></li>
              <li>Quarantäne: <strong>{eur(b.zeilenQuarantaene)}</strong></li>
            </ul>
          )}
          {b.detail && (
            <div className="text-xs text-gray-500">
              {Object.entries(b.detail).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ')}
            </div>
          )}
          {nichtsNeu && (
            <p className="text-gray-600">ℹ️ Diese Daten waren bereits vollständig im System vorhanden — es wurde nichts Neues importiert (idempotent). Die Werte stehen der Anwendung zur Verfügung.</p>
          )}
          {b.summenJeRegion && (
            <div className="text-xs text-gray-500">
              Summen je Region: {b.summenJeRegion.map((s) => `${s.regionCode} ${eur(s.summeEur)} €`).join(' · ')}
            </div>
          )}
          <Link href="/daten" className="inline-block text-ez-primary underline">
            → Daten als Tabelle ansehen
          </Link>
        </div>
      )}
    </Card>
  );
}

export default function ImportPage() {
  const { data } = useQuery({ queryKey: ['uebersicht'], queryFn: () => api.get<Uebersicht>('/dashboard/uebersicht') });

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-ez-primary">Datenimport</h1>

      <Card>
        <h2 className="mb-2 text-sm font-semibold text-ez-primary">Aktuell im System</h2>
        {!data ? (
          <p className="text-sm text-gray-500">Lädt…</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded bg-gray-50 p-3 text-sm">
              <div className="font-medium">Ist-Umsätze</div>
              <div className="text-gray-600">
                {data.ist.zeilen.toLocaleString('de-DE')} Zeilen · Σ {eur(data.ist.summeEur)} € · Jahre {data.ist.jahre.map((j) => j.jahr).join(', ') || '—'}
              </div>
              <div className="text-xs text-gray-400">
                {data.ist.letzterImport ? `Letzter Import: ${data.ist.letzterImport.dateiname} (${new Date(data.ist.letzterImport.erstelltAm).toLocaleString('de-DE')})` : 'Noch kein Import'}
              </div>
            </div>
            <div className="rounded bg-gray-50 p-3 text-sm">
              <div className="font-medium">Budget</div>
              <div className="text-gray-600">{data.budget.zeilen.toLocaleString('de-DE')} aktive Zeilen</div>
              <div className="text-xs text-gray-400">
                {data.budget.letzterImport ? `Letzter Import: ${data.budget.letzterImport.dateiname} (${new Date(data.budget.letzterImport.erstelltAm).toLocaleString('de-DE')})` : 'Noch kein Import'}
              </div>
            </div>
          </div>
        )}
      </Card>

      <ImportKachel
        titel="Ist-Umsätze (CSV)"
        beschreibung="GL-Abriss External Revenue BU Therapie. Idempotent über RECID — mehrfacher Upload derselben Datei ist unschädlich."
        endpoint="/ist-import/upload"
        accept=".csv"
      />
      <ImportKachel
        titel="Budget (Excel)"
        beschreibung="Wide-Format-Budgetdatei. Wird in das normalisierte Long-Format überführt und versioniert."
        endpoint="/budgets/import"
        accept=".xlsx"
      />
      <ImportKachel
        titel="Absatz / Stückzahlen (CSV)"
        beschreibung="Verkaufsmengen je Land/Kunde (Power-BI-Export SF_MM_MM_JJJJ…). Periode wird aus dem Dateinamen erkannt; Vorjahr ist in der Datei enthalten."
        endpoint="/absatz/import"
        accept=".csv"
      />

      <div className="pt-2">
        <h2 className="text-sm font-semibold text-ez-primary">Sales-Daten (Dynamics 365)</h2>
        <p className="text-xs text-gray-500">Kundenscharfe Rechnungsdaten für die Sales-Analytik. Reihenfolge: erst Kundenstamm & Rechnungsköpfe, dann Positionen (verknüpfen sich über die Rechnungsnummer). Alle idempotent — mehrfacher Upload ist unschädlich.</p>
      </div>
      <ImportKachel
        titel="Kundenstamm (Excel)"
        beschreibung="D365 CustCustomerV3 — Kundennummer, Name, Gruppe, Land, Währung. Schlüssel: Gesellschaft + Kundennummer."
        endpoint="/sales-import/kundenstamm"
        accept=".xlsx"
      />
      <ImportKachel
        titel="Rechnungsköpfe (Excel)"
        beschreibung="D365 SalesInvoiceHeader — verknüpft Rechnung mit Kunde. Idempotent über RECID."
        endpoint="/sales-import/rechnungen"
        accept=".xlsx"
      />
      <ImportKachel
        titel="Rechnungspositionen (Excel)"
        beschreibung="D365 SalesInvoiceLines — Produkt, Menge, Verkaufspreis, Betrag je Zeile (~130k). Bitte zuerst die Rechnungsköpfe importieren."
        endpoint="/sales-import/positionen"
        accept=".xlsx"
      />
    </div>
  );
}
