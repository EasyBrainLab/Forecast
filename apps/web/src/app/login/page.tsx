'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/auth';
import { Button, Card, Input } from '@/components/ui';
import { LocaleSwitch } from '@/components/locale-switch';

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const t = useTranslations('login');
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
      setFehler((err as Error).message ?? t('fehlgeschlagen'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-ez-primary/5 p-4">
      <Card className="w-full max-w-sm">
        <div className="mb-1 flex items-start justify-between">
          <h1 className="text-xl font-bold text-ez-primary">{t('titel')}</h1>
          <LocaleSwitch className="text-xs text-gray-500" />
        </div>
        <p className="mb-6 text-sm text-gray-500">{t('untertitel')}</p>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">{t('email')}</label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">{t('passwort')}</label>
            <Input type="password" value={passwort} onChange={(e) => setPasswort(e.target.value)} required />
          </div>
          {fehler && <p className="text-sm text-ez-accent">{fehler}</p>}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? t('anmeldet') : t('anmelden')}
          </Button>
        </form>
      </Card>
    </main>
  );
}
