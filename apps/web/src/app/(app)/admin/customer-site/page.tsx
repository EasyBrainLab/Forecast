'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { Button, Card, Input, Ampel } from '@/components/ui';

const TYP_LABEL: Record<string, string> = { OEFFENTLICH: 'Öffentlich', PRIVAT: 'Privat', UNBEKANNT: 'Unbekannt' };
const STATUS_LABEL: Record<string, string> = { NEU: 'Neu', AKTIV: 'Aktiv', GEFAEHRDET: 'Gefährdet', VERLOREN: 'Verloren', ZURUECKGEWONNEN: 'Zurückgewonnen' };
const STATUS_AMPEL: Record<string, 'gruen' | 'gelb' | 'rot' | 'grau'> = { AKTIV: 'gruen', GEFAEHRDET: 'gelb', VERLOREN: 'rot', ZURUECKGEWONNEN: 'gruen', NEU: 'grau' };

interface Match {
  id: string;
  name: string;
  score: number;
}
interface Vorschlag {
  kunde: string;
  stadt: string | null;
  landIso: string | null;
  regionVorschlag: string | null;
  matches: Match[];
}
interface VorschlaegeResp {
  offenGesamt: number;
  vorschlaege: Vorschlag[];
}
interface Site {
  id: string;
  name: string;
  stadt: string | null;
  landIso: string | null;
  regionCode: string | null;
  typ: string;
  status: string;
  notiz: string | null;
  quellNamen: string[];
}
interface Region {
  code: string;
  bezeichnung: string;
  forecastRelevant: boolean;
}

function VorschlagZeile({ v, regionen, onZuordnen }: { v: Vorschlag; regionen: Region[]; onZuordnen: (kunde: string, zielSiteId: string | null, regionCode: string | null) => void }) {
  const [zielId, setZielId] = useState(v.matches[0]?.id ?? '');
  const [region, setRegion] = useState(v.regionVorschlag ?? '');
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 py-2 text-sm">
      <div className="min-w-[220px] flex-1">
        <div className="font-medium text-gray-800">{v.kunde}</div>
        <div className="text-xs text-gray-500">
          {[v.stadt, v.landIso].filter(Boolean).join(', ') || 'ohne Ort'}
          {v.matches.length > 0 && ` · bester Treffer ${Math.round((v.matches[0]?.score ?? 0) * 100)} %`}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {v.matches.length > 0 && (
          <>
            <select className="rounded border border-gray-300 px-2 py-1 text-xs" value={zielId} onChange={(e) => setZielId(e.target.value)}>
              {v.matches.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({Math.round(m.score * 100)} %)
                </option>
              ))}
            </select>
            <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => onZuordnen(v.kunde, zielId, null)}>
              Zuordnen
            </Button>
          </>
        )}
        <select className="rounded border border-gray-300 px-2 py-1 text-xs" value={region} onChange={(e) => setRegion(e.target.value)}>
          <option value="">Region…</option>
          {regionen.map((r) => (
            <option key={r.code} value={r.code}>
              {r.code}
            </option>
          ))}
        </select>
        <Button className="px-2 py-1 text-xs" onClick={() => onZuordnen(v.kunde, null, region || null)}>
          Neu anlegen
        </Button>
      </div>
    </div>
  );
}

export default function CustomerSitePage() {
  const qc = useQueryClient();
  const [fehler, setFehler] = useState('');
  const [neu, setNeu] = useState({ name: '', stadt: '', landIso: '', regionCode: '' });

  const { data: vorschl } = useQuery({ queryKey: ['site-vorschlaege'], queryFn: () => api.get<VorschlaegeResp>('/customer-site/vorschlaege') });
  const { data: sites } = useQuery({ queryKey: ['sites'], queryFn: () => api.get<Site[]>('/customer-site') });
  const { data: regionen } = useQuery({ queryKey: ['regionen'], queryFn: () => api.get<Region[]>('/stammdaten/regionen') });
  const formRegionen = (regionen ?? []).filter((r) => r.forecastRelevant);

  const reload = () => {
    qc.invalidateQueries({ queryKey: ['site-vorschlaege'] });
    qc.invalidateQueries({ queryKey: ['sites'] });
  };
  const fehlerVon = (e: unknown) => setFehler(e instanceof ApiError ? e.message : 'Fehler.');

  const zuordnen = async (kunde: string, zielSiteId: string | null, regionCode: string | null) => {
    setFehler('');
    try {
      await api.post('/customer-site/zuordnen', { kunde, zielSiteId: zielSiteId ?? undefined, regionCode: regionCode ?? undefined });
      reload();
    } catch (e) {
      fehlerVon(e);
    }
  };
  const patch = async (s: Site, data: Partial<Site>) => {
    setFehler('');
    try {
      await api.put(`/customer-site/${s.id}`, data);
      reload();
    } catch (e) {
      fehlerVon(e);
    }
  };
  const statusSetzen = async (s: Site, status: string) => {
    setFehler('');
    try {
      await api.post(`/customer-site/${s.id}/status`, { status });
      reload();
    } catch (e) {
      fehlerVon(e);
    }
  };
  const loeschen = async (s: Site) => {
    if (!window.confirm(`Standort „${s.name}" löschen?`)) return;
    setFehler('');
    try {
      await api.del(`/customer-site/${s.id}`);
      reload();
    } catch (e) {
      fehlerVon(e);
    }
  };
  const anlegen = async () => {
    setFehler('');
    if (!neu.name.trim()) return setFehler('Name ist erforderlich.');
    try {
      await api.post('/customer-site', { name: neu.name.trim(), stadt: neu.stadt || undefined, landIso: neu.landIso || undefined, regionCode: neu.regionCode || undefined });
      setNeu({ name: '', stadt: '', landIso: '', regionCode: '' });
      reload();
    } catch (e) {
      fehlerVon(e);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-ez-primary">Standorte / Kliniken</h1>
        <p className="text-sm text-gray-500">
          Klinik-/Standort-Stammdaten. Aus dem Absatz-Import gemeldete Kunden werden per Fuzzy-Match vorgeschlagen und
          <strong> manuell bestätigt</strong> — nie automatisch zugeordnet.
        </p>
      </div>
      {fehler && <p className="rounded bg-ez-accent/10 p-2 text-sm text-ez-accent">{fehler}</p>}

      <Card className="space-y-2">
        <h2 className="font-semibold text-ez-primary">Standort manuell anlegen</h2>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-gray-600">Name</label>
            <Input value={neu.name} onChange={(e) => setNeu({ ...neu, name: e.target.value })} />
          </div>
          <div className="w-32">
            <label className="mb-1 block text-xs font-medium text-gray-600">Stadt</label>
            <Input value={neu.stadt} onChange={(e) => setNeu({ ...neu, stadt: e.target.value })} />
          </div>
          <div className="w-20">
            <label className="mb-1 block text-xs font-medium text-gray-600">Land</label>
            <Input value={neu.landIso} onChange={(e) => setNeu({ ...neu, landIso: e.target.value.toUpperCase() })} />
          </div>
          <div className="w-28">
            <label className="mb-1 block text-xs font-medium text-gray-600">Region</label>
            <select className="w-full rounded border border-gray-300 px-2 py-2 text-sm" value={neu.regionCode} onChange={(e) => setNeu({ ...neu, regionCode: e.target.value })}>
              <option value="">—</option>
              {formRegionen.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.code}
                </option>
              ))}
            </select>
          </div>
          <Button onClick={anlegen}>Anlegen</Button>
        </div>
      </Card>

      <Card className="space-y-1">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-ez-primary">Zuzuordnende Standorte (aus Absatz-Import)</h2>
          <span className="text-xs text-gray-500">{vorschl ? `${vorschl.offenGesamt} offen` : ''}</span>
        </div>
        {!vorschl && <p className="text-sm text-gray-500">Lädt…</p>}
        {vorschl && vorschl.vorschlaege.length === 0 && <p className="py-2 text-sm text-gray-500">Keine offenen Zuordnungen — alle importierten Kunden sind einem Standort zugeordnet.</p>}
        {vorschl?.vorschlaege.map((v) => (
          <VorschlagZeile key={v.kunde} v={v} regionen={formRegionen} onZuordnen={zuordnen} />
        ))}
      </Card>

      <Card>
        <h2 className="mb-2 font-semibold text-ez-primary">Standort-Stammdaten {sites ? `(${sites.length})` : ''}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-500">
                <th className="py-2">Name</th>
                <th className="py-2">Ort</th>
                <th className="py-2">Region</th>
                <th className="py-2">Typ</th>
                <th className="py-2">Status</th>
                <th className="py-2">Quellen</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {(sites ?? []).map((s) => (
                <tr key={s.id} className="border-b border-gray-100">
                  <td className="py-2 pr-2 font-medium text-gray-800">{s.name}</td>
                  <td className="py-2 pr-2 text-gray-600">{[s.stadt, s.landIso].filter(Boolean).join(', ') || '—'}</td>
                  <td className="py-2 pr-2">
                    <select className="rounded border border-gray-300 px-1 py-1 text-xs" value={s.regionCode ?? ''} onChange={(e) => patch(s, { regionCode: e.target.value || null })}>
                      <option value="">—</option>
                      {formRegionen.map((r) => (
                        <option key={r.code} value={r.code}>
                          {r.code}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 pr-2">
                    <select className="rounded border border-gray-300 px-1 py-1 text-xs" value={s.typ} onChange={(e) => patch(s, { typ: e.target.value })}>
                      {Object.entries(TYP_LABEL).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 pr-2">
                    <span className="inline-flex items-center gap-1">
                      <Ampel farbe={STATUS_AMPEL[s.status] ?? 'grau'} />
                      <select className="rounded border border-gray-300 px-1 py-1 text-xs" value={s.status} onChange={(e) => statusSetzen(s, e.target.value)}>
                        {Object.entries(STATUS_LABEL).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </span>
                  </td>
                  <td className="py-2 pr-2 text-xs text-gray-500" title={s.quellNamen.join('\n')}>
                    {s.quellNamen.length}
                  </td>
                  <td className="py-2 text-right">
                    <button className="text-xs text-ez-accent hover:underline" onClick={() => loeschen(s)}>
                      Löschen
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {sites && sites.length === 0 && <p className="py-3 text-gray-500">Noch keine Standorte erfasst.</p>}
        </div>
      </Card>
    </div>
  );
}
