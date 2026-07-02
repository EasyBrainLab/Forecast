'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, Card, Input } from '@/components/ui';

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
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-500">
                <th className="py-2">Name</th>
                <th className="py-2">Notiz</th>
                <th className="py-2 text-center">Aktiv</th>
                {darfBearbeiten && <th className="py-2" />}
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id} className={`border-b border-gray-100 ${c.aktiv ? '' : 'opacity-50'}`}>
                  <td className="py-2 pr-2">
                    {darfBearbeiten ? (
                      <input
                        className="w-full rounded border border-transparent px-1 py-1 hover:border-gray-300 focus:border-ez-primary focus:outline-none"
                        defaultValue={c.name}
                        onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== c.name && speichern(c, { name: e.target.value.trim() })}
                      />
                    ) : (
                      c.name
                    )}
                  </td>
                  <td className="py-2 pr-2 text-gray-600">
                    {darfBearbeiten ? (
                      <input
                        className="w-full rounded border border-transparent px-1 py-1 hover:border-gray-300 focus:border-ez-primary focus:outline-none"
                        defaultValue={c.notiz ?? ''}
                        onBlur={(e) => e.target.value !== (c.notiz ?? '') && speichern(c, { notiz: e.target.value })}
                      />
                    ) : (
                      (c.notiz ?? '—')
                    )}
                  </td>
                  <td className="py-2 text-center">
                    <input type="checkbox" checked={c.aktiv} disabled={!darfBearbeiten} onChange={() => speichern(c, { aktiv: !c.aktiv })} />
                  </td>
                  {darfBearbeiten && (
                    <td className="py-2 text-right">
                      <button className="text-xs text-ez-accent hover:underline" onClick={() => loeschen(c)}>
                        Löschen
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {data.length === 0 && <p className="py-3 text-gray-500">Noch keine Wettbewerber erfasst.</p>}
        </Card>
      )}
    </div>
  );
}
