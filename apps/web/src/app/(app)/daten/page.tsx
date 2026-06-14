'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button, Card } from '@/components/ui';

interface Region {
  code: string;
  bezeichnung: string;
}
interface E1 {
  id: string;
  nameDe: string;
}
interface IstRow {
  recid: string;
  buchungsdatum: string;
  jahr: number;
  monat: number;
  regionCode: string;
  land: string;
  produktgruppe: string;
  e2: string;
  kostentraeger: string;
  wertEur: number;
  istSondereffekt: boolean;
}
interface BudgetRow {
  id: string;
  jahr: number;
  monat: number | null;
  regionCode: string;
  land: string;
  produktgruppe: string;
  e2: string;
  wertEur: number | null;
  units: number | null;
  version: number;
}
interface Page<T> {
  items: T[];
  total: number;
  summeEur: number;
  page: number;
  pageSize: number;
}

const eur = (v: number | null): string => (v === null ? '—' : v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export default function DatenPage() {
  const [tab, setTab] = useState<'ist' | 'budget'>('ist');
  const [jahr, setJahr] = useState(2026);
  const [regionCode, setRegionCode] = useState('');
  const [e1Id, setE1Id] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const { data: regionen } = useQuery({ queryKey: ['regionen'], queryFn: () => api.get<Region[]>('/stammdaten/regionen') });
  const { data: pg } = useQuery({ queryKey: ['pg'], queryFn: () => api.get<{ e1: E1[] }>('/stammdaten/produktgruppen') });

  const reset = () => setPage(1);
  const q = `jahr=${jahr}&page=${page}&pageSize=${pageSize}${regionCode ? `&regionCode=${regionCode}` : ''}${e1Id && tab === 'ist' ? `&e1Id=${e1Id}` : ''}`;
  const ist = useQuery({ queryKey: ['ist-daten', q], queryFn: () => api.get<Page<IstRow>>(`/dashboard/ist-daten?${q}`), enabled: tab === 'ist' });
  const budget = useQuery({ queryKey: ['budget-daten', q], queryFn: () => api.get<Page<BudgetRow>>(`/dashboard/budget-daten?${q}`), enabled: tab === 'budget' });

  const aktiv = tab === 'ist' ? ist.data : budget.data;
  const maxPage = aktiv ? Math.max(1, Math.ceil(aktiv.total / pageSize)) : 1;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-ez-primary">Rohdaten</h1>

      <div className="flex gap-2">
        {(['ist', 'budget'] as const).map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t);
              reset();
            }}
            className={`rounded px-4 py-2 text-sm font-medium ${tab === t ? 'bg-ez-primary text-white' : 'bg-white border border-gray-300'}`}
          >
            {t === 'ist' ? 'Ist-Umsätze' : 'Budget'}
          </button>
        ))}
      </div>

      <Card className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs text-gray-500">Jahr</label>
          <select
            className="rounded border border-gray-300 px-2 py-1.5 text-sm"
            value={jahr}
            onChange={(e) => {
              setJahr(Number(e.target.value));
              reset();
            }}
          >
            {[2024, 2025, 2026, 2027, 2028, 2029, 2030].map((j) => (
              <option key={j}>{j}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">Region</label>
          <select
            className="rounded border border-gray-300 px-2 py-1.5 text-sm"
            value={regionCode}
            onChange={(e) => {
              setRegionCode(e.target.value);
              reset();
            }}
          >
            <option value="">Alle</option>
            {regionen?.map((r) => (
              <option key={r.code} value={r.code}>
                {r.code} — {r.bezeichnung}
              </option>
            ))}
          </select>
        </div>
        {tab === 'ist' && (
          <div>
            <label className="mb-1 block text-xs text-gray-500">Produktgruppe</label>
            <select
              className="rounded border border-gray-300 px-2 py-1.5 text-sm"
              value={e1Id}
              onChange={(e) => {
                setE1Id(e.target.value);
                reset();
              }}
            >
              <option value="">Alle</option>
              {pg?.e1.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nameDe}
                </option>
              ))}
            </select>
          </div>
        )}
        {aktiv && (
          <div className="ml-auto text-right text-sm">
            <div className="font-semibold">{aktiv.total.toLocaleString('de-DE')} Zeilen</div>
            <div className="text-gray-500">Σ {eur(aktiv.summeEur)} €</div>
          </div>
        )}
      </Card>

      <Card className="overflow-x-auto p-0">
        {tab === 'ist' ? (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="p-2">Datum</th>
                <th className="p-2">Region</th>
                <th className="p-2">Land</th>
                <th className="p-2">Produktgruppe</th>
                <th className="p-2">E2</th>
                <th className="p-2">KTR</th>
                <th className="p-2 text-right">Wert EUR</th>
              </tr>
            </thead>
            <tbody>
              {ist.data?.items.map((r) => (
                <tr key={r.recid} className={`border-t ${r.istSondereffekt ? 'bg-ez-accent/5' : ''}`}>
                  <td className="p-2 whitespace-nowrap">{new Date(r.buchungsdatum).toLocaleDateString('de-DE')}</td>
                  <td className="p-2">{r.regionCode}</td>
                  <td className="p-2">{r.land}</td>
                  <td className="p-2">{r.produktgruppe}</td>
                  <td className="p-2 text-gray-500">{r.e2}</td>
                  <td className="p-2 text-gray-500">{r.kostentraeger}</td>
                  <td className={`p-2 text-right ${r.wertEur < 0 ? 'text-ez-accent' : ''}`}>{eur(r.wertEur)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="p-2">Jahr</th>
                <th className="p-2">Monat</th>
                <th className="p-2">Region</th>
                <th className="p-2">Land</th>
                <th className="p-2">Produktgruppe</th>
                <th className="p-2">E2</th>
                <th className="p-2 text-right">Wert EUR</th>
                <th className="p-2 text-right">Units</th>
              </tr>
            </thead>
            <tbody>
              {budget.data?.items.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-2">{r.jahr}</td>
                  <td className="p-2">{r.monat ?? 'Jahr'}</td>
                  <td className="p-2">{r.regionCode}</td>
                  <td className="p-2">{r.land}</td>
                  <td className="p-2">{r.produktgruppe}</td>
                  <td className="p-2 text-gray-500">{r.e2}</td>
                  <td className="p-2 text-right">{eur(r.wertEur)}</td>
                  <td className="p-2 text-right text-gray-500">{r.units === null || r.units === undefined ? '—' : r.units.toLocaleString('de-DE')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {(ist.isLoading || budget.isLoading) && <p className="p-3 text-gray-500">Lädt…</p>}
        {aktiv && aktiv.items.length === 0 && <p className="p-3 text-gray-500">Keine Daten für diese Filter.</p>}
      </Card>

      <div className="flex items-center justify-between">
        <Button variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          ← Zurück
        </Button>
        <span className="text-sm text-gray-500">
          Seite {page} / {maxPage}
        </span>
        <Button variant="ghost" disabled={page >= maxPage} onClick={() => setPage(page + 1)}>
          Weiter →
        </Button>
      </div>
    </div>
  );
}
