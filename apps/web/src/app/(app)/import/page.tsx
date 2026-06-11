'use client';
import { useState } from 'react';
import { getToken } from '@/lib/api';
import { Button, Card } from '@/components/ui';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

async function upload(pfad: string, file: File): Promise<Record<string, unknown>> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`${BASE}${pfad}`, { method: 'POST', headers: { Authorization: `Bearer ${getToken()}` }, body: fd });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? 'Import fehlgeschlagen');
  return data;
}

function Bericht({ data }: { data: Record<string, unknown> }) {
  const b = (data.bericht ?? data) as Record<string, unknown>;
  return (
    <pre className="mt-2 max-h-64 overflow-auto rounded bg-gray-50 p-2 text-xs">{JSON.stringify(b, null, 2)}</pre>
  );
}

export default function ImportPage() {
  const [ist, setIst] = useState<Record<string, unknown> | null>(null);
  const [budget, setBudget] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  const run = async (typ: 'ist' | 'budget', pfad: string, file?: File): Promise<void> => {
    if (!file) return;
    setErr('');
    setBusy(typ);
    try {
      const r = await upload(pfad, file);
      typ === 'ist' ? setIst(r) : setBudget(r);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-ez-primary">Datenimport</h1>
      {err && <p className="text-sm text-ez-accent">{err}</p>}

      <Card>
        <h2 className="font-semibold">Ist-Umsätze (CSV)</h2>
        <p className="mb-3 text-sm text-gray-500">GL-Abriss „External Revenue", idempotent über RECID.</p>
        <input type="file" accept=".csv" onChange={(e) => run('ist', '/ist-import/upload', e.target.files?.[0])} disabled={busy === 'ist'} />
        {ist && <Bericht data={ist} />}
      </Card>

      <Card>
        <h2 className="font-semibold">Budget (Excel)</h2>
        <p className="mb-3 text-sm text-gray-500">Wide-Format, wird in Long-Format überführt (Versionierung).</p>
        <input type="file" accept=".xlsx" onChange={(e) => run('budget', '/budgets/import', e.target.files?.[0])} disabled={busy === 'budget'} />
        {budget && <Bericht data={budget} />}
      </Card>
    </div>
  );
}
