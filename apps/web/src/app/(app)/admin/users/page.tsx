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

export default function UsersPage() {
  const qc = useQueryClient();
  const { data: users } = useQuery({ queryKey: ['users'], queryFn: () => api.get<User[]>('/admin/users') });
  const [form, setForm] = useState({ email: '', name: '', rolle: 'AGM' as Rolle });
  const [url, setUrl] = useState<string | null>(null);
  const invite = useMutation({
    mutationFn: () => api.post<{ einladungUrl: string }>('/admin/users', form),
    onSuccess: (res) => {
      setUrl(res.einladungUrl);
      setForm({ email: '', name: '', rolle: 'AGM' });
      qc.invalidateQueries({ queryKey: ['users'] });
    },
  });

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
          className="grid gap-3 sm:grid-cols-4"
        >
          <Input placeholder="E-Mail" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          <Input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <select className="rounded border border-gray-300 px-3 py-2 text-sm" value={form.rolle} onChange={(e) => setForm({ ...form, rolle: e.target.value as Rolle })}>
            {ROLLEN.map((r) => (
              <option key={r} value={r}>
                {ROLLEN_LABEL[r]}
              </option>
            ))}
          </select>
          <Button type="submit" disabled={invite.isPending}>
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
