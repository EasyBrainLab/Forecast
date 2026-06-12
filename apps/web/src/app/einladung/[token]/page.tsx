'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, setToken } from '@/lib/api';
import { Button, Card, Input } from '@/components/ui';

interface Invitation {
  email: string;
  name: string;
}

export default function EinladungPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [info, setInfo] = useState<Invitation | null>(null);
  const [ladeFehler, setLadeFehler] = useState<string | null>(null);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [fehler, setFehler] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<Invitation>(`/auth/invitation/${token}/validate`)
      .then(setInfo)
      .catch((e) => setLadeFehler((e as Error).message || 'Einladung ungültig oder abgelaufen.'));
  }, [token]);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setFehler(null);
    if (pw !== pw2) {
      setFehler('Die Passwörter stimmen nicht überein.');
      return;
    }
    setBusy(true);
    try {
      const res = await api.post<{ accessToken: string }>('/auth/invitation/accept', { token, passwort: pw });
      setToken(res.accessToken);
      window.location.assign('/uebersicht');
    } catch (err) {
      setFehler((err as Error).message || 'Aktivierung fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-ez-primary/5 p-4">
      <Card className="w-full max-w-sm">
        <h1 className="mb-1 text-xl font-bold text-ez-primary">Konto aktivieren</h1>
        <p className="mb-5 text-sm text-gray-500">Forecast-Portal BU Brachytherapie</p>

        {ladeFehler && <p className="rounded bg-ez-accent/10 p-3 text-sm text-ez-accent">{ladeFehler}</p>}

        {info && !ladeFehler && (
          <form onSubmit={submit} className="space-y-4">
            <p className="text-sm">
              Willkommen, <strong>{info.name}</strong> ({info.email}). Bitte vergeben Sie Ihr Passwort.
            </p>
            <div>
              <label className="mb-1 block text-sm font-medium">Neues Passwort</label>
              <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} required autoFocus />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Passwort wiederholen</label>
              <Input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} required />
            </div>
            <p className="text-xs text-gray-500">Mindestens 12 Zeichen mit Groß-/Kleinbuchstabe, Ziffer und Sonderzeichen.</p>
            {fehler && <p className="text-sm text-ez-accent">{fehler}</p>}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? 'Aktiviere…' : 'Konto aktivieren & anmelden'}
            </Button>
          </form>
        )}

        {!info && !ladeFehler && <p className="text-sm text-gray-500">Einladung wird geprüft…</p>}
      </Card>
    </main>
  );
}
