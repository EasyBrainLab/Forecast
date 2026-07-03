'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, Card, Ampel, keur } from '@/components/ui';

const STATUS_LABEL: Record<string, string> = {
  BEOBACHTET: 'Beobachtet',
  EINGEREICHT: 'Eingereicht',
  GEWONNEN: 'Gewonnen',
  VERLOREN: 'Verloren',
  STORNIERT: 'Storniert',
};
const STATUS_REIHENFOLGE = ['BEOBACHTET', 'EINGEREICHT', 'GEWONNEN', 'VERLOREN', 'STORNIERT'];
const ABGESCHLOSSEN = new Set(['GEWONNEN', 'VERLOREN', 'STORNIERT']);
const TAG_MS = 24 * 60 * 60 * 1000;

interface Los {
  id?: string;
  bezeichnung: string;
  volumenEur: number | null;
  menge: number | null;
}
interface Tender {
  id: string;
  referenznummer: string;
  krankenhaus: string;
  stadt: string | null;
  landIso: string | null;
  regionCode: string | null;
  veroeffentlichtAm: string | null;
  abgabefrist: string;
  status: string;
  wettbewerber: string[];
  eigenerPreisEur: number | null;
  wettbewerbPreisEur: number | null;
  notiz: string | null;
  erstelltVon: string;
  erstelltAm: string;
  aktualisiertAm: string;
  lose: Los[];
}
interface Region {
  code: string;
  bezeichnung: string;
  forecastRelevant: boolean;
}
interface Competitor {
  id: string;
  name: string;
  aktiv: boolean;
}

function resttage(frist: string): number {
  return Math.ceil((new Date(frist).getTime() - Date.now()) / TAG_MS);
}
function statusBadge(status: string): string {
  switch (status) {
    case 'GEWONNEN':
      return 'bg-ez-ampelGruen/15 text-ez-ampelGruen';
    case 'VERLOREN':
      return 'bg-ez-accent/10 text-ez-accent';
    case 'EINGEREICHT':
      return 'bg-ez-primary/10 text-ez-primary';
    default:
      return 'bg-gray-100 text-gray-600';
  }
}
function dringlichkeit(t: Tender): { farbe: 'gruen' | 'gelb' | 'rot' | 'grau'; text: string } {
  if (ABGESCHLOSSEN.has(t.status)) return { farbe: 'grau', text: STATUS_LABEL[t.status] };
  const r = resttage(t.abgabefrist);
  if (r < 0) return { farbe: 'rot', text: `überfällig (${Math.abs(r)} T)` };
  if (r <= 7) return { farbe: 'rot', text: `noch ${r} T` };
  if (r <= 30) return { farbe: 'gelb', text: `noch ${r} T` };
  return { farbe: 'gruen', text: `noch ${r} T` };
}

type LosDraft = { bezeichnung: string; volumenEur: string; menge: string };
interface Draft {
  referenznummer: string;
  krankenhaus: string;
  stadt: string;
  landIso: string;
  regionCode: string;
  veroeffentlichtAm: string;
  abgabefrist: string;
  wettbewerber: string[];
  eigenerPreisEur: string;
  wettbewerbPreisEur: string;
  notiz: string;
  lose: LosDraft[];
}
const leererDraft = (): Draft => ({
  referenznummer: '',
  krankenhaus: '',
  stadt: '',
  landIso: '',
  regionCode: '',
  veroeffentlichtAm: '',
  abgabefrist: '',
  wettbewerber: [],
  eigenerPreisEur: '',
  wettbewerbPreisEur: '',
  notiz: '',
  lose: [],
});
const ausTender = (t: Tender): Draft => ({
  referenznummer: t.referenznummer,
  krankenhaus: t.krankenhaus,
  stadt: t.stadt ?? '',
  landIso: t.landIso ?? '',
  regionCode: t.regionCode ?? '',
  veroeffentlichtAm: t.veroeffentlichtAm ? t.veroeffentlichtAm.slice(0, 10) : '',
  abgabefrist: t.abgabefrist ? t.abgabefrist.slice(0, 10) : '',
  wettbewerber: t.wettbewerber,
  eigenerPreisEur: t.eigenerPreisEur != null ? String(t.eigenerPreisEur) : '',
  wettbewerbPreisEur: t.wettbewerbPreisEur != null ? String(t.wettbewerbPreisEur) : '',
  notiz: t.notiz ?? '',
  lose: t.lose.map((l) => ({ bezeichnung: l.bezeichnung, volumenEur: l.volumenEur != null ? String(l.volumenEur) : '', menge: l.menge != null ? String(l.menge) : '' })),
});

function Textfeld({ label, value, onChange, type = 'text', placeholder }: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">{label}</label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-ez-primary focus:outline-none"
      />
    </div>
  );
}

function TenderForm({ bearbeiten, regionen, competitor, istAgm, onFertig, onAbbrechen }: { bearbeiten: Tender | null; regionen: Region[]; competitor: Competitor[]; istAgm: boolean; onFertig: () => void; onAbbrechen: () => void }) {
  const [d, setD] = useState<Draft>(bearbeiten ? ausTender(bearbeiten) : leererDraft());
  const [fehler, setFehler] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setD(bearbeiten ? ausTender(bearbeiten) : leererDraft());
    setFehler('');
  }, [bearbeiten]);

  const upd = (patch: Partial<Draft>) => setD((cur) => ({ ...cur, ...patch }));
  const setLos = (i: number, patch: Partial<LosDraft>) => upd({ lose: d.lose.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  // Auswahlliste = aktive Wettbewerber + bereits gewählte (falls zwischenzeitlich deaktiviert, bleiben sie sichtbar).
  const wbNamen = [...competitor.map((c) => c.name)];
  d.wettbewerber.forEach((w) => {
    if (!wbNamen.includes(w)) wbNamen.push(w);
  });

  const speichern = async () => {
    setFehler('');
    if (!d.referenznummer.trim()) return setFehler('Referenznummer ist erforderlich.');
    if (!d.krankenhaus.trim()) return setFehler('Krankenhaus/Standort ist erforderlich.');
    if (!d.abgabefrist) return setFehler('Abgabefrist ist erforderlich.');
    if (istAgm && !d.regionCode) return setFehler('Bitte eine Region zuordnen.');
    const zahl = (s: string): number | null => (s.trim() ? Number(s.replace(',', '.')) : null);
    const payload = {
      referenznummer: d.referenznummer.trim(),
      krankenhaus: d.krankenhaus.trim(),
      stadt: d.stadt.trim() || null,
      landIso: d.landIso.trim() || null,
      regionCode: d.regionCode || null,
      veroeffentlichtAm: d.veroeffentlichtAm || null,
      abgabefrist: d.abgabefrist,
      wettbewerber: d.wettbewerber,
      eigenerPreisEur: zahl(d.eigenerPreisEur),
      wettbewerbPreisEur: zahl(d.wettbewerbPreisEur),
      notiz: d.notiz.trim() || null,
      lose: d.lose.filter((l) => l.bezeichnung.trim()).map((l) => ({ bezeichnung: l.bezeichnung.trim(), volumenEur: zahl(l.volumenEur), menge: zahl(l.menge) })),
    };
    setBusy(true);
    try {
      if (bearbeiten) await api.put(`/tender/${bearbeiten.id}`, payload);
      else await api.post('/tender', payload);
      onFertig();
    } catch (e) {
      setFehler(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-3 border-ez-primary/40">
      <h3 className="font-semibold text-ez-primary">{bearbeiten ? 'Ausschreibung bearbeiten' : 'Neue Ausschreibung'}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <Textfeld label="Referenznummer *" value={d.referenznummer} onChange={(v) => upd({ referenznummer: v })} placeholder="z. B. ES-2026-0815" />
        <Textfeld label="Krankenhaus / Standort *" value={d.krankenhaus} onChange={(v) => upd({ krankenhaus: v })} />
        <Textfeld label="Stadt" value={d.stadt} onChange={(v) => upd({ stadt: v })} />
        <Textfeld label="Land (ISO, z. B. ES)" value={d.landIso} onChange={(v) => upd({ landIso: v.toUpperCase() })} />
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Region {istAgm ? '*' : ''}</label>
          <select className="w-full rounded border border-gray-300 px-3 py-2 text-sm" value={d.regionCode} onChange={(e) => upd({ regionCode: e.target.value })}>
            <option value="">— keine —</option>
            {regionen.map((r) => (
              <option key={r.code} value={r.code}>
                {r.code} · {r.bezeichnung}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Textfeld label="Veröffentlicht am" type="date" value={d.veroeffentlichtAm} onChange={(v) => upd({ veroeffentlichtAm: v })} />
          <Textfeld label="Abgabefrist *" type="date" value={d.abgabefrist} onChange={(v) => upd({ abgabefrist: v })} />
        </div>
        <Textfeld label="Eigener Preis / Einheit (EUR)" value={d.eigenerPreisEur} onChange={(v) => upd({ eigenerPreisEur: v })} />
        <Textfeld label="Wettbewerbspreis / Einheit (EUR)" value={d.wettbewerbPreisEur} onChange={(v) => upd({ wettbewerbPreisEur: v })} />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">Wettbewerber (aus Stammliste)</label>
        {wbNamen.length === 0 ? (
          <p className="text-xs text-gray-400">Keine Wettbewerber gepflegt — bitte unter „Wettbewerber" (Admin) anlegen.</p>
        ) : (
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {wbNamen.map((n) => (
              <label key={n} className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={d.wettbewerber.includes(n)}
                  onChange={(e) => upd({ wettbewerber: e.target.checked ? [...d.wettbewerber, n] : d.wettbewerber.filter((x) => x !== n) })}
                />
                {n}
              </label>
            ))}
          </div>
        )}
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">Notiz</label>
        <textarea className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-ez-primary focus:outline-none" rows={2} value={d.notiz} onChange={(e) => upd({ notiz: e.target.value })} />
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">Lose</span>
          <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => upd({ lose: [...d.lose, { bezeichnung: '', volumenEur: '', menge: '' }] })}>
            + Los
          </Button>
        </div>
        {d.lose.length === 0 && <p className="text-xs text-gray-400">Keine Lose erfasst.</p>}
        <div className="space-y-2">
          {d.lose.map((l, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <input className="min-w-[180px] flex-1 rounded border border-gray-300 px-2 py-1 text-sm" placeholder="Bezeichnung" value={l.bezeichnung} onChange={(e) => setLos(i, { bezeichnung: e.target.value })} />
              <input className="w-32 rounded border border-gray-300 px-2 py-1 text-sm" placeholder="Volumen EUR" value={l.volumenEur} onChange={(e) => setLos(i, { volumenEur: e.target.value })} />
              <input className="w-24 rounded border border-gray-300 px-2 py-1 text-sm" placeholder="Menge" value={l.menge} onChange={(e) => setLos(i, { menge: e.target.value })} />
              <button className="text-xs text-ez-accent" onClick={() => upd({ lose: d.lose.filter((_, j) => j !== i) })}>
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      {fehler && <p className="rounded bg-ez-accent/10 p-2 text-sm text-ez-accent">{fehler}</p>}
      <div className="flex gap-2">
        <Button onClick={speichern} disabled={busy}>
          {busy ? 'Speichert…' : bearbeiten ? 'Änderungen speichern' : 'Ausschreibung anlegen'}
        </Button>
        <Button variant="ghost" onClick={onAbbrechen}>
          Abbrechen
        </Button>
      </div>
    </Card>
  );
}

function TenderCard({ t, darfBearbeiten, darfLoeschen, onBearbeiten, onReload }: { t: Tender; darfBearbeiten: boolean; darfLoeschen: boolean; onBearbeiten: (t: Tender) => void; onReload: () => void }) {
  const [fehler, setFehler] = useState('');
  const dr = dringlichkeit(t);
  const volumen = t.lose.reduce((sum, l) => sum + (l.volumenEur ?? 0), 0);

  const statusSetzen = async (status: string) => {
    setFehler('');
    try {
      await api.post(`/tender/${t.id}/status`, { status });
      onReload();
    } catch (e) {
      setFehler(e instanceof ApiError ? e.message : 'Fehler.');
    }
  };
  const loeschen = async () => {
    if (!window.confirm(`Ausschreibung „${t.referenznummer}" wirklich löschen?`)) return;
    setFehler('');
    try {
      await api.del(`/tender/${t.id}`);
      onReload();
    } catch (e) {
      setFehler(e instanceof ApiError ? e.message : 'Fehler.');
    }
  };

  return (
    <Card className="space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Ampel farbe={dr.farbe} />
          <div>
            <div className="font-semibold text-ez-primary">{t.referenznummer}</div>
            <div className="text-sm text-gray-600">
              {t.krankenhaus}
              {t.stadt ? `, ${t.stadt}` : ''}
              {t.landIso ? ` (${t.landIso})` : ''}
              {t.regionCode ? ` · ${t.regionCode}` : ''}
            </div>
          </div>
        </div>
        <div className="text-right">
          <span className={`rounded px-2 py-0.5 text-xs ${statusBadge(t.status)}`}>{STATUS_LABEL[t.status] ?? t.status}</span>
          <div className={`mt-1 text-xs ${dr.farbe === 'rot' ? 'text-ez-accent' : 'text-gray-500'}`}>
            Frist {new Date(t.abgabefrist).toLocaleDateString('de-DE')} · {dr.text}
          </div>
        </div>
      </div>

      {(t.lose.length > 0 || t.wettbewerber.length > 0 || t.eigenerPreisEur != null) && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-600">
          {t.lose.length > 0 && (
            <span>
              {t.lose.length} Los(e){volumen > 0 ? ` · Σ ${keur(volumen)} kEUR` : ''}
            </span>
          )}
          {t.wettbewerber.length > 0 && <span>Wettbewerb: {t.wettbewerber.join(', ')}</span>}
          {t.eigenerPreisEur != null && (
            <span>
              Preis eigen {t.eigenerPreisEur.toLocaleString('de-DE')} €{t.wettbewerbPreisEur != null ? ` vs. ${t.wettbewerbPreisEur.toLocaleString('de-DE')} €` : ''}
            </span>
          )}
        </div>
      )}
      {t.notiz && <p className="text-sm text-gray-600">{t.notiz}</p>}

      {(darfBearbeiten || darfLoeschen) && (
        <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-2">
          {darfBearbeiten && !ABGESCHLOSSEN.has(t.status) && (
            <select className="rounded border border-gray-300 px-2 py-1 text-xs" value="" onChange={(e) => e.target.value && statusSetzen(e.target.value)}>
              <option value="">Status ändern…</option>
              {STATUS_REIHENFOLGE.filter((s) => s !== t.status).map((s) => (
                <option key={s} value={s}>
                  → {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          )}
          {darfBearbeiten && (
            <button className="text-xs text-ez-primary hover:underline" onClick={() => onBearbeiten(t)}>
              Bearbeiten
            </button>
          )}
          {darfLoeschen && (
            <button className="text-xs text-ez-accent hover:underline" onClick={loeschen}>
              Löschen
            </button>
          )}
          {fehler && <span className="text-xs text-ez-accent">{fehler}</span>}
        </div>
      )}
    </Card>
  );
}

export default function TenderPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [formOffen, setFormOffen] = useState(false);
  const [bearbeiten, setBearbeiten] = useState<Tender | null>(null);

  const rolle = user?.rolle;
  const darfErstellen = rolle === 'AGM' || rolle === 'VERTRIEBSLEITER' || rolle === 'BU_LEITER' || rolle === 'ADMIN';
  const darfLoeschen = rolle === 'BU_LEITER' || rolle === 'ADMIN';
  const istAgm = rolle === 'AGM';

  const { data: tender, isLoading } = useQuery({
    queryKey: ['tender', statusFilter],
    queryFn: () => api.get<Tender[]>(`/tender${statusFilter ? `?status=${statusFilter}` : ''}`),
  });
  const { data: regionen } = useQuery({ queryKey: ['regionen'], queryFn: () => api.get<Region[]>('/stammdaten/regionen') });
  const { data: competitor } = useQuery({ queryKey: ['competitor-aktiv'], queryFn: () => api.get<Competitor[]>('/competitor?nurAktiv=true') });

  const reload = () => qc.invalidateQueries({ queryKey: ['tender'] });
  const formRegionen = useMemo(() => (regionen ?? []).filter((r) => r.forecastRelevant), [regionen]);

  const oeffnenNeu = () => {
    setBearbeiten(null);
    setFormOffen(true);
  };
  const oeffnenBearbeiten = (t: Tender) => {
    setBearbeiten(t);
    setFormOffen(true);
  };
  const schliessen = () => {
    setFormOffen(false);
    setBearbeiten(null);
  };

  const offeneCount = (tender ?? []).filter((t) => !ABGESCHLOSSEN.has(t.status)).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ez-primary">Ausschreibungen / Tender</h1>
          <p className="text-sm text-gray-500">Öffentliche Ausschreibungen mit Fristen und Status. {offeneCount} offen. Erinnerungen an die zuständige Region 14/7/3/1 Tage vor Frist.</p>
        </div>
        <div className="flex items-center gap-2">
          <select className="rounded border border-gray-300 px-2 py-1 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">Alle Status</option>
            {STATUS_REIHENFOLGE.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          {darfErstellen && !formOffen && <Button onClick={oeffnenNeu}>+ Neue Ausschreibung</Button>}
        </div>
      </div>

      {formOffen && <TenderForm bearbeiten={bearbeiten} regionen={formRegionen} competitor={competitor ?? []} istAgm={istAgm} onFertig={() => { schliessen(); reload(); }} onAbbrechen={schliessen} />}

      {isLoading && <p className="text-gray-500">Lädt…</p>}
      {tender && tender.length === 0 && (
        <Card>
          <p className="text-gray-600">Keine Ausschreibungen erfasst{statusFilter ? ' (für diesen Status)' : ''}.</p>
        </Card>
      )}
      <div className="space-y-3">
        {(tender ?? []).map((t) => (
          <TenderCard key={t.id} t={t} darfBearbeiten={darfErstellen} darfLoeschen={darfLoeschen} onBearbeiten={oeffnenBearbeiten} onReload={reload} />
        ))}
      </div>
    </div>
  );
}
