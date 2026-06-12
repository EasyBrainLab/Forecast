'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { Button, Card, Input } from '@/components/ui';

const REGELN = [
  { test: (p: string) => p.length >= 12, text: 'mindestens 12 Zeichen' },
  { test: (p: string) => /[A-Z]/.test(p), text: 'ein Großbuchstabe' },
  { test: (p: string) => /[a-z]/.test(p), text: 'ein Kleinbuchstabe' },
  { test: (p: string) => /[0-9]/.test(p), text: 'eine Ziffer' },
  { test: (p: string) => /[^A-Za-z0-9]/.test(p), text: 'ein Sonderzeichen' },
];

export default function PasswortAendernPage() {
  const router = useRouter();
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
      setFehler(err instanceof ApiError ? err.message : 'Fehler beim Ändern.');
      setPhase('idle');
    }
  };

  return (
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="text-2xl font-bold text-ez-primary">Passwort ändern</h1>
      {phase === 'fertig' ? (
        <Card>
          <p className="text-ez-ampelGruen">✓ Passwort geändert. Sie werden weitergeleitet…</p>
        </Card>
      ) : (
        <Card>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium">Aktuelles Passwort</label>
              <Input type="password" value={alt} onChange={(e) => setAlt(e.target.value)} autoComplete="current-password" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Neues Passwort</label>
              <Input type="password" value={neu} onChange={(e) => setNeu(e.target.value)} autoComplete="new-password" />
              <ul className="mt-2 space-y-0.5 text-xs">
                {REGELN.map((r) => (
                  <li key={r.text} className={r.test(neu) ? 'text-ez-ampelGruen' : 'text-gray-400'}>
                    {r.test(neu) ? '✓' : '○'} {r.text}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Neues Passwort wiederholen</label>
              <Input type="password" value={wdh} onChange={(e) => setWdh(e.target.value)} autoComplete="new-password" />
              {wdh.length > 0 && neu !== wdh && <p className="mt-1 text-xs text-ez-accent">Passwörter stimmen nicht überein.</p>}
            </div>
            {fehler && <p className="rounded bg-ez-accent/10 p-2 text-sm text-ez-accent">{fehler}</p>}
            <Button type="submit" disabled={!valide || phase === 'senden'}>
              {phase === 'senden' ? 'Speichert…' : 'Passwort ändern'}
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}
