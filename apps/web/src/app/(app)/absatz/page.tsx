'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '@/lib/api';
import { Card } from '@/components/ui';
import { monKurz } from '@/lib/monate';

const PRIMARY = '#0F516A';
const VORJAHR = '#9CA3AF';

interface Periode {
  jahr: number;
  bisMonat: number;
  zeilen: number;
}
interface Kpi {
  jahr: number;
  bisMonat: number;
  kennzahlen: { seeds: number; seedsVorjahr: number; seedsYoY: number | null; ruthen: number; ruthenVorjahr: number };
  seedsProLand: { land: string; seeds: number; vorjahr: number }[];
  topKunden: { kunde: string; seeds: number; vorjahr: number }[];
  produkte: { name: string; menge: number; vorjahr: number }[];
}

const fmt = (n: number): string => n.toLocaleString('de-DE');

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

export default function AbsatzPage() {
  const t = useTranslations('absatz');
  const tc = useTranslations('common');
  const locale = useLocale();
  const MON = monKurz(locale);
  const { data: perioden } = useQuery({ queryKey: ['absatz-perioden'], queryFn: () => api.get<Periode[]>('/absatz/perioden') });
  const [sel, setSel] = useState<{ jahr: number; bisMonat: number } | null>(null);
  const aktiv = sel ?? (perioden && perioden[0] ? { jahr: perioden[0].jahr, bisMonat: perioden[0].bisMonat } : null);
  const { data, isLoading } = useQuery({
    queryKey: ['absatz-kpi', aktiv?.jahr, aktiv?.bisMonat],
    queryFn: () => api.get<Kpi>(`/absatz/kpi?jahr=${aktiv!.jahr}&bisMonat=${aktiv!.bisMonat}`),
    enabled: !!aktiv,
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-ez-primary">{t('titel')}</h1>
        <div className="flex gap-2">
          {perioden?.map((p) => (
            <button
              key={`${p.jahr}-${p.bisMonat}`}
              onClick={() => setSel({ jahr: p.jahr, bisMonat: p.bisMonat })}
              className={`rounded border px-3 py-1 text-sm ${aktiv?.jahr === p.jahr && aktiv?.bisMonat === p.bisMonat ? 'border-ez-primary bg-ez-primary text-white' : 'bg-white'}`}
            >
              {t('janBis', { monat: MON[p.bisMonat - 1], jahr: p.jahr })}
            </button>
          ))}
        </div>
      </div>

      {perioden && perioden.length === 0 && (
        <Card>
          <p className="text-gray-600">{t('keineDaten')}</p>
        </Card>
      )}
      {isLoading && <p className="text-gray-500">{tc('laedt')}</p>}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard titel={t('seeds')} wert={fmt(data.kennzahlen.seeds)} sub={t('janBis', { monat: MON[data.bisMonat - 1], jahr: data.jahr })} />
            <KpiCard titel={t('seedsVorjahr')} wert={fmt(data.kennzahlen.seedsVorjahr)} farbe={VORJAHR} />
            <KpiCard
              titel={t('veraenderung')}
              wert={data.kennzahlen.seedsYoY === null ? '—' : `${data.kennzahlen.seedsYoY.toLocaleString('de-DE', { maximumFractionDigits: 1 })} %`}
              farbe={(data.kennzahlen.seedsYoY ?? 0) < 0 ? '#AA003C' : '#1E7B34'}
            />
            <KpiCard titel={t('ruthenium')} wert={fmt(data.kennzahlen.ruthen)} sub={t('vorjahrWert', { wert: fmt(data.kennzahlen.ruthenVorjahr) })} />
          </div>

          <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold text-ez-primary">{t('chartLand')}</h3>
            <div style={{ width: '100%', height: 320 }}>
              <ResponsiveContainer>
                <BarChart data={data.seedsProLand.slice(0, 12)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis dataKey="land" fontSize={11} angle={-25} textAnchor="end" height={60} />
                  <YAxis fontSize={12} />
                  <Tooltip formatter={(v) => fmt(v as number)} />
                  <Legend />
                  <Bar dataKey="seeds" name={t('ist')} fill={PRIMARY} />
                  <Bar dataKey="vorjahr" name={tc('vorjahr')} fill={VORJAHR} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-4">
              <h3 className="mb-3 text-sm font-semibold text-ez-primary">{t('topKunden')}</h3>
              <table className="w-full text-sm">
                <thead className="text-left text-gray-500">
                  <tr>
                    <th className="py-1">{tc('kunde')}</th>
                    <th className="py-1 text-right">{t('ist')}</th>
                    <th className="py-1 text-right">{tc('vorjahr')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topKunden.map((k) => (
                    <tr key={k.kunde} className="border-t">
                      <td className="py-1">{k.kunde}</td>
                      <td className="py-1 text-right">{fmt(k.seeds)}</td>
                      <td className="py-1 text-right text-gray-500">{fmt(k.vorjahr)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card className="p-4">
              <h3 className="mb-3 text-sm font-semibold text-ez-primary">{t('chartProdukt')}</h3>
              <div style={{ width: '100%', height: 280 }}>
                <ResponsiveContainer>
                  <BarChart data={data.produkte} layout="vertical" margin={{ left: 30 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                    <XAxis type="number" fontSize={12} />
                    <YAxis type="category" dataKey="name" width={100} fontSize={11} />
                    <Tooltip formatter={(v) => fmt(v as number)} />
                    <Bar dataKey="menge" name={t('stueck')} fill={PRIMARY} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
