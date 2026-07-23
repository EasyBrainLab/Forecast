'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, blobUrl, downloadDatei, getToken } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, Card, keur } from '@/components/ui';
import { DataTable, type Column } from '@/components/data-table';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const MON = ['', 'Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const REGIONEN = [
  { code: 'EP', label: 'EP' },
  { code: 'WIA', label: 'WIA' },
  { code: 'EMA', label: 'EMA' },
  { code: 'AGC', label: 'AGC' },
  { code: 'CS', label: 'CS (Radiotherapy)' },
];

interface Actuals {
  total: number | null;
  regionen: { regionCode: string; eur: number }[];
}
interface Doc {
  id: string;
  jahr: number;
  monat: number;
  dateiname: string;
  groesseBytes: number;
  mimeType: string;
  actuals: Actuals;
  kommentar: string | null;
  hochgeladenVon: string;
  erstelltAm: string;
  actualsErfasst: boolean;
}
interface AbgleichZeile {
  regionCode: string;
  produktgruppe: string;
  land: string;
  controllingActual: number | null;
  toolIst: number;
  deltaEur: number | null;
  deltaProzent: number | null;
}
interface Abgleich {
  jahr: number;
  monat: number;
  belegVorhanden: boolean;
  zeilen: AbgleichZeile[];
  gesamt: { controllingActual: number; toolIst: number; deltaEur: number; deltaProzent: number | null };
}
interface Stand {
  jahr: number;
  monat: number;
  regionCode: string;
  zeilen: number;
  stand: string;
}

const groesse = (b: number): string => (b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
const fmtEur = (v: number | null): string => (v === null ? '—' : keur(v));

export default function SalesFlashPage() {
  const [tab, setTab] = useState<'pdf' | 'detail'>('pdf');
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-ez-primary">Sales-Flash</h1>
        <p className="text-sm text-gray-500">Controlling-Belege direkt ansehen und die granularen Zahlen gegen den Tool-Ist abgleichen.</p>
      </div>
      <div className="flex gap-2">
        {([['pdf', 'PDF-Belege'], ['detail', 'Detailabgleich (Controlling vs. Tool)']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`rounded px-4 py-2 text-sm font-medium ${tab === k ? 'bg-ez-primary text-white' : 'border border-gray-300 bg-white'}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'pdf' ? <PdfBelege /> : <DetailAbgleich />}
    </div>
  );
}

function PdfBelege() {
  const { data: docs, isLoading } = useQuery({ queryKey: ['sales-flash-docs'], queryFn: () => api.get<Doc[]>('/sales-flash') });
  const [aktivId, setAktivId] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [laedt, setLaedt] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    if (docs && docs.length > 0 && !aktivId) setAktivId(docs[0].id);
  }, [docs, aktivId]);

  const aktiv = useMemo(() => docs?.find((d) => d.id === aktivId) ?? null, [docs, aktivId]);

  useEffect(() => {
    if (!aktivId) {
      setPdfUrl(null);
      return;
    }
    let abgebrochen = false;
    let url: string | null = null;
    setLaedt(true);
    setFehler(null);
    blobUrl(`/sales-flash/${aktivId}/download`)
      .then((r) => {
        if (abgebrochen) {
          URL.revokeObjectURL(r.url);
          return;
        }
        url = r.url;
        setPdfUrl(r.url);
      })
      .catch((e) => {
        if (!abgebrochen) setFehler(e instanceof Error ? e.message : 'Beleg konnte nicht geladen werden.');
      })
      .finally(() => {
        if (!abgebrochen) setLaedt(false);
      });
    return () => {
      abgebrochen = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [aktivId]);

  const actuals = aktiv?.actuals;
  const hatActuals = !!actuals && (actuals.total !== null || actuals.regionen.length > 0);

  if (isLoading) return <p className="text-gray-500">Lädt…</p>;
  if (docs && docs.length === 0)
    return (
      <Card>
        <p className="text-gray-500">Noch keine Sales-Flash-Belege hinterlegt. Belege werden unter „Sales-Flash &amp; Abgleich" hochgeladen.</p>
      </Card>
    );

  return (
    <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
      <Card className="h-fit p-2">
        <div className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Monate</div>
        <ul className="space-y-0.5">
          {docs?.map((d) => (
            <li key={d.id}>
              <button onClick={() => setAktivId(d.id)} className={`w-full rounded px-2 py-1.5 text-left text-sm ${d.id === aktivId ? 'bg-ez-primary text-white' : 'hover:bg-gray-100'}`}>
                <div className="font-medium">
                  {MON[d.monat]} {d.jahr}
                </div>
                <div className={`text-xs ${d.id === aktivId ? 'text-white/70' : 'text-gray-400'}`}>{d.actualsErfasst ? 'Actuals erfasst' : 'ohne Actuals'}</div>
              </button>
            </li>
          ))}
        </ul>
      </Card>

      <div className="space-y-3">
        {aktiv && (
          <Card className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <div className="font-semibold">
                {MON[aktiv.monat]} {aktiv.jahr}
              </div>
              <div className="truncate text-xs text-gray-500">
                {aktiv.dateiname} · {groesse(aktiv.groesseBytes)} · hochgeladen von {aktiv.hochgeladenVon}
              </div>
            </div>
            {hatActuals && actuals && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                {actuals.total !== null && (
                  <div>
                    <span className="text-gray-400">Total </span>
                    <b>{keur(actuals.total)}</b>
                  </div>
                )}
                {actuals.regionen.map((r) => (
                  <div key={r.regionCode} className="text-gray-600">
                    <span className="text-gray-400">{r.regionCode} </span>
                    {keur(r.eur)}
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => pdfUrl && window.open(pdfUrl, '_blank', 'noopener')} disabled={!pdfUrl}>
                Neuer Tab ↗
              </Button>
              <Button variant="ghost" onClick={() => downloadDatei(`/sales-flash/${aktiv.id}/download`, 'GET', aktiv.dateiname)}>
                Download
              </Button>
            </div>
          </Card>
        )}
        <Card className="overflow-hidden p-0">
          {laedt && <p className="p-4 text-gray-500">PDF wird geladen…</p>}
          {fehler && <p className="p-4 text-ez-accent">{fehler}</p>}
          {pdfUrl && !fehler && <iframe src={pdfUrl} title="Sales-Flash-Beleg" className="h-[80vh] w-full border-0" />}
        </Card>
        {aktiv?.kommentar && <p className="text-sm text-gray-500">Kommentar: {aktiv.kommentar}</p>}
      </div>
    </div>
  );
}

function DetailAbgleich() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const darfHochladen = user?.rolle === 'BU_LEITER' || user?.rolle === 'ADMIN';
  const [jahr, setJahr] = useState(new Date().getFullYear());
  const [monat, setMonat] = useState(6);
  const [region, setRegion] = useState('');
  const [uploadRegion, setUploadRegion] = useState('EP');
  const [busy, setBusy] = useState(false);
  const [meldung, setMeldung] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: staende } = useQuery({ queryKey: ['sf-detail-staende'], queryFn: () => api.get<Stand[]>('/sales-flash/detail/staende') });
  const q = `jahr=${jahr}&monat=${monat}${region ? `&region=${region}` : ''}`;
  const { data: abgleich, isLoading } = useQuery({ queryKey: ['sf-detail-abgleich', q], queryFn: () => api.get<Abgleich>(`/sales-flash/detail/abgleich?${q}`) });

  const staendeDesStands = useMemo(() => (staende ?? []).filter((s) => s.jahr === jahr && s.monat === monat), [staende, jahr, monat]);

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setFehler('Bitte eine Excel-Datei wählen.');
      return;
    }
    setBusy(true);
    setFehler(null);
    setMeldung(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${BASE}/sales-flash/detail/upload?jahr=${jahr}&monat=${monat}&region=${uploadRegion}`, { method: 'POST', headers: { Authorization: `Bearer ${getToken()}` }, body: fd });
      const data = (await res.json()) as { zeilenGespeichert?: number; produktgruppenOhneZuordnung?: string[]; laenderOhneZuordnung?: string[]; message?: string };
      if (!res.ok) throw new Error(Array.isArray(data.message) ? data.message.join(', ') : (data.message ?? `Upload fehlgeschlagen (${res.status}).`));
      const warn = [...(data.produktgruppenOhneZuordnung ?? []), ...(data.laenderOhneZuordnung ?? [])];
      setMeldung(`${uploadRegion}: ${data.zeilenGespeichert ?? 0} Werte gespeichert.` + (warn.length ? ` Ohne Zuordnung übersprungen: ${warn.join(', ')}.` : ''));
      if (fileRef.current) fileRef.current.value = '';
      qc.invalidateQueries({ queryKey: ['sf-detail-staende'] });
      qc.invalidateQueries({ queryKey: ['sf-detail-abgleich'] });
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Upload fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  }

  const cols: Column<AbgleichZeile>[] = [
    { key: 'region', label: 'Region', value: (r) => r.regionCode, filter: 'select' },
    { key: 'pg', label: 'Produktgruppe', value: (r) => r.produktgruppe, filter: 'select' },
    { key: 'land', label: 'Land', value: (r) => r.land, filter: 'select' },
    { key: 'controlling', label: 'Controlling', value: (r) => r.controllingActual ?? 0, align: 'right', filter: 'none', render: (r) => fmtEur(r.controllingActual) },
    { key: 'tool', label: 'Tool-Ist (GL)', value: (r) => r.toolIst, align: 'right', filter: 'none', render: (r) => fmtEur(r.toolIst) },
    {
      key: 'delta',
      label: 'Δ (kEUR)',
      value: (r) => r.deltaEur ?? 0,
      align: 'right',
      filter: 'none',
      render: (r) => <span className={(r.deltaEur ?? 0) < 0 ? 'text-ez-accent' : (r.deltaEur ?? 0) > 0 ? 'font-semibold text-ez-primary' : ''}>{fmtEur(r.deltaEur)}</span>,
    },
    { key: 'deltaPct', label: 'Δ %', value: (r) => r.deltaProzent ?? 0, align: 'right', filter: 'none', render: (r) => (r.deltaProzent === null ? '—' : `${r.deltaProzent.toLocaleString('de-DE', { maximumFractionDigits: 1 })} %`) },
  ];

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <div className="mb-1 text-xs text-gray-500">Jahr</div>
          <select className="rounded border border-gray-300 px-2 py-1.5 text-sm" value={jahr} onChange={(e) => setJahr(Number(e.target.value))}>
            {[2024, 2025, 2026, 2027].map((j) => (
              <option key={j}>{j}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <div className="mb-1 text-xs text-gray-500">Stand-Monat</div>
          <select className="rounded border border-gray-300 px-2 py-1.5 text-sm" value={monat} onChange={(e) => setMonat(Number(e.target.value))}>
            {MON.slice(1).map((m, i) => (
              <option key={i} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <div className="mb-1 text-xs text-gray-500">Region</div>
          <select className="rounded border border-gray-300 px-2 py-1.5 text-sm" value={region} onChange={(e) => setRegion(e.target.value)}>
            <option value="">Alle</option>
            {REGIONEN.map((r) => (
              <option key={r.code} value={r.code}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <div className="ml-auto text-right text-xs text-gray-500">
          {staendeDesStands.length > 0 ? (
            <span>Hinterlegt: {staendeDesStands.map((s) => s.regionCode).join(', ')}</span>
          ) : (
            <span>Für {MON[monat]} {jahr} noch keine Detailbelege.</span>
          )}
        </div>
      </Card>

      {darfHochladen && (
        <Card className="space-y-2">
          <div className="text-sm font-semibold text-ez-primary">Region-Excel hochladen ({MON[monat]} {jahr})</div>
          <p className="text-xs text-gray-500">Je Region eine Datei (z. B. „Forecast {jahr}.{String(monat).padStart(2, '0')} Therapy EP.xlsx"). Ersetzt die bisherigen Werte der gewählten Region für diesen Stand.</p>
          <div className="flex flex-wrap items-center gap-2">
            <select className="rounded border border-gray-300 px-2 py-1.5 text-sm" value={uploadRegion} onChange={(e) => setUploadRegion(e.target.value)}>
              {REGIONEN.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.label}
                </option>
              ))}
            </select>
            <input ref={fileRef} type="file" accept=".xlsx" className="text-sm" />
            <Button onClick={upload} disabled={busy}>
              {busy ? 'Lädt…' : 'Hochladen'}
            </Button>
          </div>
          {meldung && <p className="text-xs text-ez-ampelGruen">{meldung}</p>}
          {fehler && <p className="text-xs text-ez-accent">{fehler}</p>}
        </Card>
      )}

      <Card className="p-3">
        {isLoading ? (
          <p className="text-gray-500">Lädt…</p>
        ) : !abgleich || abgleich.zeilen.length === 0 ? (
          <p className="text-sm text-gray-500">Kein Abgleich möglich — für diesen Stand sind noch keine Controlling-Detailbelege hinterlegt{darfHochladen ? ' (oben hochladen)' : ''}.</p>
        ) : (
          <>
            <div className="mb-2 flex flex-wrap gap-4 text-sm">
              <div>
                <span className="text-gray-400">Controlling </span>
                <b>{keur(abgleich.gesamt.controllingActual)}</b> kEUR
              </div>
              <div>
                <span className="text-gray-400">Tool-Ist </span>
                <b>{keur(abgleich.gesamt.toolIst)}</b> kEUR
              </div>
              <div>
                <span className="text-gray-400">Δ </span>
                <b className={abgleich.gesamt.deltaEur < 0 ? 'text-ez-accent' : 'text-ez-primary'}>{keur(abgleich.gesamt.deltaEur)}</b> kEUR
                {abgleich.gesamt.deltaProzent !== null && <span className="text-gray-400"> ({abgleich.gesamt.deltaProzent.toLocaleString('de-DE', { maximumFractionDigits: 1 })} %)</span>}
              </div>
            </div>
            <DataTable
              columns={cols}
              rows={abgleich.zeilen}
              rowKey={(r, i) => `${r.regionCode}-${r.produktgruppe}-${r.land}-${i}`}
              initialSort={{ key: 'delta', dir: 'asc' }}
              dicht
              globaleSuche
              spaltenWahl
              tabellenId="sf-detail-abgleich"
              suchePlaceholder="Suche (Region, Produktgruppe, Land …)"
            />
            <p className="mt-2 text-xs text-gray-400">
              Controlling-Actual aus den Region-Excels · Tool-Ist aus dem GL-Import · Δ = Controlling − Tool. Werte in kEUR. Ein Δ ist erwartbar (breitere Controlling-Abgrenzung) — auffällige Zeilen zeigen mögliche Buchungs-/Mapping-Differenzen.
            </p>
          </>
        )}
      </Card>
    </div>
  );
}
