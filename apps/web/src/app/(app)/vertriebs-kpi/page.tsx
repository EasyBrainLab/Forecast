'use client';
import { type ReactElement, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, downloadDatei } from '@/lib/api';
import { Ampel, Button, Card, keur, prozent } from '@/components/ui';
import { QuellHinweis } from '@/components/quell-hinweis';
import { monKurz } from '@/lib/monate';

const VORJAHR = '#9CA3AF';
const BUDGET = '#D97706';
const JAHR_PALETTE = ['#0F516A', '#4A90A4', '#9CA3AF'];

const PRIMARY = '#0F516A';
const POS = '#1E7B34';
const NEG = '#AA003C';

interface Zeile {
  regionCode: string;
  bezeichnung: string;
  agms: string[];
  istZeitraum: number;
  istVorjahr: number;
  yoyEur: number;
  yoyProzent: number | null;
  budgetZeitraum: number;
  zielProzent: number | null;
  yee: number;
  budgetJahr: number;
  ausschoepfungProzent: number | null;
  ist3Jahre: Record<number, number>;
  budget3Jahre: Record<number, number>;
  istQuelle: 'SALES_FLASH' | 'GL';
}
interface Gesamt {
  istZeitraum: number;
  istVorjahr: number;
  yoyEur: number;
  yoyProzent: number | null;
  budgetZeitraum: number;
  zielProzent: number | null;
  yee: number;
  budgetJahr: number;
  ausschoepfungProzent: number | null;
}
interface MonatsPunkt {
  monat: number;
  ist: number | null;
  vorjahr: number;
  budget: number;
}
interface VertriebsKpi {
  jahr: number;
  zeitraum: { von: number; bis: number; bisEffektiv: number; letzterVollerMonat: number };
  stichtag: string;
  jahre: number[];
  umsatzProMonat: MonatsPunkt[];
  zeilen: Zeile[];
  gesamt: Gesamt;
}

const yoyFarbe = (p: number | null): string | undefined => (p == null ? undefined : p >= 0 ? POS : NEG);
const zielAmpel = (p: number | null): 'gruen' | 'gelb' | 'rot' | 'grau' => (p == null ? 'grau' : p >= 100 ? 'gruen' : p >= 90 ? 'gelb' : 'rot');

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

function ChartCard({ titel, children }: { titel: string; children: ReactElement }) {
  return (
    <Card className="p-4">
      <h3 className="mb-3 text-sm font-semibold text-ez-primary">{titel}</h3>
      <div style={{ width: '100%', height: 280 }}>
        <ResponsiveContainer>{children}</ResponsiveContainer>
      </div>
    </Card>
  );
}

export default function VertriebsKpiPage() {
  const t = useTranslations('vertriebsKpi');
  const tc = useTranslations('common');
  const locale = useLocale();
  const MON = monKurz(locale);
  const jetztJahr = new Date().getFullYear();
  const jahre = [jetztJahr + 1, jetztJahr, jetztJahr - 1, jetztJahr - 2, jetztJahr - 3];

  const [jahr, setJahr] = useState(jetztJahr);
  const [von, setVon] = useState(1);
  const [bis, setBis] = useState(12);

  const { data, isLoading } = useQuery({
    queryKey: ['kpi-vertrieb', jahr, von, bis],
    queryFn: () => api.get<VertriebsKpi>(`/dashboard/kpi-vertrieb?jahr=${jahr}&monatVon=${von}&monatBis=${bis}`),
  });

  const j3 = data?.jahre ?? [jahr, jahr - 1, jahr - 2];
  const bisEff = data?.zeitraum.bisEffektiv ?? bis;

  const kEUR = (v: number): string => `${keur(v)}`;
  const c = (v: number): number => Math.round(v / 100) / 10; // EUR -> kEUR, 1 Dezimal
  const monatData = (data?.umsatzProMonat ?? []).map((m) => ({ monat: MON[m.monat - 1], ist: m.ist == null ? null : c(m.ist), vorjahr: c(m.vorjahr), budget: c(m.budget) }));
  const regionData = (data?.zeilen ?? []).map((z) => ({ region: z.regionCode, ist: c(z.istZeitraum), vorjahr: c(z.istVorjahr), budget: c(z.budgetZeitraum) }));
  const jahreData = (data?.zeilen ?? []).map((z) => {
    const o: Record<string, string | number> = { region: z.regionCode };
    for (const y of j3) o[String(y)] = c(z.ist3Jahre[y] ?? 0);
    return o;
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-ez-primary">{t('titel')}</h1>
          <p className="mt-1 text-sm text-gray-500">{t('untertitel')}</p>
        </div>
        {data && (
          <Button
            variant="ghost"
            onClick={() => downloadDatei(`/export/vertriebs-kpi?jahr=${jahr}&monatVon=${von}&monatBis=${bis}`, 'GET', `vertriebs-kpi-${jahr}.xlsx`)}
          >
            {t('exportExcel')}
          </Button>
        )}
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-sm">
            <div className="mb-1 text-gray-500">{t('jahr')}</div>
            <select className="rounded border px-2 py-1" value={jahr} onChange={(e) => setJahr(Number(e.target.value))}>
              {jahre.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <div className="mb-1 text-gray-500">{t('von')}</div>
            <select className="rounded border px-2 py-1" value={von} onChange={(e) => setVon(Number(e.target.value))}>
              {MON.map((m, i) => (
                <option key={i} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <div className="mb-1 text-gray-500">{t('bis')}</div>
            <select className="rounded border px-2 py-1" value={bis} onChange={(e) => setBis(Number(e.target.value))}>
              {MON.map((m, i) => (
                <option key={i} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          {data && (
            <div className="text-xs text-gray-500">
              {t('vergleichBis', { monat: MON[bisEff - 1] ?? '—', jahr })} · {t('vorjahr')} {jahr - 1}
            </div>
          )}
        </div>
      </Card>

      {isLoading && <p className="text-gray-500">{tc('laedt')}</p>}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard titel={t('istZeitraum')} wert={`${kEUR(data.gesamt.istZeitraum)} kEUR`} sub={t('vorjahrWert', { wert: kEUR(data.gesamt.istVorjahr) })} />
            <KpiCard titel={t('yoy')} wert={prozent(data.gesamt.yoyProzent)} farbe={yoyFarbe(data.gesamt.yoyProzent)} sub={`${data.gesamt.yoyEur >= 0 ? '+' : ''}${kEUR(data.gesamt.yoyEur)} kEUR`} />
            <KpiCard titel={t('zielerreichung')} wert={prozent(data.gesamt.zielProzent)} farbe={zielAmpel(data.gesamt.zielProzent) === 'rot' ? NEG : PRIMARY} sub={t('budgetZeitraumWert', { wert: kEUR(data.gesamt.budgetZeitraum) })} />
            <KpiCard titel={t('yee')} wert={`${kEUR(data.gesamt.yee)} kEUR`} sub={t('budgetJahrWert', { wert: kEUR(data.gesamt.budgetJahr) })} />
          </div>

          <Card className="p-4">
            <div className="overflow-x-auto">
              <table className="w-full text-xs tabular-nums">
                <thead>
                  <tr className="text-gray-500">
                    <th className="p-1 text-left" rowSpan={2}>
                      {t('region')}
                    </th>
                    <th className="p-1 text-left" rowSpan={2}>
                      {t('agm')}
                    </th>
                    <th className="border-l p-1 text-center" colSpan={4}>
                      {t('gruppeZeitraum')}
                    </th>
                    <th className="border-l p-1 text-center" colSpan={2}>
                      {t('gruppeBudget')}
                    </th>
                    <th className="border-l p-1 text-center" colSpan={3}>
                      {t('gruppeJahr')}
                    </th>
                    <th className="border-l p-1 text-center" colSpan={3}>
                      {t('gruppe3Jahre')}
                    </th>
                  </tr>
                  <tr className="text-gray-400">
                    <th className="border-l p-1 text-right">{t('ist')}</th>
                    <th className="p-1 text-right">{t('vorjahrKurz')}</th>
                    <th className="p-1 text-right">Δ €</th>
                    <th className="p-1 text-right">YoY %</th>
                    <th className="border-l p-1 text-right">{t('budget')}</th>
                    <th className="p-1 text-right">{t('ziel')} %</th>
                    <th className="border-l p-1 text-right">YEE</th>
                    <th className="p-1 text-right">{t('budgetJahrKurz')}</th>
                    <th className="p-1 text-right">{t('ausschoepfung')} %</th>
                    {j3.map((y) => (
                      <th key={y} className="border-l p-1 text-right">
                        {y}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.zeilen.map((z) => (
                    <tr key={z.regionCode} className="border-t hover:bg-gray-50">
                      <td className="p-1 font-medium">
                        {z.regionCode}
                        <span className="ml-1 text-gray-400">{z.istQuelle === 'GL' ? '·GL' : ''}</span>
                      </td>
                      <td className="max-w-[10rem] truncate p-1 text-gray-500" title={z.agms.join(', ')}>
                        {z.agms.join(', ') || '—'}
                      </td>
                      <td className="border-l p-1 text-right font-medium">{kEUR(z.istZeitraum)}</td>
                      <td className="p-1 text-right text-gray-500">{kEUR(z.istVorjahr)}</td>
                      <td className="p-1 text-right" style={{ color: yoyFarbe(z.yoyProzent) }}>
                        {z.yoyEur >= 0 ? '+' : ''}
                        {kEUR(z.yoyEur)}
                      </td>
                      <td className="p-1 text-right font-medium" style={{ color: yoyFarbe(z.yoyProzent) }}>
                        {prozent(z.yoyProzent)}
                      </td>
                      <td className="border-l p-1 text-right text-gray-500">{kEUR(z.budgetZeitraum)}</td>
                      <td className="p-1 text-right">
                        <span className="inline-flex items-center justify-end gap-1">
                          <Ampel farbe={zielAmpel(z.zielProzent)} />
                          {prozent(z.zielProzent)}
                        </span>
                      </td>
                      <td className="border-l p-1 text-right">{kEUR(z.yee)}</td>
                      <td className="p-1 text-right text-gray-500">{kEUR(z.budgetJahr)}</td>
                      <td className="p-1 text-right text-gray-500">{prozent(z.ausschoepfungProzent)}</td>
                      {j3.map((y) => (
                        <td key={y} className="border-l p-1 text-right text-gray-600">
                          {kEUR(z.ist3Jahre[y] ?? 0)}
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr className="border-t-2 font-semibold">
                    <td className="p-1" colSpan={2}>
                      {t('gesamt')}
                    </td>
                    <td className="border-l p-1 text-right">{kEUR(data.gesamt.istZeitraum)}</td>
                    <td className="p-1 text-right text-gray-500">{kEUR(data.gesamt.istVorjahr)}</td>
                    <td className="p-1 text-right" style={{ color: yoyFarbe(data.gesamt.yoyProzent) }}>
                      {data.gesamt.yoyEur >= 0 ? '+' : ''}
                      {kEUR(data.gesamt.yoyEur)}
                    </td>
                    <td className="p-1 text-right" style={{ color: yoyFarbe(data.gesamt.yoyProzent) }}>
                      {prozent(data.gesamt.yoyProzent)}
                    </td>
                    <td className="border-l p-1 text-right text-gray-500">{kEUR(data.gesamt.budgetZeitraum)}</td>
                    <td className="p-1 text-right">{prozent(data.gesamt.zielProzent)}</td>
                    <td className="border-l p-1 text-right">{kEUR(data.gesamt.yee)}</td>
                    <td className="p-1 text-right text-gray-500">{kEUR(data.gesamt.budgetJahr)}</td>
                    <td className="p-1 text-right text-gray-500">{prozent(data.gesamt.ausschoepfungProzent)}</td>
                    {j3.map((y) => (
                      <td key={y} className="border-l p-1 text-right">
                        {kEUR(data.zeilen.reduce((s, z) => s + (z.ist3Jahre[y] ?? 0), 0))}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-gray-400">{t('hinweisKeur')}</p>
          </Card>

          <ChartCard titel={t('chartMonat')}>
            <ComposedChart data={monatData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="monat" fontSize={11} />
              <YAxis fontSize={11} />
              <Tooltip formatter={(v) => `${v} kEUR`} />
              <Legend />
              <Bar dataKey="ist" name={t('ist')} fill={PRIMARY} />
              <Bar dataKey="vorjahr" name={t('vorjahrKurz')} fill={VORJAHR} />
              <Line dataKey="budget" name={t('budget')} stroke={BUDGET} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ChartCard>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard titel={t('chartRegion')}>
              <BarChart data={regionData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="region" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip formatter={(v) => `${v} kEUR`} />
                <Legend />
                <Bar dataKey="ist" name={t('ist')} fill={PRIMARY} />
                <Bar dataKey="vorjahr" name={t('vorjahrKurz')} fill={VORJAHR} />
                <Bar dataKey="budget" name={t('budget')} fill={BUDGET} />
              </BarChart>
            </ChartCard>
            <ChartCard titel={t('chart3Jahre')}>
              <BarChart data={jahreData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="region" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip formatter={(v) => `${v} kEUR`} />
                <Legend />
                {j3.map((y, i) => (
                  <Bar key={y} dataKey={String(y)} name={String(y)} fill={JAHR_PALETTE[i]} />
                ))}
              </BarChart>
            </ChartCard>
          </div>
          <QuellHinweis arten={['ist', 'budget']} className="mt-1" />
        </>
      )}
    </div>
  );
}
