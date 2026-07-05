'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, Card } from '@/components/ui';

const GRUND_LABEL: Record<string, string> = {
  UNBEKANNTE_KOSTENSTELLE: 'Unbekannte Kostenstelle',
  LAND_LEER: 'Land fehlt',
  UNBEKANNTES_LAND: 'Unbekanntes Land',
  UNBEKANNTER_LANDNAME: 'Unbekannter Landname',
  UNBEKANNTE_E1: 'Unbekannte Produktgruppe E1',
  UNBEKANNTE_E2: 'Unbekannte Produktgruppe E2',
  WERT_LEER: 'Wert fehlt',
  VORZEICHEN_INKONSISTENT: 'Vorzeichen inkonsistent',
  UNBEKANNTER_MONAT: 'Unbekannter Monat',
  RECID_DUP_IN_DATEI: 'RECID doppelt in Datei',
  COMPANY_UNBEKANNT: 'Unbekannte Company',
};

interface Eintrag {
  id: string;
  zeilenNummer: number;
  recid: string | null;
  rohdaten: Record<string, unknown>;
  grund: string;
  detail: string | null;
  status: string;
  klaerKommentar: string | null;
  geklaertAm: string | null;
  erstelltAm: string;
  importBatch: { dateiname: string; typ: string; erstelltAm: string };
}
interface Resp {
  offenGesamt: number;
  eintraege: Eintrag[];
}

function EintragZeile({ e, darfBearbeiten, onAktion }: { e: Eintrag; darfBearbeiten: boolean; onAktion: (id: string, aktion: 'klaeren' | 'verwerfen', kommentar: string) => void }) {
  const [offen, setOffen] = useState(false);
  const [kommentar, setKommentar] = useState('');
  return (
    <div className="border-b border-gray-100 py-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-[260px] flex-1">
          <span className="font-medium text-gray-800">{GRUND_LABEL[e.grund] ?? e.grund}</span>
          {e.detail && <span className="text-gray-500"> — {e.detail}</span>}
          <div className="text-xs text-gray-500">
            {e.importBatch.dateiname} · Zeile {e.zeilenNummer}
            {e.recid ? ` · RECID ${e.recid}` : ''} · {new Date(e.erstelltAm).toLocaleDateString('de-DE')}
          </div>
          {e.status !== 'OFFEN' && (
            <div className="text-xs text-gray-500">
              {e.status === 'GEKLAERT' ? '✓ geklärt' : '✗ verworfen'}
              {e.geklaertAm ? ` am ${new Date(e.geklaertAm).toLocaleDateString('de-DE')}` : ''}
              {e.klaerKommentar ? ` — ${e.klaerKommentar}` : ''}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button className="text-xs text-ez-primary hover:underline" onClick={() => setOffen(!offen)}>
            {offen ? 'Rohdaten ausblenden' : 'Rohdaten anzeigen'}
          </button>
          {darfBearbeiten && e.status === 'OFFEN' && (
            <>
              <input
                className="w-44 rounded border border-gray-300 px-2 py-1 text-xs"
                placeholder="Kommentar (optional)"
                value={kommentar}
                onChange={(ev) => setKommentar(ev.target.value)}
              />
              <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => onAktion(e.id, 'klaeren', kommentar)}>
                Geklärt
              </Button>
              <Button variant="ghost" className="px-2 py-1 text-xs text-ez-accent" onClick={() => onAktion(e.id, 'verwerfen', kommentar)}>
                Verwerfen
              </Button>
            </>
          )}
        </div>
      </div>
      {offen && (
        <pre className="mt-2 max-h-56 overflow-auto rounded bg-gray-50 p-2 text-xs text-gray-700">{JSON.stringify(e.rohdaten, null, 2)}</pre>
      )}
    </div>
  );
}

export default function QuarantaenePage() {
  const { user } = useAuth();
  const darfBearbeiten = user?.rolle === 'ADMIN' || user?.rolle === 'BU_LEITER';
  const qc = useQueryClient();
  const [status, setStatus] = useState('OFFEN');
  const [fehler, setFehler] = useState('');
  const { data, isLoading } = useQuery({ queryKey: ['quarantaene', status], queryFn: () => api.get<Resp>(`/ist-import/quarantaene?status=${status}`) });

  const aktion = async (id: string, art: 'klaeren' | 'verwerfen', kommentar: string) => {
    setFehler('');
    try {
      await api.post(`/ist-import/quarantaene/${id}/${art}`, { kommentar: kommentar || undefined });
      qc.invalidateQueries({ queryKey: ['quarantaene'] });
    } catch (e) {
      setFehler(e instanceof ApiError ? e.message : 'Fehler.');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ez-primary">Import-Quarantäne</h1>
          <p className="text-sm text-gray-500">
            Zeilen aus dem Ist-Import, die nicht automatisch zugeordnet werden konnten. Klären = in der Quelle korrigiert und neu importiert (RECID-Upsert heilt die Zeile) oder anderweitig erledigt. Verwerfen = Zeile gehört nicht in die Daten.
          </p>
        </div>
        <select className="rounded border border-gray-300 px-2 py-1 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="OFFEN">Offen</option>
          <option value="GEKLAERT">Geklärt</option>
          <option value="VERWORFEN">Verworfen</option>
        </select>
      </div>

      {fehler && <p className="rounded bg-ez-accent/10 p-2 text-sm text-ez-accent">{fehler}</p>}

      <Card>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ez-primary">
            {status === 'OFFEN' ? 'Offene Einträge' : status === 'GEKLAERT' ? 'Geklärte Einträge' : 'Verworfene Einträge'} ({data?.eintraege.length ?? 0})
          </h2>
          {data && data.offenGesamt > 0 && status !== 'OFFEN' && <span className="text-xs text-ez-accent">{data.offenGesamt} offen</span>}
        </div>
        {isLoading && <p className="text-sm text-gray-500">Lädt…</p>}
        {data && data.eintraege.length === 0 && (
          <p className="text-sm text-ez-ampelGruen">{status === 'OFFEN' ? '✓ Keine offenen Quarantäne-Einträge — alle Importzeilen sind zugeordnet.' : 'Keine Einträge.'}</p>
        )}
        {data?.eintraege.map((e) => (
          <EintragZeile key={e.id} e={e} darfBearbeiten={darfBearbeiten} onAktion={aktion} />
        ))}
      </Card>
    </div>
  );
}
