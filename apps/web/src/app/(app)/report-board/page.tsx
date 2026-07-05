'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, Card, Ampel } from '@/components/ui';
import { monKurz } from '@/lib/monate';

interface BoardZeile {
  regionCode: string;
  bezeichnung: string;
  status: string;
  eingereichtAm: string | null;
  gelesenAm: string | null;
  gelesenVon: string | null;
  userName: string | null;
  ueberfaellig: boolean;
}
interface Board {
  periode: string;
  frist: string;
  regionen: BoardZeile[];
}

export default function ReportBoardPage() {
  const t = useTranslations('reportBoard');
  const tr = useTranslations('report');
  const tc = useTranslations('common');
  const locale = useLocale();
  const MON = monKurz(locale);
  const { user } = useAuth();
  const qc = useQueryClient();
  const heute = new Date();
  const [jahr, setJahr] = useState(heute.getUTCMonth() === 0 ? heute.getUTCFullYear() - 1 : heute.getUTCFullYear());
  const [monat, setMonat] = useState(heute.getUTCMonth() === 0 ? 12 : heute.getUTCMonth());
  const periode = `${jahr}-${String(monat).padStart(2, '0')}`;
  const [fehler, setFehler] = useState('');

  const { data, isLoading } = useQuery({ queryKey: ['report-board', periode], queryFn: () => api.get<Board>(`/report/board/${periode}`) });
  const darfLesen = user?.rolle === 'VERTRIEBSLEITER' || user?.rolle === 'BU_LEITER';

  const alsGelesen = async (regionCode: string) => {
    setFehler('');
    try {
      await api.post(`/report/periode/${periode}/region/${regionCode}/gelesen`);
      qc.invalidateQueries({ queryKey: ['report-board', periode] });
    } catch (e) {
      setFehler(e instanceof ApiError ? e.message : tc('fehler'));
    }
  };

  const ampel = (z: BoardZeile): 'gruen' | 'gelb' | 'rot' | 'grau' => {
    if (z.status === 'GELESEN') return 'gruen';
    if (z.status === 'EINGEREICHT') return 'gruen';
    if (z.ueberfaellig) return 'rot';
    if (z.status === 'ENTWURF') return 'gelb';
    return 'grau';
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ez-primary">{t('titel')}</h1>
          <p className="text-sm text-gray-500">{data ? t('beschreibung', { frist: new Date(data.frist).toLocaleDateString('de-DE') }) : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <select className="rounded border border-gray-300 px-2 py-1 text-sm" value={monat} onChange={(e) => setMonat(Number(e.target.value))}>
            {MON.map((m, i) => (
              <option key={i + 1} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
          <select className="rounded border border-gray-300 px-2 py-1 text-sm" value={jahr} onChange={(e) => setJahr(Number(e.target.value))}>
            {[2025, 2026, 2027].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </div>

      {fehler && <p className="rounded bg-ez-accent/10 p-2 text-sm text-ez-accent">{fehler}</p>}
      {isLoading && <p className="text-gray-500">{tc('laedt')}</p>}

      {data && (
        <Card>
          <table className="w-full text-sm">
            <thead className="text-left text-gray-500">
              <tr>
                <th className="py-2">{t('region')}</th>
                <th className="py-2">{t('status')}</th>
                <th className="py-2">{t('eingereichtAm')}</th>
                <th className="py-2">{t('durch')}</th>
                <th className="py-2">{t('gelesen')}</th>
                <th className="py-2 text-right">{t('aktion')}</th>
              </tr>
            </thead>
            <tbody>
              {data.regionen.map((z) => (
                <tr key={z.regionCode} className="border-t border-gray-100">
                  <td className="py-2 font-medium">
                    <span className="inline-flex items-center gap-2">
                      <Ampel farbe={ampel(z)} />
                      {z.regionCode} · {z.bezeichnung}
                    </span>
                  </td>
                  <td className="py-2">
                    {z.status === 'FEHLT' ? (
                      <span className={z.ueberfaellig ? 'font-semibold text-ez-accent' : 'text-gray-500'}>
                        {t('fehlt')}
                        {z.ueberfaellig ? ` — ${t('ueberfaellig')}` : ''}
                      </span>
                    ) : (
                      <span className={z.ueberfaellig && z.status === 'ENTWURF' ? 'font-semibold text-ez-accent' : ''}>
                        {tr(`statusLabel.${z.status}`)}
                        {z.ueberfaellig && z.status === 'ENTWURF' ? ` — ${t('ueberfaellig')}` : ''}
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-gray-600">{z.eingereichtAm ? new Date(z.eingereichtAm).toLocaleDateString('de-DE') : '—'}</td>
                  <td className="py-2 text-gray-600">{z.userName ?? '—'}</td>
                  <td className="py-2 text-gray-600">{z.gelesenAm ? `${new Date(z.gelesenAm).toLocaleDateString('de-DE')} (${z.gelesenVon ?? ''})` : '—'}</td>
                  <td className="py-2 text-right">
                    <span className="inline-flex items-center gap-2">
                      {darfLesen && z.status === 'EINGEREICHT' && (
                        <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => alsGelesen(z.regionCode)}>
                          {t('alsGelesen')}
                        </Button>
                      )}
                      {z.status !== 'FEHLT' && (
                        <Link href="/report" className="text-xs text-ez-primary hover:underline">
                          {t('berichtAnsehen')}
                        </Link>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
