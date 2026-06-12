'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '@/lib/api';
import { Card } from '@/components/ui';

const PRIMARY = '#0F516A';
const ACCENT = '#AA003C';
const FORECAST = '#3B8EA5';
const PALETTE = ['#0F516A', '#AA003C', '#3B8EA5', '#C9A227', '#5A7D5A', '#8C6BB1', '#D17B49', '#6B7280', '#1E7B34', '#9B2226'];

interface Kpi {
  jahr: number;
  stichtag: string;
  kennzahlen: { istYtd: number; budget: number; yee: number; abweichungProzent: number | null; vorjahrYtd: number; yoyProzent: number | null };
  umsatzProMonat: { monat: string; ist: number; vorjahr: number }[];
  umsatzProRegion: { regionCode: string; bezeichnung: string; ist: number }[];
  umsatzProProduktgruppe: { produktgruppe: string; ist: number }[];
  topLaender: { land: string; ist: number }[];
  istVsBudgetVsForecast: { regionCode: string; bezeichnung: string; ist: number; budget: number; forecast: number }[];
}

const k = (v: number): number => Math.round(v / 1000); // kEUR
const mio = (v: number): string => (v / 1_000_000).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' Mio €';
const tip = (v: number | string): string => `${Number(v).toLocaleString('de-DE')} kEUR`;

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

function ChartCard({ titel, children }: { titel: string; children: React.ReactNode }) {
  return (
    <Card className="p-4">
      <h3 className="mb-3 text-sm font-semibold text-ez-primary">{titel}</h3>
      <div style={{ width: '100%', height: 260 }}>
        <ResponsiveContainer>{children as React.ReactElement}</ResponsiveContainer>
      </div>
    </Card>
  );
}

export default function UebersichtPage() {
  const [jahr, setJahr] = useState(2026);
  const { data, isLoading, error } = useQuery({ queryKey: ['kpi', jahr], queryFn: () => api.get<Kpi>(`/dashboard/kpi?jahr=${jahr}`) });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ez-primary">Übersicht &amp; KPIs</h1>
        <select className="rounded border border-gray-300 px-3 py-1.5 text-sm" value={jahr} onChange={(e) => setJahr(Number(e.target.value))}>
          {[2024, 2025, 2026, 2027].map((j) => (
            <option key={j} value={j}>
              {j}
            </option>
          ))}
        </select>
      </div>

      {isLoading && <p className="text-gray-500">Lädt…</p>}
      {error && <p className="text-ez-accent">{(error as Error).message}</p>}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <KpiCard titel="Ist YTD" wert={mio(data.kennzahlen.istYtd)} sub={`Stichtag ${data.stichtag}`} />
            <KpiCard titel="Budget (Jahr)" wert={mio(data.kennzahlen.budget)} />
            <KpiCard titel="YEE (Hochrechnung)" wert={mio(data.kennzahlen.yee)} farbe={FORECAST} />
            <KpiCard
              titel="Abweichung Budget"
              wert={data.kennzahlen.abweichungProzent === null ? '—' : `${data.kennzahlen.abweichungProzent.toLocaleString('de-DE', { maximumFractionDigits: 1 })} %`}
              farbe={(data.kennzahlen.abweichungProzent ?? 0) < 0 ? ACCENT : '#1E7B34'}
            />
            <KpiCard
              titel="Wachstum YoY"
              wert={data.kennzahlen.yoyProzent === null ? '—' : `${data.kennzahlen.yoyProzent.toLocaleString('de-DE', { maximumFractionDigits: 1 })} %`}
              sub={`Vorjahr ${mio(data.kennzahlen.vorjahrYtd)}`}
              farbe={(data.kennzahlen.yoyProzent ?? 0) < 0 ? ACCENT : '#1E7B34'}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard titel={`Umsatzverlauf ${jahr} vs. ${jahr - 1} (kEUR)`}>
              <LineChart data={data.umsatzProMonat.map((m) => ({ monat: m.monat, Ist: k(m.ist), Vorjahr: k(m.vorjahr) }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="monat" fontSize={12} />
                <YAxis fontSize={12} />
                <Tooltip formatter={(v) => tip(v as number)} />
                <Legend />
                <Line type="monotone" dataKey="Ist" stroke={PRIMARY} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Vorjahr" stroke="#9CA3AF" strokeWidth={2} strokeDasharray="4 4" dot={false} />
              </LineChart>
            </ChartCard>

            <ChartCard titel="Ist · Budget · Forecast je Region (kEUR)">
              <BarChart data={data.istVsBudgetVsForecast.map((r) => ({ name: r.regionCode, Ist: k(r.ist), Budget: k(r.budget), Forecast: k(r.forecast) }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="name" fontSize={12} />
                <YAxis fontSize={12} />
                <Tooltip formatter={(v) => tip(v as number)} />
                <Legend />
                <Bar dataKey="Ist" fill={PRIMARY} />
                <Bar dataKey="Budget" fill="#C9A227" />
                <Bar dataKey="Forecast" fill={FORECAST} />
              </BarChart>
            </ChartCard>

            <ChartCard titel="Umsatz je Produktgruppe (kEUR)">
              <PieChart>
                <Pie
                  data={data.umsatzProProduktgruppe.map((p) => ({ name: p.produktgruppe, value: k(p.ist) }))}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  label={(e) => e.name as string}
                >
                  {data.umsatzProProduktgruppe.map((_, i) => (
                    <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => tip(v as number)} />
              </PieChart>
            </ChartCard>

            <ChartCard titel="Top 10 Länder nach Umsatz (kEUR)">
              <BarChart layout="vertical" data={data.topLaender.map((l) => ({ name: l.land, Umsatz: k(l.ist) }))} margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis type="number" fontSize={12} />
                <YAxis type="category" dataKey="name" width={110} fontSize={12} />
                <Tooltip formatter={(v) => tip(v as number)} />
                <Bar dataKey="Umsatz" fill={PRIMARY} />
              </BarChart>
            </ChartCard>
          </div>
        </>
      )}
    </div>
  );
}
