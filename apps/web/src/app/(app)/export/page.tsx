'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { downloadDatei } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, Card } from '@/components/ui';

function ExportKarte({ titel, beschreibung, format, onDownload }: { titel: string; beschreibung: string; format: string; onDownload: () => Promise<void> }) {
  const t = useTranslations('export');
  const tc = useTranslations('common');
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState('');
  const [ok, setOk] = useState(false);
  const klick = async () => {
    setBusy(true);
    setFehler('');
    setOk(false);
    try {
      await onDownload();
      setOk(true);
    } catch (e) {
      setFehler((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="flex flex-col justify-between space-y-3">
      <div>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-ez-primary">{titel}</h2>
          <span className="rounded bg-ez-primary/10 px-2 py-0.5 text-xs font-medium text-ez-primary">{format}</span>
        </div>
        <p className="mt-1 text-sm text-gray-500">{beschreibung}</p>
      </div>
      <div>
        <Button onClick={klick} disabled={busy}>
          {busy ? t('erzeuge') : tc('herunterladen')}
        </Button>
        {ok && <p className="mt-2 text-sm text-ez-ampelGruen">{t('gestartet')}</p>}
        {fehler && <p className="mt-2 rounded bg-ez-accent/10 p-2 text-sm text-ez-accent">✗ {fehler}</p>}
      </div>
    </Card>
  );
}

export default function ExportPage() {
  const t = useTranslations('export');
  const { user } = useAuth();
  const heute = new Date();
  const [jahr, setJahr] = useState(heute.getUTCFullYear());
  const rolle = user?.rolle;
  const darfAbweichung = rolle === 'VERTRIEBSLEITER' || rolle === 'BU_LEITER';
  const darfWord = rolle === 'BU_LEITER';
  const darfKonsolidierung = rolle === 'VERTRIEBSLEITER' || rolle === 'BU_LEITER' || rolle === 'ADMIN';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ez-primary">{t('titel')}</h1>
          <p className="text-sm text-gray-500">{t('beschreibung')}</p>
        </div>
        <select className="rounded border border-gray-300 px-2 py-1 text-sm" value={jahr} onChange={(e) => setJahr(Number(e.target.value))}>
          {[2024, 2025, 2026, 2027].map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {darfKonsolidierung && (
          <ExportKarte
            titel={t('konsolidierungTitel')}
            beschreibung={t('konsolidierungText')}
            format="XLSX"
            onDownload={() => downloadDatei(`/export/konsolidierung-monatlich?jahr=${jahr}`, 'POST', `konsolidierung-monatlich-${jahr}.xlsx`)}
          />
        )}
        {darfAbweichung && (
          <ExportKarte
            titel={t('abweichungTitel')}
            beschreibung={t('abweichungText')}
            format="XLSX"
            onDownload={() => downloadDatei(`/export/abweichungsbericht?jahr=${jahr}`, 'POST', `abweichungsbericht-${jahr}.xlsx`)}
          />
        )}
        {darfWord && (
          <ExportKarte
            titel={t('wordTitel')}
            beschreibung={t('wordText')}
            format="DOCX"
            onDownload={() => downloadDatei(`/export/word-report?jahr=${jahr}`, 'POST', `forecast-report-${jahr}.docx`)}
          />
        )}
        <ExportKarte
          titel={t('rohdatenTitel')}
          beschreibung={t('rohdatenText')}
          format="CSV"
          onDownload={() => downloadDatei(`/export/rohdaten?jahr=${jahr}`, 'GET', `rohdaten-${jahr}.csv`)}
        />
      </div>

      {!darfAbweichung && !darfWord && <p className="text-sm text-gray-400">{t('nurLeitung')}</p>}
    </div>
  );
}
