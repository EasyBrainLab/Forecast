'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button, Card, Input } from '@/components/ui';
import { ROLLEN_LABEL, type Rolle } from '@/lib/auth';

interface User {
  id: string;
  email: string;
  name: string;
  rolle: Rolle;
  status: string;
}

const ROLLEN: Rolle[] = ['AGM', 'VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN', 'SUPPORT'];

interface Region {
  code: string;
  bezeichnung: string;
  forecastRelevant: boolean;
}

export default function UsersPage() {
  const qc = useQueryClient();
  const { data: users } = useQuery({ queryKey: ['users'], queryFn: () => api.get<User[]>('/admin/users') });
  const { data: regionen } = useQuery({ queryKey: ['regionen'], queryFn: () => api.get<Region[]>('/stammdaten/regionen') });
  const [form, setForm] = useState<{ email: string; name: string; rolle: Rolle; regionCodes: string[] }>({ email: '', name: '', rolle: 'AGM', regionCodes: [] });
  const [url, setUrl] = useState<string | null>(null);
  const invite = useMutation({
    mutationFn: () => api.post<{ einladungUrl: string }>('/admin/users', form),
    onSuccess: (res) => {
      setUrl(res.einladungUrl);
      setForm({ email: '', name: '', rolle: 'AGM', regionCodes: [] });
      qc.invalidateQueries({ queryKey: ['users'] });
    },
  });
  const toggleRegion = (code: string): void =>
    setForm((f) => ({ ...f, regionCodes: f.regionCodes.includes(code) ? f.regionCodes.filter((c) => c !== code) : [...f.regionCodes, code] }));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-ez-primary">Nutzerverwaltung</h1>

      <Card>
        <h2 className="mb-3 font-semibold">Nutzer einladen</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            invite.mutate();
          }}
          className="space-y-3"
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <Input placeholder="E-Mail" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            <Input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <select className="rounded border border-gray-300 px-3 py-2 text-sm" value={form.rolle} onChange={(e) => setForm({ ...form, rolle: e.target.value as Rolle })}>
              {ROLLEN.map((r) => (
                <option key={r} value={r}>
                  {ROLLEN_LABEL[r]}
                </option>
              ))}
            </select>
          </div>
          {form.rolle === 'AGM' && (
            <div className="rounded border border-gray-200 bg-gray-50 p-3">
              <div className="mb-2 text-sm font-medium">Region(en) / Kostenstellen-Zuordnung für diesen AGM</div>
              <div className="flex flex-wrap gap-3">
                {(regionen ?? []).filter((r) => r.forecastRelevant).map((r) => (
                  <label key={r.code} className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" checked={form.regionCodes.includes(r.code)} onChange={() => toggleRegion(r.code)} />
                    {r.code} — {r.bezeichnung}
                  </label>
                ))}
              </div>
              {form.regionCodes.length === 0 && <p className="mt-2 text-xs text-ez-accent">Bitte mind. eine Region wählen — sonst sieht der AGM keine Daten.</p>}
            </div>
          )}
          <Button type="submit" disabled={invite.isPending || (form.rolle === 'AGM' && form.regionCodes.length === 0)}>
            {invite.isPending ? 'Lade ein…' : 'Einladen'}
          </Button>
        </form>
        {invite.isError && <p className="mt-2 text-sm text-ez-accent">{(invite.error as Error).message}</p>}
        {url && (
          <p className="mt-3 break-all rounded bg-gray-50 p-2 text-xs">
            Einladungslink: <a className="text-ez-primary underline" href={url}>{url}</a>
          </p>
        )}
      </Card>

      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-600">
            <tr>
              <th className="p-3">Name</th>
              <th className="p-3">E-Mail</th>
              <th className="p-3">Rolle</th>
              <th className="p-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {users?.map((u) => (
              <tr key={u.id} className="border-t">
                <td className="p-3">{u.name}</td>
                <td className="p-3">{u.email}</td>
                <td className="p-3">{ROLLEN_LABEL[u.rolle]}</td>
                <td className="p-3">{u.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
