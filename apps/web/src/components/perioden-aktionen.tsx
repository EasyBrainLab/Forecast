'use client';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, Input } from '@/components/ui';

/**
 * Perioden-Aktionen: Abschluss (F6/F7/F8), Wiedereröffnung (F9) und Zurücksetzen auf OFFEN (F3/F4).
 * Abschließen zieht ältere offene Perioden mit, Wiedereröffnen die jüngeren abgeschlossenen (Kaskade).
 * Zurücksetzen (Leitung/Admin) setzt einen fertiggemeldeten Forecast wieder auf OFFEN — z. B. wenn ein
 * AGM versehentlich fertiggemeldet hat und noch Anpassungen nötig sind. Begründung ist Pflicht.
 */
export function PeriodenAktionen({ periode, regionCode, status }: { periode: string; regionCode: string; status: string }) {
  const t = useTranslations('forecastMonat');
  const { user } = useAuth();
  const qc = useQueryClient();
  const [reopen, setReopen] = useState(false);
  const [reopenBegr, setReopenBegr] = useState('');
  const [reset, setReset] = useState(false);
  const [resetBegr, setResetBegr] = useState('');

  const darfAbschliessen = user?.rolle === 'BU_LEITER' || user?.rolle === 'ADMIN';
  const darfWiederOeffnen = darfAbschliessen || user?.rolle === 'VERTRIEBSLEITER';
  const darfZuruecksetzen = user?.rolle === 'VERTRIEBSLEITER' || user?.rolle === 'BU_LEITER' || user?.rolle === 'ADMIN';
  const abgeschlossen = status === 'ABGESCHLOSSEN';
  const fertiggemeldet = status === 'BESTAETIGT' || status === 'ANGEPASST';

  const zeigeAbschliessen = !abgeschlossen && darfAbschliessen;
  const zeigeZuruecksetzen = fertiggemeldet && darfZuruecksetzen;
  const zeigeWiederOeffnen = abgeschlossen && darfWiederOeffnen;

  const abschliessen = useMutation({
    mutationFn: () => api.post(`/forecast/${periode}/${regionCode}/abschliessen`, {}),
    onSuccess: () => qc.invalidateQueries(),
  });
  const wiederOeffnen = useMutation({
    mutationFn: () => api.post(`/forecast/${periode}/${regionCode}/wieder-oeffnen`, { begruendung: reopenBegr }),
    onSuccess: () => {
      setReopen(false);
      setReopenBegr('');
      qc.invalidateQueries();
    },
  });
  const zuruecksetzen = useMutation({
    mutationFn: () => api.post(`/forecast/${periode}/${regionCode}/zurueckweisen`, { begruendung: resetBegr }),
    onSuccess: () => {
      setReset(false);
      setResetBegr('');
      qc.invalidateQueries();
    },
  });

  const fehler = (abschliessen.error ?? wiederOeffnen.error ?? zuruecksetzen.error) as ApiError | null;

  if (!zeigeAbschliessen && !zeigeZuruecksetzen && !zeigeWiederOeffnen) return null;

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {zeigeZuruecksetzen && !reset && (
          <Button variant="ghost" onClick={() => setReset(true)}>
            {t('zuruecksetzen')}
          </Button>
        )}
        {zeigeAbschliessen && (
          <Button
            variant="ghost"
            disabled={abschliessen.isPending}
            onClick={() => {
              if (window.confirm(t('abschliessenFrage', { periode }))) abschliessen.mutate();
            }}
          >
            {abschliessen.isPending ? t('abschliessenBusy') : t('abschliessen')}
          </Button>
        )}
        {zeigeWiederOeffnen && !reopen && (
          <Button variant="ghost" onClick={() => setReopen(true)}>
            {t('wiederOeffnen')}
          </Button>
        )}
      </div>

      {reset && (
        <div className="w-full max-w-lg space-y-2 rounded border border-gray-200 bg-gray-50 p-3">
          <p className="text-xs text-gray-500">{t('zuruecksetzenHinweis')}</p>
          <Input autoFocus value={resetBegr} onChange={(e) => setResetBegr(e.target.value)} placeholder={t('zuruecksetzenBegruendung')} />
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setReset(false);
                setResetBegr('');
              }}
            >
              {t('abbrechen')}
            </Button>
            <Button disabled={resetBegr.trim().length < 3 || zuruecksetzen.isPending} onClick={() => zuruecksetzen.mutate()}>
              {zuruecksetzen.isPending ? t('zuruecksetzenBusy') : t('zuruecksetzen')}
            </Button>
          </div>
        </div>
      )}

      {reopen && (
        <div className="w-full max-w-lg space-y-2 rounded border border-gray-200 bg-gray-50 p-3">
          <p className="text-xs text-gray-500">{t('wiederOeffnenHinweis')}</p>
          <Input autoFocus value={reopenBegr} onChange={(e) => setReopenBegr(e.target.value)} placeholder={t('wiederOeffnenBegruendung')} />
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setReopen(false);
                setReopenBegr('');
              }}
            >
              {t('abbrechen')}
            </Button>
            <Button disabled={reopenBegr.trim().length < 3 || wiederOeffnen.isPending} onClick={() => wiederOeffnen.mutate()}>
              {wiederOeffnen.isPending ? t('wiederOeffnenBusy') : t('wiederOeffnen')}
            </Button>
          </div>
        </div>
      )}

      {fehler && <p className="text-xs text-ez-accent">{fehler.message}</p>}
    </div>
  );
}
