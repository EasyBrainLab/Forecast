'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { Button, Card, Input } from '@/components/ui';

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [passwort, setPasswort] = useState('');
  const [fehler, setFehler] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setFehler(null);
    setBusy(true);
    try {
      await login(email, passwort);
      router.replace('/uebersicht');
    } catch (err) {
      setFehler((err as Error).message ?? 'Anmeldung fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-ez-primary/5 p-4">
      <Card className="w-full max-w-sm">
        <h1 className="mb-1 text-xl font-bold text-ez-primary">Forecast-Portal</h1>
        <p className="mb-6 text-sm text-gray-500">BU Brachytherapie — Eckert &amp; Ziegler</p>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">E-Mail</label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Passwort</label>
            <Input type="password" value={passwort} onChange={(e) => setPasswort(e.target.value)} required />
          </div>
          {fehler && <p className="text-sm text-ez-accent">{fehler}</p>}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? 'Anmelden…' : 'Anmelden'}
          </Button>
        </form>
      </Card>
    </main>
  );
}
