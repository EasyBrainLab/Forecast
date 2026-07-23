'use client';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '@/lib/api';
import { Card } from '@/components/ui';
import { DataTable, type Column } from '@/components/data-table';

const PRIMARY = '#0F516A';
const SEED = '#4A90A4';
const MON = ['', 'Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

interface Periode {
  jahr: number;
  monat: number;
}
interface Kpi {
  jahr: number;
  bisMonat: number;
  zeilen: number;
  stueckGesamt: number;
  seedGesamt: number;
  lineAmountGesamt: number;
  jeProdukt: { produktgruppe: string; stueck: number; seed: number }[];
  jeMonat: { monat: number; stueck: number; seed: number }[];
  jeLand: { land: string; stueck: number; seed: number }[];
  jeRegion: { regionCode: string; stueck: number; seed: number }[];
}
interface Row {
  id: string;
  shippingDate: string;
  monat: number;
  auftragsnummer: string;
  kunde: string;
  land: string;
  regionCode: string;
  produktgruppe: string;
  e2: string;
  itemNumber: string;
  stueckzahl: number;
  seedzahl: number;
  orderedQty: number | null;
  lineAmountEur: number | null;
  kostenstelle: string;
  kostentraeger: string;
}
interface DatenAntwort {
  total: number;
  stueckSumme: number;
  seedSumme: number;
  items: Row[];
}

const fmt = (n: number): string => n.toLocaleString('de-DE');
const fmtDec = (n: number | null): string => (n === null ? '—' : n.toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 2 }));

function KpiCard({ titel, wert, sub, farbe }: { titel: string; wert: string; sub?: string; farbe?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wide text-gray-500">{titel}</div>
      <div className="mt-1 text-2xl font-bold" style={{ color: farbe ?? PRIMARY }}>
        {wert}
      </div>
      {sub && <div className="mt-0.5 text-xs text-gray-500">{sub}</div>}
    </Card>
  );
}

export default function LiefermengenPage() {
  const { data: perioden } = useQuery({ queryKey: ['lm-perioden'], queryFn: () => api.get<Periode[]>('/liefermenge/perioden') });
  const jahre = useMemo(() => [...new Set((perioden ?? []).map((p) => p.jahr))].sort((a, b) => b - a), [perioden]);
  const [jahr, setJahr] = useState<number | null>(null);
  const aktivJahr = jahr ?? jahre[0] ?? null;

  const { data: kpi } = useQuery({
    queryKey: ['lm-kpi', aktivJahr],
    queryFn: () => api.get<Kpi>(`/liefermenge/kpi?jahr=${aktivJahr}&bisMonat=12`),
    enabled: !!aktivJahr,
  });
  const q = `jahr=${aktivJahr}&page=1&pageSize=20000`;
  const { data: daten, isLoading } = useQuery({
    queryKey: ['lm-daten', q],
    queryFn: () => api.get<DatenAntwort>(`/liefermenge/daten?${q}`),
    enabled: !!aktivJahr,
  });

  const cols: Column<Row>[] = [
    { key: 'datum', label: 'Datum', value: (r) => new Date(r.shippingDate).getTime(), render: (r) => new Date(r.shippingDate).toLocaleDateString('de-DE'), filter: 'none' },
    { key: 'auftrag', label: 'Auftrag', value: (r) => r.auftragsnummer },
    { key: 'kunde', label: 'Kunde', value: (r) => r.kunde },
    { key: 'land', label: 'Land', value: (r) => r.land, filter: 'select' },
    { key: 'region', label: 'Region', value: (r) => r.regionCode, filter: 'select' },
    { key: 'pg', label: 'Produktgruppe', value: (r) => r.produktgruppe, filter: 'select' },
    { key: 'e2', label: 'Produkt', value: (r) => r.e2, filter: 'select' },
    { key: 'item', label: 'Item', value: (r) => r.itemNumber },
    { key: 'stueck', label: 'Stück', value: (r) => r.stueckzahl, align: 'right', filter: 'none', render: (r) => <span className={r.stueckzahl < 0 ? 'text-ez-accent' : ''}>{fmtDec(r.stueckzahl)}</span> },
    { key: 'seed', label: 'Seeds', value: (r) => r.seedzahl, align: 'right', filter: 'none', render: (r) => <span className={r.seedzahl < 0 ? 'text-ez-accent' : ''}>{fmtDec(r.seedzahl)}</span> },
    { key: 'ordered', label: 'Ordered', value: (r) => r.orderedQty ?? 0, align: 'right', filter: 'none', render: (r) => fmtDec(r.orderedQty) },
    { key: 'betrag', label: 'Betrag €', value: (r) => r.lineAmountEur ?? 0, align: 'right', filter: 'none', render: (r) => fmtDec(r.lineAmountEur) },
    { key: 'kst', label: 'KST', value: (r) => r.kostenstelle, filter: 'select' },
    { key: 'ktr', label: 'KTR', value: (r) => r.kostentraeger },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-ez-primary">Liefermengen</h1>
          <p className="text-sm text-gray-500">Zeilenscharfe Liefermengen (SalesOrder-Lineitems) je Produkt, Land und Region. Import über die Import-Seite (monatlicher ERP-Export).</p>
        </div>
        <div className="flex gap-2">
          {jahre.map((j) => (
            <button key={j} onClick={() => setJahr(j)} className={`rounded px-3 py-1.5 text-sm font-medium ${j === aktivJahr ? 'bg-ez-primary text-white' : 'border border-gray-300 bg-white'}`}>
              {j}
            </button>
          ))}
        </div>
      </div>

      {!aktivJahr && <Card><p className="text-gray-500">Noch keine Liefermengen importiert. Bitte den SOL-Export über „Import" hochladen.</p></Card>}

      {kpi && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard titel="Seeds gesamt" wert={fmt(kpi.seedGesamt)} sub={`${kpi.jahr}`} />
            <KpiCard titel="Stück gesamt" wert={fmt(kpi.stueckGesamt)} farbe={SEED} />
            <KpiCard titel="Umsatz (Lineamount)" wert={`${fmt(Math.round(kpi.lineAmountGesamt))} €`} farbe="#6B7280" />
            <KpiCard titel="Positionen" wert={fmt(kpi.zeilen)} farbe="#6B7280" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-4">
              <div className="mb-2 text-sm font-semibold text-ez-primary">Seeds je Produktgruppe</div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={kpi.jeProdukt}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis dataKey="produktgruppe" fontSize={11} />
                  <YAxis fontSize={11} />
                  <Tooltip formatter={(v: number) => fmt(v)} />
                  <Bar dataKey="seed" name="Seeds" fill={PRIMARY} />
                  <Bar dataKey="stueck" name="Stück" fill={SEED} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
            <Card className="p-4">
              <div className="mb-2 text-sm font-semibold text-ez-primary">Seeds je Liefermonat</div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={kpi.jeMonat.map((m) => ({ ...m, label: MON[m.monat] }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis dataKey="label" fontSize={11} />
                  <YAxis fontSize={11} />
                  <Tooltip formatter={(v: number) => fmt(v)} />
                  <Bar dataKey="seed" name="Seeds" fill={PRIMARY} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
            <Card className="p-4">
              <div className="mb-2 text-sm font-semibold text-ez-primary">Seeds je Land (Top 15)</div>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={kpi.jeLand} layout="vertical" margin={{ left: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis type="number" fontSize={11} />
                  <YAxis type="category" dataKey="land" fontSize={10} width={90} />
                  <Tooltip formatter={(v: number) => fmt(v)} />
                  <Bar dataKey="seed" name="Seeds" fill={PRIMARY} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
            <Card className="p-4">
              <div className="mb-2 text-sm font-semibold text-ez-primary">Seeds je Region</div>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={kpi.jeRegion}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis dataKey="regionCode" fontSize={11} />
                  <YAxis fontSize={11} />
                  <Tooltip formatter={(v: number) => fmt(v)} />
                  <Bar dataKey="seed" name="Seeds" fill={PRIMARY} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </div>
        </>
      )}

      <Card className="p-3">
        <div className="mb-2 flex flex-wrap items-center gap-3 text-sm">
          <span className="font-semibold text-ez-primary">Einzelpositionen {aktivJahr}</span>
          {daten && (
            <span className="text-gray-500">
              {fmt(daten.total)} Zeilen · Σ Stück {fmtDec(daten.stueckSumme)} · Σ Seeds {fmtDec(daten.seedSumme)}
            </span>
          )}
        </div>
        {isLoading ? (
          <p className="text-gray-500">Lädt…</p>
        ) : (
          <DataTable
            columns={cols}
            rows={daten?.items ?? []}
            rowKey={(r) => r.id}
            initialSort={{ key: 'datum', dir: 'desc' }}
            dicht
            globaleSuche
            spaltenWahl
            tabellenId="liefermengen"
            suchePlaceholder="Suche (Kunde, Auftrag, Item, KST …)"
            leerText="Keine Liefermengen für diese Filter."
          />
        )}
      </Card>
    </div>
  );
}
