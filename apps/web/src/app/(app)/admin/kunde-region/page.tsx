'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button, Card } from '@/components/ui';
import { DataTable, type Column } from '@/components/data-table';

interface Region {
  code: string;
  bezeichnung: string;
}
interface Mapping {
  id: string;
  kunde: string;
  regionCode: string;
  region: string;
}
interface Unmapped {
  jahr: number | null;
  bisMonat: number | null;
  kunden: { kunde: string; seeds: number }[];
}

const fmt = (n: number): string => n.toLocaleString('de-DE');

export default function KundeRegionPage() {
  const qc = useQueryClient();
  const { data: regionen } = useQuery({ queryKey: ['regionen'], queryFn: () => api.get<Region[]>('/stammdaten/regionen') });
  const { data: mappings } = useQuery({ queryKey: ['kunde-region'], queryFn: () => api.get<Mapping[]>('/absatz/kunde-region') });
  const { data: unmapped } = useQuery({ queryKey: ['kunde-region-unmapped'], queryFn: () => api.get<Unmapped>('/absatz/kunde-region/unmapped') });
  const [auswahl, setAuswahl] = useState<Record<string, string>>({});

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['kunde-region'] });
    qc.invalidateQueries({ queryKey: ['kunde-region-unmapped'] });
  };
  const upsert = useMutation({
    mutationFn: (v: { kunde: string; regionCode: string }) => api.put('/absatz/kunde-region', v),
    onSuccess: invalidate,
  });
  const entfernen = useMutation({
    mutationFn: (kunde: string) => api.del(`/absatz/kunde-region/${encodeURIComponent(kunde)}`),
    onSuccess: invalidate,
  });
  const loeschen = useMutation({
    mutationFn: (kunde: string) => api.del(`/absatz/kunde/${encodeURIComponent(kunde)}`),
    onSuccess: invalidate,
  });
  const loeschenMitConfirm = (kunde: string) => {
    if (window.confirm(`Kunde „${kunde}" und ALLE zugehörigen Absatz-Datensätze dauerhaft löschen?\n\nNur für fehlerhaft importierte Einträge gedacht — kann nicht rückgängig gemacht werden.`)) {
      loeschen.mutate(kunde);
    }
  };

  const speichern = (kunde: string) => {
    const regionCode = auswahl[kunde];
    if (!regionCode) return;
    upsert.mutate({ kunde, regionCode });
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-ez-primary">Kunden → Region-Zuordnung</h1>
        <p className="text-sm text-gray-500">
          Ordnet Kunden aus dem Stückzahl-Import einer Vertriebsregion zu. Erst dadurch sieht ein AGM „seine" Absatzzahlen. Nicht zugeordnete Kunden bleiben nur BU-weit sichtbar.
          Eine Zuordnung wirkt rückwirkend auf bereits importierte Zeilen. <strong>Löschen</strong> entfernt einen fehlerhaft importierten Kunden samt seiner Absatz-Datensätze dauerhaft.
        </p>
      </div>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-ez-primary">
          Nicht zugeordnete Kunden{unmapped?.jahr ? ` (Periode Jan–${String(unmapped.bisMonat).padStart(2, '0')}/${unmapped.jahr})` : ''}
        </h2>
        {!unmapped ? (
          <p className="text-sm text-gray-500">Lädt…</p>
        ) : unmapped.kunden.length === 0 ? (
          <p className="text-sm text-ez-ampelGruen">✓ Alle Kunden der jüngsten Periode sind zugeordnet.</p>
        ) : (
          <DataTable
            rows={unmapped.kunden}
            rowKey={(k) => k.kunde}
            initialSort={{ key: 'seeds', dir: 'desc' }}
            columns={[
              { key: 'kunde', label: 'Kunde', value: (k) => k.kunde },
              { key: 'seeds', label: 'Seeds', filter: 'none', align: 'right', value: (k) => k.seeds, render: (k) => fmt(k.seeds) },
              {
                key: 'region', label: 'Region', filter: 'none', sortable: false,
                render: (k) => (
                  <select className="rounded border border-gray-300 px-2 py-1 text-sm" value={auswahl[k.kunde] ?? ''} onChange={(e) => setAuswahl((a) => ({ ...a, [k.kunde]: e.target.value }))}>
                    <option value="">— wählen —</option>
                    {regionen?.map((r) => <option key={r.code} value={r.code}>{r.code} · {r.bezeichnung}</option>)}
                  </select>
                ),
              },
              {
                key: 'aktion', label: '', filter: 'none', sortable: false, align: 'right',
                render: (k) => (
                  <span className="whitespace-nowrap">
                    <Button variant="ghost" className="px-2 py-1 text-xs" disabled={!auswahl[k.kunde]} onClick={() => speichern(k.kunde)}>Zuordnen</Button>
                    <Button variant="ghost" className="ml-1 px-2 py-1 text-xs text-ez-accent" onClick={() => loeschenMitConfirm(k.kunde)}>Löschen</Button>
                  </span>
                ),
              },
            ] satisfies Column<Unmapped['kunden'][number]>[]}
          />
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-ez-primary">Bestehende Zuordnungen ({mappings?.length ?? 0})</h2>
        {!mappings || mappings.length === 0 ? (
          <p className="text-sm text-gray-500">Noch keine Zuordnungen.</p>
        ) : (
          <DataTable
            rows={mappings}
            rowKey={(m) => m.id}
            initialSort={{ key: 'kunde', dir: 'asc' }}
            columns={[
              { key: 'kunde', label: 'Kunde', value: (m) => m.kunde },
              {
                key: 'region', label: 'Region', filter: 'select', value: (m) => m.regionCode,
                render: (m) => (
                  <select className="rounded border border-gray-300 px-2 py-1 text-sm" value={m.regionCode} onChange={(e) => upsert.mutate({ kunde: m.kunde, regionCode: e.target.value })}>
                    {regionen?.map((r) => <option key={r.code} value={r.code}>{r.code} · {r.bezeichnung}</option>)}
                  </select>
                ),
              },
              {
                key: 'aktion', label: '', filter: 'none', sortable: false, align: 'right',
                render: (m) => (
                  <span className="whitespace-nowrap">
                    <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => entfernen.mutate(m.kunde)}>Zuordnung lösen</Button>
                    <Button variant="ghost" className="ml-1 px-2 py-1 text-xs text-ez-accent" onClick={() => loeschenMitConfirm(m.kunde)}>Löschen</Button>
                  </span>
                ),
              },
            ] satisfies Column<Mapping>[]}
          />
        )}
      </Card>
    </div>
  );
}
