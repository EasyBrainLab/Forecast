'use client';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, Input } from '@/components/ui';

/**
 * Abschluss (F6/F7/F8) und Wiedereröffnung (F9) einer Forecast-Periode.
 * Beide Aktionen kaskadieren serverseitig über die Region: Abschließen zieht ältere offene Perioden mit,
 * Wiedereröffnen die jüngeren abgeschlossenen — so entsteht keine Lücke zwischen offen und abgeschlossen.
 */
export function PeriodenAktionen({ periode, regionCode, status }: { periode: string; regionCode: string; status: string }) {
  const t = useTranslations('forecastMonat');
  const { user } = useAuth();
  const qc = useQueryClient();
  const [reopen, setReopen] = useState(false);
  const [begruendung, setBegruendung] = useState('');

  const darfAbschliessen = user?.rolle === 'BU_LEITER' || user?.rolle === 'ADMIN';
  const darfWiederOeffnen = darfAbschliessen || user?.rolle === 'VERTRIEBSLEITER';
  const abgeschlossen = status === 'ABGESCHLOSSEN';

  const abschliessen = useMutation({
    mutationFn: () => api.post(`/forecast/${periode}/${regionCode}/abschliessen`, {}),
    onSuccess: () => qc.invalidateQueries(),
  });
  const wiederOeffnen = useMutation({
    mutationFn: () => api.post(`/forecast/${periode}/${regionCode}/wieder-oeffnen`, { begruendung }),
    onSuccess: () => {
      setReopen(false);
      setBegruendung('');
      qc.invalidateQueries();
    },
  });

  const fehler = (abschliessen.error ?? wiederOeffnen.error) as ApiError | null;

  if (abgeschlossen && !darfWiederOeffnen) return null;
  if (!abgeschlossen && !darfAbschliessen) return null;

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {!abgeschlossen && darfAbschliessen && (
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
        {abgeschlossen && darfWiederOeffnen && !reopen && (
          <Button variant="ghost" onClick={() => setReopen(true)}>
            {t('wiederOeffnen')}
          </Button>
        )}
      </div>

      {reopen && (
        <div className="w-full max-w-lg space-y-2 rounded border border-gray-200 bg-gray-50 p-3">
          <p className="text-xs text-gray-500">{t('wiederOeffnenHinweis')}</p>
          <Input
            autoFocus
            value={begruendung}
            onChange={(e) => setBegruendung(e.target.value)}
            placeholder={t('wiederOeffnenBegruendung')}
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setReopen(false);
                setBegruendung('');
              }}
            >
              {t('abbrechen')}
            </Button>
            <Button disabled={begruendung.trim().length < 3 || wiederOeffnen.isPending} onClick={() => wiederOeffnen.mutate()}>
              {wiederOeffnen.isPending ? t('wiederOeffnenBusy') : t('wiederOeffnen')}
            </Button>
          </div>
        </div>
      )}

      {fehler && <p className="text-xs text-ez-accent">{fehler.message}</p>}
    </div>
  );
}
