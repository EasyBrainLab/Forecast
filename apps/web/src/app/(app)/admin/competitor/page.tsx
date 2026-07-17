'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, Card, Input } from '@/components/ui';
import { DataTable } from '@/components/data-table';

interface Competitor {
  id: string;
  name: string;
  aktiv: boolean;
  notiz: string | null;
  sortierung: number;
}

export default function CompetitorAdminPage() {
  const { user } = useAuth();
  const darfBearbeiten = user?.rolle === 'ADMIN';
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['competitor-admin'], queryFn: () => api.get<Competitor[]>('/competitor') });
  const [name, setName] = useState('');
  const [notiz, setNotiz] = useState('');
  const [fehler, setFehler] = useState('');
  const reload = () => qc.invalidateQueries({ queryKey: ['competitor-admin'] });

  const erstellen = async () => {
    setFehler('');
    if (!name.trim()) return setFehler('Name ist erforderlich.');
    try {
      await api.post('/competitor', { name: name.trim(), notiz: notiz.trim() || undefined });
      setName('');
      setNotiz('');
      reload();
    } catch (e) {
      setFehler(e instanceof ApiError ? e.message : 'Fehler beim Anlegen.');
    }
  };
  const speichern = async (c: Competitor, patch: Partial<Competitor>) => {
    setFehler('');
    try {
      await api.patch(`/competitor/${c.id}`, patch);
      reload();
    } catch (e) {
      setFehler(e instanceof ApiError ? e.message : 'Fehler beim Speichern.');
    }
  };
  const loeschen = async (c: Competitor) => {
    if (!window.confirm(`Wettbewerber „${c.name}" wirklich löschen?`)) return;
    setFehler('');
    try {
      await api.del(`/competitor/${c.id}`);
      reload();
    } catch (e) {
      setFehler(e instanceof ApiError ? e.message : 'Fehler beim Löschen.');
    }
  };

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-ez-primary">Wettbewerber-Stammliste</h1>
        <p className="text-sm text-gray-500">Pflichtauswahl für Ausschreibungen und Wettbewerbsbeobachtung — kein Freitext. Deaktivierte bleiben für die Historie erhalten, erscheinen aber nicht mehr in Auswahllisten.</p>
      </div>

      {darfBearbeiten && (
        <Card className="space-y-3">
          <h2 className="font-semibold text-ez-primary">Neuen Wettbewerber anlegen</h2>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1">
              <label className="mb-1 block text-sm font-medium text-gray-700">Name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Elekta" />
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-sm font-medium text-gray-700">Notiz (optional)</label>
              <Input value={notiz} onChange={(e) => setNotiz(e.target.value)} />
            </div>
            <Button onClick={erstellen}>Anlegen</Button>
          </div>
          {fehler && <p className="rounded bg-ez-accent/10 p-2 text-sm text-ez-accent">{fehler}</p>}
        </Card>
      )}

      {isLoading && <p className="text-gray-500">Lädt…</p>}
      {data && (
        <Card>
          <DataTable
            rows={data}
            rowKey={(c) => c.id}
            initialSort={{ key: 'name', dir: 'asc' }}
            leerText="Noch keine Wettbewerber erfasst."
            columns={[
              {
                key: 'name', label: 'Name', value: (c) => c.name,
                render: (c) => darfBearbeiten
                  ? <input className="w-full rounded border border-transparent px-1 py-1 hover:border-gray-300 focus:border-ez-primary focus:outline-none" defaultValue={c.name} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== c.name && speichern(c, { name: e.target.value.trim() })} />
                  : <span className={c.aktiv ? '' : 'opacity-50'}>{c.name}</span>,
              },
              {
                key: 'notiz', label: 'Notiz', value: (c) => c.notiz ?? '',
                render: (c) => darfBearbeiten
                  ? <input className="w-full rounded border border-transparent px-1 py-1 text-gray-600 hover:border-gray-300 focus:border-ez-primary focus:outline-none" defaultValue={c.notiz ?? ''} onBlur={(e) => e.target.value !== (c.notiz ?? '') && speichern(c, { notiz: e.target.value })} />
                  : <span className="text-gray-600">{c.notiz ?? '—'}</span>,
              },
              {
                key: 'aktiv', label: 'Aktiv', value: (c) => (c.aktiv ? 'ja' : 'nein'), filter: 'select', align: 'right',
                render: (c) => <input type="checkbox" checked={c.aktiv} disabled={!darfBearbeiten} onChange={() => speichern(c, { aktiv: !c.aktiv })} />,
              },
              ...(darfBearbeiten ? [{
                key: 'aktion', label: '', filter: 'none' as const, sortable: false, align: 'right' as const,
                render: (c: Competitor) => <button className="text-xs text-ez-accent hover:underline" onClick={() => loeschen(c)}>Löschen</button>,
              }] : []),
            ]}
          />
        </Card>
      )}
    </div>
  );
}
