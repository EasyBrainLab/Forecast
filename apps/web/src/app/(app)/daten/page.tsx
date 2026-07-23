'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card } from '@/components/ui';
import { DataTable, type Column } from '@/components/data-table';
import { monKurz } from '@/lib/monate';

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
  kostenstelle: string;
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
interface DatenPage<T> {
  items: T[];
  total: number;
  summeEur: number;
}

const eur = (v: number | null): string => (v === null ? '—' : v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const MON = monKurz('de');
const ALL = 20000; // clientseitige Excel-Tabelle: Jahres-/Filter-Ausschnitt komplett laden

function DatenInhalt() {
  const params = useSearchParams();
  const [tab, setTab] = useState<'ist' | 'budget'>(params.get('tab') === 'budget' ? 'budget' : 'ist');
  const [jahr, setJahr] = useState(Number(params.get('jahr')) || new Date().getFullYear());
  const [regionCode, setRegionCode] = useState(params.get('regionCode') ?? '');
  const [e1Id, setE1Id] = useState(params.get('e1Id') ?? '');
  const [monat, setMonat] = useState(params.get('monat') ?? '');

  const { data: regionen } = useQuery({ queryKey: ['regionen'], queryFn: () => api.get<Region[]>('/stammdaten/regionen') });
  const { data: pg } = useQuery({ queryKey: ['pg'], queryFn: () => api.get<{ e1: E1[] }>('/stammdaten/produktgruppen') });

  const q = `jahr=${jahr}&page=1&pageSize=${ALL}${regionCode ? `&regionCode=${regionCode}` : ''}${e1Id && tab === 'ist' ? `&e1Id=${e1Id}` : ''}${monat && tab === 'ist' ? `&monat=${monat}` : ''}`;
  const ist = useQuery({ queryKey: ['ist-daten', q], queryFn: () => api.get<DatenPage<IstRow>>(`/dashboard/ist-daten?${q}`), enabled: tab === 'ist' });
  const budget = useQuery({ queryKey: ['budget-daten', q], queryFn: () => api.get<DatenPage<BudgetRow>>(`/dashboard/budget-daten?${q}`), enabled: tab === 'budget' });
  const aktiv = tab === 'ist' ? ist.data : budget.data;
  const laedt = tab === 'ist' ? ist.isLoading : budget.isLoading;

  const istCols: Column<IstRow>[] = [
    { key: 'recid', label: 'RECID', value: (r) => r.recid },
    { key: 'datum', label: 'Datum', value: (r) => new Date(r.buchungsdatum).getTime(), render: (r) => new Date(r.buchungsdatum).toLocaleDateString('de-DE'), filter: 'none' },
    { key: 'region', label: 'Region', value: (r) => r.regionCode, filter: 'select' },
    { key: 'kst', label: 'KST', value: (r) => r.kostenstelle, filter: 'select' },
    { key: 'land', label: 'Land', value: (r) => r.land, filter: 'select' },
    { key: 'pg', label: 'Produktgruppe', value: (r) => r.produktgruppe, filter: 'select' },
    { key: 'e2', label: 'E2', value: (r) => r.e2 },
    { key: 'ktr', label: 'KTR', value: (r) => r.kostentraeger },
    { key: 'monat', label: 'Mon', value: (r) => r.monat, align: 'right', filter: 'none' },
    {
      key: 'wert',
      label: 'Wert EUR',
      value: (r) => r.wertEur,
      align: 'right',
      filter: 'none',
      render: (r) => <span className={r.wertEur < 0 ? 'text-ez-accent' : r.istSondereffekt ? 'font-semibold text-ez-primary' : ''}>{eur(r.wertEur)}</span>,
    },
  ];
  const budgetCols: Column<BudgetRow>[] = [
    { key: 'monat', label: 'Monat', value: (r) => r.monat ?? 0, render: (r) => (r.monat ? MON[r.monat - 1] : 'Jahr'), align: 'right' },
    { key: 'region', label: 'Region', value: (r) => r.regionCode, filter: 'select' },
    { key: 'land', label: 'Land', value: (r) => r.land, filter: 'select' },
    { key: 'pg', label: 'Produktgruppe', value: (r) => r.produktgruppe, filter: 'select' },
    { key: 'e2', label: 'E2', value: (r) => r.e2 },
    { key: 'wert', label: 'Wert EUR', value: (r) => r.wertEur ?? 0, align: 'right', filter: 'none', render: (r) => eur(r.wertEur) },
    { key: 'units', label: 'Units', value: (r) => r.units ?? 0, align: 'right', filter: 'none', render: (r) => (r.units == null ? '—' : r.units.toLocaleString('de-DE')) },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-ez-primary">Rohdaten</h1>

      <div className="flex gap-2">
        {(['ist', 'budget'] as const).map((tb) => (
          <button key={tb} onClick={() => setTab(tb)} className={`rounded px-4 py-2 text-sm font-medium ${tab === tb ? 'bg-ez-primary text-white' : 'border border-gray-300 bg-white'}`}>
            {tb === 'ist' ? 'Ist-Umsätze' : 'Budget'}
          </button>
        ))}
      </div>

      <Card className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <div className="mb-1 text-xs text-gray-500">Jahr</div>
          <select className="rounded border border-gray-300 px-2 py-1.5 text-sm" value={jahr} onChange={(e) => setJahr(Number(e.target.value))}>
            {[2024, 2025, 2026, 2027, 2028, 2029, 2030].map((j) => (
              <option key={j}>{j}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <div className="mb-1 text-xs text-gray-500">Region</div>
          <select className="rounded border border-gray-300 px-2 py-1.5 text-sm" value={regionCode} onChange={(e) => setRegionCode(e.target.value)}>
            <option value="">Alle</option>
            {regionen?.map((r) => (
              <option key={r.code} value={r.code}>
                {r.code} — {r.bezeichnung}
              </option>
            ))}
          </select>
        </label>
        {tab === 'ist' && (
          <>
            <label className="text-sm">
              <div className="mb-1 text-xs text-gray-500">Produktgruppe</div>
              <select className="rounded border border-gray-300 px-2 py-1.5 text-sm" value={e1Id} onChange={(e) => setE1Id(e.target.value)}>
                <option value="">Alle</option>
                {pg?.e1.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nameDe}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <div className="mb-1 text-xs text-gray-500">Monat</div>
              <select className="rounded border border-gray-300 px-2 py-1.5 text-sm" value={monat} onChange={(e) => setMonat(e.target.value)}>
                <option value="">Alle</option>
                {MON.map((m, i) => (
                  <option key={i} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {aktiv && (
          <div className="ml-auto text-right text-sm">
            <div className="font-semibold">{aktiv.total.toLocaleString('de-DE')} Zeilen</div>
            <div className="text-gray-500">Σ {eur(aktiv.summeEur)} €</div>
          </div>
        )}
      </Card>

      <Card className="p-3">
        {laedt ? (
          <p className="text-gray-500">Lädt…</p>
        ) : tab === 'ist' ? (
          <DataTable columns={istCols} rows={ist.data?.items ?? []} rowKey={(r) => r.recid} initialSort={{ key: 'datum', dir: 'desc' }} dicht globaleSuche suchePlaceholder="Suche (RECID, Land, KST, Kostenträger …)" leerText="Keine Ist-Buchungen für diese Filter." />
        ) : (
          <DataTable columns={budgetCols} rows={budget.data?.items ?? []} rowKey={(r) => r.id} dicht globaleSuche leerText="Keine Budget-Zeilen für diese Filter." />
        )}
      </Card>
    </div>
  );
}

export default function DatenPage() {
  return (
    <Suspense fallback={<div className="p-8 text-gray-500">…</div>}>
      <DatenInhalt />
    </Suspense>
  );
}
