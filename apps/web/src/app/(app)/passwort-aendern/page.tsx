'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { api, ApiError } from '@/lib/api';
import { Button, Card, Input } from '@/components/ui';

const REGELN = [
  { test: (p: string) => p.length >= 12, key: 'regel12' },
  { test: (p: string) => /[A-Z]/.test(p), key: 'regelGross' },
  { test: (p: string) => /[a-z]/.test(p), key: 'regelKlein' },
  { test: (p: string) => /[0-9]/.test(p), key: 'regelZiffer' },
  { test: (p: string) => /[^A-Za-z0-9]/.test(p), key: 'regelSonder' },
] as const;

export default function PasswortAendernPage() {
  const router = useRouter();
  const t = useTranslations('passwort');
  const [alt, setAlt] = useState('');
  const [neu, setNeu] = useState('');
  const [wdh, setWdh] = useState('');
  const [phase, setPhase] = useState<'idle' | 'senden' | 'fertig'>('idle');
  const [fehler, setFehler] = useState('');

  const erfuellt = REGELN.filter((r) => r.test(neu)).length;
  const valide = erfuellt === REGELN.length && neu === wdh && alt.length > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFehler('');
    setPhase('senden');
    try {
      await api.post('/auth/me/passwort', { altesPasswort: alt, neuesPasswort: neu });
      setPhase('fertig');
      setTimeout(() => router.replace('/uebersicht'), 1500);
    } catch (err) {
      setFehler(err instanceof ApiError ? err.message : t('fehler'));
      setPhase('idle');
    }
  };

  return (
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="text-2xl font-bold text-ez-primary">{t('titel')}</h1>
      {phase === 'fertig' ? (
        <Card>
          <p className="text-ez-ampelGruen">{t('fertig')}</p>
        </Card>
      ) : (
        <Card>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium">{t('aktuelles')}</label>
              <Input type="password" value={alt} onChange={(e) => setAlt(e.target.value)} autoComplete="current-password" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">{t('neues')}</label>
              <Input type="password" value={neu} onChange={(e) => setNeu(e.target.value)} autoComplete="new-password" />
              <ul className="mt-2 space-y-0.5 text-xs">
                {REGELN.map((r) => (
                  <li key={r.key} className={r.test(neu) ? 'text-ez-ampelGruen' : 'text-gray-400'}>
                    {r.test(neu) ? '✓' : '○'} {t(r.key)}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">{t('wiederholen')}</label>
              <Input type="password" value={wdh} onChange={(e) => setWdh(e.target.value)} autoComplete="new-password" />
              {wdh.length > 0 && neu !== wdh && <p className="mt-1 text-xs text-ez-accent">{t('stimmenNicht')}</p>}
            </div>
            {fehler && <p className="rounded bg-ez-accent/10 p-2 text-sm text-ez-accent">{fehler}</p>}
            <Button type="submit" disabled={!valide || phase === 'senden'}>
              {phase === 'senden' ? t('speichert') : t('aendern')}
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}
