'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { Button, Card } from '@/components/ui';
import { DataTable, type Column } from '@/components/data-table';

interface Match {
  id: string;
  name: string;
  score: number;
}
interface Vorschlag {
  dataAreaId: string;
  kundennummer: string;
  name: string;
  stadt: string | null;
  landIso: string | null;
  kundengruppe: string | null;
  matches: Match[];
}
interface VorschlaegeResp {
  offenGesamt: number;
  vorschlaege: Vorschlag[];
}
interface StatusResp {
  kundenstammGesamt: number;
  verknuepft: number;
  offen: number;
  rechnungskundenGesamt: number;
  rechnungskundenOhneStamm: number;
}
interface OhneStamm {
  gesamt: number;
  kunden: { dataAreaId: string; kundennummer: string; anzahlRechnungen: number; datumVon: string | null; datumBis: string | null }[];
}
interface Region {
  code: string;
  bezeichnung: string;
  forecastRelevant: boolean;
}

type ZuordnenFn = (v: Vorschlag, zielSiteId: string | null, regionCode: string | null) => void;

function VorschlagZeile({ v, regionen, onZuordnen }: { v: Vorschlag; regionen: Region[]; onZuordnen: ZuordnenFn }) {
  const [zielId, setZielId] = useState(v.matches[0]?.id ?? '');
  const [region, setRegion] = useState('');
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 py-2 text-sm">
      <div className="min-w-[240px] flex-1">
        <div className="font-medium text-gray-800">
          {v.name} <span className="text-xs font-normal text-gray-400">· {v.dataAreaId}/{v.kundennummer}</span>
        </div>
        <div className="text-xs text-gray-500">
          {[v.stadt, v.landIso, v.kundengruppe].filter(Boolean).join(' · ') || 'ohne Ort'}
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
            <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => onZuordnen(v, zielId, null)}>
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
        <Button className="px-2 py-1 text-xs" onClick={() => onZuordnen(v, null, region || null)}>
          Neu anlegen
        </Button>
      </div>
    </div>
  );
}

export default function KundenabgleichPage() {
  const qc = useQueryClient();
  const [fehler, setFehler] = useState('');

  const { data: status } = useQuery({ queryKey: ['abgleich-status'], queryFn: () => api.get<StatusResp>('/kundenabgleich/status') });
  const { data: vorschl } = useQuery({ queryKey: ['abgleich-vorschlaege'], queryFn: () => api.get<VorschlaegeResp>('/kundenabgleich/vorschlaege') });
  const { data: ohneStamm } = useQuery({ queryKey: ['abgleich-ohne-stamm'], queryFn: () => api.get<OhneStamm>('/kundenabgleich/rechnungskunden-ohne-stamm') });
  const { data: regionen } = useQuery({ queryKey: ['regionen'], queryFn: () => api.get<Region[]>('/stammdaten/regionen') });
  const formRegionen = (regionen ?? []).filter((r) => r.forecastRelevant);

  const reload = () => {
    qc.invalidateQueries({ queryKey: ['abgleich-status'] });
    qc.invalidateQueries({ queryKey: ['abgleich-vorschlaege'] });
  };

  const zuordnen: ZuordnenFn = async (v, zielSiteId, regionCode) => {
    setFehler('');
    try {
      await api.post('/kundenabgleich/zuordnen', {
        dataAreaId: v.dataAreaId,
        kundennummer: v.kundennummer,
        zielSiteId: zielSiteId ?? undefined,
        regionCode: regionCode ?? undefined,
      });
      reload();
    } catch (e) {
      setFehler(e instanceof ApiError ? e.message : 'Fehler.');
    }
  };

  const datum = (s: string | null) => (s ? new Date(s).toLocaleDateString('de-DE') : '—');

  type OhneStammRow = OhneStamm['kunden'][number];
  const ohneStammColumns: Column<OhneStammRow>[] = [
    { key: 'dataAreaId', label: 'Gesellschaft', value: (k) => k.dataAreaId, filter: 'select' },
    { key: 'kundennummer', label: 'Kundennummer', value: (k) => k.kundennummer, render: (k) => <span className="font-medium text-gray-800">{k.kundennummer}</span> },
    { key: 'anzahlRechnungen', label: 'Rechnungen', value: (k) => k.anzahlRechnungen, align: 'right', filter: 'none' },
    { key: 'datumVon', label: 'von', value: (k) => (k.datumVon ? new Date(k.datumVon).getTime() : 0), render: (k) => datum(k.datumVon), filter: 'none' },
    { key: 'datumBis', label: 'bis', value: (k) => (k.datumBis ? new Date(k.datumBis).getTime() : 0), render: (k) => datum(k.datumBis), filter: 'none' },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-ez-primary">Kundenstamm-Abgleich</h1>
        <p className="text-sm text-gray-500">
          Gleicht den importierten D365-Kundenstamm gegen die vorhandenen Standorte ab. Treffer werden per Fuzzy-Match
          <strong> vorgeschlagen und manuell bestätigt</strong> — nie automatisch zugeordnet.
        </p>
      </div>
      {fehler && <p className="rounded bg-ez-accent/10 p-2 text-sm text-ez-accent">{fehler}</p>}

      <Card>
        <h2 className="mb-2 font-semibold text-ez-primary">Übersicht</h2>
        {!status ? (
          <p className="text-sm text-gray-500">Lädt…</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
            <div className="rounded bg-gray-50 p-3"><div className="text-xs text-gray-500">Kundenstamm</div><div className="text-lg font-semibold">{status.kundenstammGesamt}</div></div>
            <div className="rounded bg-gray-50 p-3"><div className="text-xs text-gray-500">verknüpft</div><div className="text-lg font-semibold text-ez-ampelGruen">{status.verknuepft}</div></div>
            <div className="rounded bg-gray-50 p-3"><div className="text-xs text-gray-500">offen</div><div className="text-lg font-semibold text-yellow-700">{status.offen}</div></div>
            <div className="rounded bg-gray-50 p-3"><div className="text-xs text-gray-500">Rechnungskunden</div><div className="text-lg font-semibold">{status.rechnungskundenGesamt}</div></div>
            <div className="rounded bg-gray-50 p-3"><div className="text-xs text-gray-500">davon ohne Stamm</div><div className="text-lg font-semibold text-ez-accent">{status.rechnungskundenOhneStamm}</div></div>
          </div>
        )}
      </Card>

      <Card className="space-y-1">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-ez-primary">Zuzuordnende D365-Kunden</h2>
          <span className="text-xs text-gray-500">{vorschl ? `${vorschl.offenGesamt} offen` : ''}</span>
        </div>
        {!vorschl && <p className="text-sm text-gray-500">Lädt…</p>}
        {vorschl && vorschl.vorschlaege.length === 0 && <p className="py-2 text-sm text-gray-500">Keine offenen Zuordnungen — alle Kundenstamm-Einträge sind einem Standort zugeordnet.</p>}
        {vorschl?.vorschlaege.map((v) => (
          <VorschlagZeile key={`${v.dataAreaId}|${v.kundennummer}`} v={v} regionen={formRegionen} onZuordnen={zuordnen} />
        ))}
      </Card>

      <Card>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold text-ez-primary">Rechnungskunden ohne Stamm</h2>
          <span className="text-xs text-gray-500">{ohneStamm ? `${ohneStamm.gesamt}` : ''}</span>
        </div>
        <p className="mb-2 text-xs text-gray-500">Kunden, die in Rechnungen vorkommen, aber nicht im D365-Kundenstamm stehen — überwiegend Intercompany- und Altkonten. Nur zur Sichtung (Rechnungen tragen keinen Kundennamen).</p>
        {ohneStamm && (
          <DataTable
            rows={ohneStamm.kunden}
            rowKey={(k) => `${k.dataAreaId}|${k.kundennummer}`}
            initialSort={{ key: 'anzahlRechnungen', dir: 'desc' }}
            leerText="Alle Rechnungskunden sind im Stamm vorhanden."
            columns={ohneStammColumns}
          />
        )}
      </Card>
    </div>
  );
}
