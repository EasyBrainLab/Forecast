'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
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
  istQuelle?: 'SALES_FLASH' | 'GL';
  kennzahlen: { istYtd: number; istYtdGL?: number; budget: number; yee: number; abweichungProzent: number | null; vorjahrYtd: number; yoyProzent: number | null };
  umsatzProMonat: { monat: string; ist: number; vorjahr: number; budget: number }[];
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
  const t = useTranslations('uebersicht');
  const tc = useTranslations('common');
  const [jahr, setJahr] = useState(2026);
  const { data, isLoading, error } = useQuery({ queryKey: ['kpi', jahr], queryFn: () => api.get<Kpi>(`/dashboard/kpi?jahr=${jahr}`) });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ez-primary">{t('titel')}</h1>
        <select className="rounded border border-gray-300 px-3 py-1.5 text-sm" value={jahr} onChange={(e) => setJahr(Number(e.target.value))}>
          {[2024, 2025, 2026, 2027].map((j) => (
            <option key={j} value={j}>
              {j}
            </option>
          ))}
        </select>
      </div>

      {isLoading && <p className="text-gray-500">{tc('laedt')}</p>}
      {error && <p className="text-ez-accent">{(error as Error).message}</p>}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <KpiCard
              titel={t('istYtd')}
              wert={mio(data.kennzahlen.istYtd)}
              sub={data.istQuelle === 'SALES_FLASH' ? t('quelleSalesFlash', { stichtag: data.stichtag }) : t('quelleGl', { stichtag: data.stichtag })}
            />
            <KpiCard titel={t('budgetJahr')} wert={mio(data.kennzahlen.budget)} />
            <KpiCard titel={t('yee')} wert={mio(data.kennzahlen.yee)} farbe={FORECAST} />
            <KpiCard
              titel={t('abwBudget')}
              wert={data.kennzahlen.abweichungProzent === null ? '—' : `${data.kennzahlen.abweichungProzent.toLocaleString('de-DE', { maximumFractionDigits: 1 })} %`}
              farbe={(data.kennzahlen.abweichungProzent ?? 0) < 0 ? ACCENT : '#1E7B34'}
            />
            <KpiCard
              titel={t('yoy')}
              wert={data.kennzahlen.yoyProzent === null ? '—' : `${data.kennzahlen.yoyProzent.toLocaleString('de-DE', { maximumFractionDigits: 1 })} %`}
              sub={t('vorjahrWert', { wert: mio(data.kennzahlen.vorjahrYtd) })}
              farbe={(data.kennzahlen.yoyProzent ?? 0) < 0 ? ACCENT : '#1E7B34'}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard titel={t('chartMonat', { jahr })}>
              <ComposedChart data={data.umsatzProMonat.map((m) => ({ monat: m.monat, [t('serieIst')]: k(m.ist), [t('serieBudget')]: k(m.budget), [t('serieVorjahr')]: k(m.vorjahr) }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="monat" fontSize={12} />
                <YAxis fontSize={12} />
                <Tooltip formatter={(v) => tip(v as number)} />
                <Legend />
                <Bar dataKey={t('serieBudget')} fill="#C9A227" fillOpacity={0.5} />
                <Line type="monotone" dataKey={t('serieIst')} stroke={PRIMARY} strokeWidth={2.5} dot={false} />
                <Line type="monotone" dataKey={t('serieVorjahr')} stroke="#9CA3AF" strokeWidth={2} strokeDasharray="4 4" dot={false} />
              </ComposedChart>
            </ChartCard>

            <ChartCard titel={t('chartRegion')}>
              <BarChart data={data.istVsBudgetVsForecast.map((r) => ({ name: r.regionCode, [t('serieIst')]: k(r.ist), [t('serieBudget')]: k(r.budget), [t('serieForecast')]: k(r.forecast) }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="name" fontSize={12} />
                <YAxis fontSize={12} />
                <Tooltip formatter={(v) => tip(v as number)} />
                <Legend />
                <Bar dataKey={t('serieIst')} fill={PRIMARY} />
                <Bar dataKey={t('serieBudget')} fill="#C9A227" />
                <Bar dataKey={t('serieForecast')} fill={FORECAST} />
              </BarChart>
            </ChartCard>

            <ChartCard titel={t('chartProduktgruppe')}>
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

            <ChartCard titel={t('chartTopLaender')}>
              <BarChart layout="vertical" data={data.topLaender.map((l) => ({ name: l.land, [t('serieUmsatz')]: k(l.ist) }))} margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis type="number" fontSize={12} />
                <YAxis type="category" dataKey="name" width={110} fontSize={12} />
                <Tooltip formatter={(v) => tip(v as number)} />
                <Bar dataKey={t('serieUmsatz')} fill={PRIMARY} />
              </BarChart>
            </ChartCard>
          </div>
        </>
      )}
    </div>
  );
}
