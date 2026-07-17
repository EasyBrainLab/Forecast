'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, Card, Input } from '@/components/ui';
import { DataTable, type Column } from '@/components/data-table';
import { ROLLEN_LABEL, type Rolle } from '@/lib/auth';

interface User {
  id: string;
  email: string;
  name: string;
  rolle: Rolle;
  status: string;
  regionCodes: string[];
}

const ROLLEN: Rolle[] = ['AGM', 'VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN', 'SUPPORT'];

const STATUS_BADGE: Record<string, string> = {
  VERIFIZIERT: 'bg-ez-ampelGruen/20 text-ez-ampelGruen',
  EINGELADEN: 'bg-ez-ampelGelb/20 text-yellow-700',
  DEAKTIVIERT: 'bg-gray-200 text-gray-500',
};

interface Region {
  code: string;
  bezeichnung: string;
  forecastRelevant: boolean;
}

export default function UsersPage() {
  const qc = useQueryClient();
  const { user: aktor } = useAuth();
  const { data: users } = useQuery({ queryKey: ['users'], queryFn: () => api.get<User[]>('/admin/users') });
  const { data: regionen } = useQuery({ queryKey: ['regionen'], queryFn: () => api.get<Region[]>('/stammdaten/regionen') });
  const forecastRegionen = (regionen ?? []).filter((r) => r.forecastRelevant);

  const [form, setForm] = useState<{ email: string; name: string; rolle: Rolle; regionCodes: string[] }>({ email: '', name: '', rolle: 'AGM', regionCodes: [] });
  const [url, setUrl] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ rolle: Rolle; regionCodes: string[] }>({ rolle: 'AGM', regionCodes: [] });
  const [fehler, setFehler] = useState('');

  const reload = () => qc.invalidateQueries({ queryKey: ['users'] });
  const fehlerVon = (e: unknown) => setFehler(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen.');

  const invite = useMutation({
    mutationFn: () => api.post<{ einladungUrl: string }>('/admin/users', form),
    onSuccess: (res) => {
      setUrl(res.einladungUrl);
      setForm({ email: '', name: '', rolle: 'AGM', regionCodes: [] });
      reload();
    },
  });

  const speichern = useMutation({
    mutationFn: (u: User) => api.patch(`/admin/users/${u.id}`, { rolle: draft.rolle, regionCodes: draft.rolle === 'AGM' ? draft.regionCodes : [] }),
    onSuccess: () => {
      setEditId(null);
      setFehler('');
      reload();
    },
    onError: fehlerVon,
  });

  const aktion = useMutation({
    mutationFn: ({ id, was }: { id: string; was: 'deaktivieren' | 'reaktivieren' | 'reinvite' }) => api.post(`/admin/users/${id}/${was}`),
    onSuccess: () => {
      setFehler('');
      reload();
    },
    onError: fehlerVon,
  });

  const loeschen = useMutation({
    mutationFn: (id: string) => api.del(`/admin/users/${id}`),
    onSuccess: () => {
      setFehler('');
      reload();
    },
    onError: fehlerVon,
  });

  const toggle = (list: string[], code: string) => (list.includes(code) ? list.filter((c) => c !== code) : [...list, code]);
  const starteEdit = (u: User) => {
    setEditId(u.id);
    setDraft({ rolle: u.rolle, regionCodes: u.regionCodes });
    setFehler('');
  };

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
                {forecastRegionen.map((r) => (
                  <label key={r.code} className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" checked={form.regionCodes.includes(r.code)} onChange={() => setForm((f) => ({ ...f, regionCodes: toggle(f.regionCodes, r.code) }))} />
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

      {fehler && <p className="rounded bg-ez-accent/10 p-2 text-sm text-ez-accent">{fehler}</p>}

      {users && (
        <Card>
          <DataTable
            rows={users}
            rowKey={(u) => u.id}
            initialSort={{ key: 'name', dir: 'asc' }}
            leerText="Noch keine Nutzer."
            columns={[
              { key: 'name', label: 'Name', value: (u) => u.name },
              { key: 'email', label: 'E-Mail', value: (u) => u.email, render: (u) => <span className="text-gray-500">{u.email}</span> },
              {
                key: 'rolle', label: 'Rolle / Region', filter: 'select', value: (u) => ROLLEN_LABEL[u.rolle],
                render: (u) => editId === u.id ? (
                  <div className="space-y-2">
                    <select className="rounded border border-gray-300 px-2 py-1 text-sm" value={draft.rolle} onChange={(e) => setDraft((d) => ({ ...d, rolle: e.target.value as Rolle }))}>
                      {ROLLEN.map((r) => <option key={r} value={r}>{ROLLEN_LABEL[r]}</option>)}
                    </select>
                    {draft.rolle === 'AGM' && (
                      <div className="flex flex-wrap gap-2 rounded border border-gray-200 bg-gray-50 p-2">
                        {forecastRegionen.map((r) => (
                          <label key={r.code} className="flex items-center gap-1 text-xs">
                            <input type="checkbox" checked={draft.regionCodes.includes(r.code)} onChange={() => setDraft((d) => ({ ...d, regionCodes: toggle(d.regionCodes, r.code) }))} />
                            {r.code}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                    <span>{ROLLEN_LABEL[u.rolle]}</span>
                    {u.rolle === 'AGM' && <span className="ml-1 text-xs text-gray-400">({u.regionCodes.join(', ') || 'keine Region'})</span>}
                  </div>
                ),
              },
              {
                key: 'status', label: 'Status', filter: 'select', value: (u) => u.status,
                render: (u) => <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[u.status] ?? 'bg-gray-100'}`}>{u.status}</span>,
              },
              {
                key: 'aktion', label: 'Aktionen', filter: 'none', sortable: false, align: 'right',
                render: (u) => {
                  const selbst = u.id === aktor?.id;
                  const aktiv = u.status !== 'DEAKTIVIERT';
                  return (
                    <div className="flex flex-wrap justify-end gap-2">
                      {editId === u.id ? (
                        <>
                          <Button className="px-2 py-1 text-xs" disabled={speichern.isPending || (draft.rolle === 'AGM' && draft.regionCodes.length === 0)} onClick={() => speichern.mutate(u)}>Speichern</Button>
                          <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setEditId(null)}>Abbrechen</Button>
                        </>
                      ) : (
                        <>
                          <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => starteEdit(u)}>Rolle/Region</Button>
                          {u.status === 'EINGELADEN' && <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => aktion.mutate({ id: u.id, was: 'reinvite' })}>Erneut einladen</Button>}
                          {aktiv ? (
                            <Button variant="ghost" className="px-2 py-1 text-xs" disabled={selbst} onClick={() => aktion.mutate({ id: u.id, was: 'deaktivieren' })}>Deaktivieren</Button>
                          ) : (
                            <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => aktion.mutate({ id: u.id, was: 'reaktivieren' })}>Reaktivieren</Button>
                          )}
                          <Button variant="danger" className="px-2 py-1 text-xs" disabled={selbst} onClick={() => { if (window.confirm(`Nutzer „${u.name}" wirklich löschen? Nur möglich, wenn keine Historie existiert — sonst bitte deaktivieren.`)) loeschen.mutate(u.id); }}>Löschen</Button>
                        </>
                      )}
                    </div>
                  );
                },
              },
            ] satisfies Column<User>[]}
          />
        </Card>
      )}
    </div>
  );
}
