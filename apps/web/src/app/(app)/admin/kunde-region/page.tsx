'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button, Card } from '@/components/ui';

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
          Eine Zuordnung wirkt rückwirkend auf bereits importierte Zeilen.
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
          <table className="w-full text-sm">
            <thead className="text-left text-gray-500">
              <tr>
                <th className="py-1">Kunde</th>
                <th className="py-1 text-right">Seeds</th>
                <th className="py-1">Region</th>
                <th className="py-1"></th>
              </tr>
            </thead>
            <tbody>
              {unmapped.kunden.map((k) => (
                <tr key={k.kunde} className="border-t">
                  <td className="py-1 pr-2">{k.kunde}</td>
                  <td className="py-1 text-right tabular-nums">{fmt(k.seeds)}</td>
                  <td className="py-1">
                    <select
                      className="rounded border border-gray-300 px-2 py-1 text-sm"
                      value={auswahl[k.kunde] ?? ''}
                      onChange={(e) => setAuswahl((a) => ({ ...a, [k.kunde]: e.target.value }))}
                    >
                      <option value="">— wählen —</option>
                      {regionen?.map((r) => (
                        <option key={r.code} value={r.code}>
                          {r.code} · {r.bezeichnung}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1 text-right">
                    <Button variant="ghost" className="px-2 py-1 text-xs" disabled={!auswahl[k.kunde]} onClick={() => speichern(k.kunde)}>
                      Zuordnen
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-ez-primary">Bestehende Zuordnungen ({mappings?.length ?? 0})</h2>
        {!mappings || mappings.length === 0 ? (
          <p className="text-sm text-gray-500">Noch keine Zuordnungen.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-gray-500">
              <tr>
                <th className="py-1">Kunde</th>
                <th className="py-1">Region</th>
                <th className="py-1"></th>
              </tr>
            </thead>
            <tbody>
              {mappings.map((m) => (
                <tr key={m.id} className="border-t">
                  <td className="py-1">{m.kunde}</td>
                  <td className="py-1">
                    <select
                      className="rounded border border-gray-300 px-2 py-1 text-sm"
                      value={m.regionCode}
                      onChange={(e) => upsert.mutate({ kunde: m.kunde, regionCode: e.target.value })}
                    >
                      {regionen?.map((r) => (
                        <option key={r.code} value={r.code}>
                          {r.code} · {r.bezeichnung}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1 text-right">
                    <Button variant="ghost" className="px-2 py-1 text-xs text-ez-accent" onClick={() => entfernen.mutate(m.kunde)}>
                      Entfernen
                    </Button>
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
