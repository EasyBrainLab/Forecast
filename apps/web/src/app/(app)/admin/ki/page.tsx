'use client';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, Card, Input } from '@/components/ui';

interface KiStatus {
  anthropicKey: 'DB' | 'ENV' | 'FEHLT';
  openaiKey: 'DB' | 'ENV' | 'FEHLT';
  llmModell: string;
  sttModell: string;
  firmenprofil: string;
  modelle: string[];
}
interface TestErgebnis {
  anthropic: { ok: boolean; detail: string };
  openai: { ok: boolean; detail: string };
}

const HERKUNFT: Record<string, { label: string; cls: string }> = {
  DB: { label: 'gesetzt (im Tool)', cls: 'bg-ez-ampelGruen/15 text-ez-ampelGruen' },
  ENV: { label: 'gesetzt (Server-ENV)', cls: 'bg-ez-primary/10 text-ez-primary' },
  FEHLT: { label: 'nicht gesetzt', cls: 'bg-ez-accent/10 text-ez-accent' },
};

function KeyFeld({ label, herkunft, wert, onChange, hinweis }: { label: string; herkunft: string; wert: string; onChange: (v: string) => void; hinweis: string }) {
  const h = HERKUNFT[herkunft] ?? HERKUNFT.FEHLT;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <label className="text-sm font-medium text-gray-700">{label}</label>
        <span className={`rounded px-2 py-0.5 text-xs ${h.cls}`}>{h.label}</span>
      </div>
      <Input type="password" autoComplete="off" placeholder={herkunft === 'FEHLT' ? 'sk-…' : '•••••• (nur zum Ändern eintragen)'} value={wert} onChange={(e) => onChange(e.target.value)} />
      <p className="mt-0.5 text-xs text-gray-400">{hinweis}</p>
    </div>
  );
}

export default function KiAdminPage() {
  const { user } = useAuth();
  const darfSchreiben = user?.rolle === 'ADMIN';
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['ki-einstellungen'], queryFn: () => api.get<KiStatus>('/ki/einstellungen') });

  const [llmModell, setLlmModell] = useState('');
  const [anthropicKey, setAnthropicKey] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [firmenprofil, setFirmenprofil] = useState('');
  const [loescheAnthropic, setLoescheAnthropic] = useState(false);
  const [loescheOpenai, setLoescheOpenai] = useState(false);
  const [msg, setMsg] = useState('');
  const [fehler, setFehler] = useState('');
  const [test, setTest] = useState<TestErgebnis | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data) {
      setLlmModell(data.llmModell);
      setFirmenprofil(data.firmenprofil);
    }
  }, [data]);

  const speichern = async () => {
    setMsg('');
    setFehler('');
    setBusy(true);
    try {
      const payload: Record<string, unknown> = { llmModell, firmenprofil };
      if (anthropicKey.trim()) payload.anthropicKey = anthropicKey.trim();
      else if (loescheAnthropic) payload.anthropicKey = '';
      if (openaiKey.trim()) payload.openaiKey = openaiKey.trim();
      else if (loescheOpenai) payload.openaiKey = '';
      await api.put('/ki/einstellungen', payload);
      setAnthropicKey('');
      setOpenaiKey('');
      setLoescheAnthropic(false);
      setLoescheOpenai(false);
      setMsg('Gespeichert. Keys werden verschlüsselt abgelegt und nie wieder angezeigt.');
      qc.invalidateQueries({ queryKey: ['ki-einstellungen'] });
      qc.invalidateQueries({ queryKey: ['voice-status'] });
    } catch (e) {
      setFehler(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  const testen = async () => {
    setFehler('');
    setTest(null);
    setBusy(true);
    try {
      setTest(await api.post<TestErgebnis>('/ki/test'));
    } catch (e) {
      setFehler(e instanceof ApiError ? e.message : 'Test fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <p className="text-gray-500">Lädt…</p>;

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-ez-primary">KI & Ausschreibungen — Einstellungen</h1>
        <p className="text-sm text-gray-500">
          Modell und API-Keys für Diktat und Ausschreibungs-Analyse. Keys werden mit dem Server-Schlüssel verschlüsselt gespeichert (nie im Klartext, nie wieder anzeigbar) und haben Vorrang vor der Server-ENV.
        </p>
      </div>

      <Card className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">LLM-Modell (Analyse & Extraktion)</label>
          <div className="flex gap-2">
            <select className="rounded border border-gray-300 px-3 py-2 text-sm" value={data.modelle.includes(llmModell) ? llmModell : '__custom__'} onChange={(e) => e.target.value !== '__custom__' && setLlmModell(e.target.value)} disabled={!darfSchreiben}>
              {data.modelle.map((m) => (
                <option key={m} value={m}>
                  {m}
                  {m === 'claude-opus-4-8' ? ' (Standard)' : ''}
                </option>
              ))}
              <option value="__custom__">Eigenes Modell…</option>
            </select>
            <Input className="flex-1" value={llmModell} onChange={(e) => setLlmModell(e.target.value)} disabled={!darfSchreiben} />
          </div>
        </div>

        <KeyFeld label="Anthropic API-Key (Claude — Analyse/Extraktion)" herkunft={data.anthropicKey} wert={anthropicKey} onChange={setAnthropicKey} hinweis="console.anthropic.com → API Keys. AVV/EU-Hosting gemäß Datenschutz-Entscheidung." />
        {darfSchreiben && data.anthropicKey === 'DB' && (
          <label className="flex items-center gap-2 text-xs text-gray-500">
            <input type="checkbox" checked={loescheAnthropic} onChange={(e) => setLoescheAnthropic(e.target.checked)} /> Im Tool gespeicherten Anthropic-Key löschen (ENV-Fallback greift wieder)
          </label>
        )}

        <KeyFeld label="OpenAI API-Key (Whisper — Spracherkennung fürs Diktat)" herkunft={data.openaiKey} wert={openaiKey} onChange={setOpenaiKey} hinweis="platform.openai.com → API Keys. Nur für Speech-to-Text genutzt." />
        {darfSchreiben && data.openaiKey === 'DB' && (
          <label className="flex items-center gap-2 text-xs text-gray-500">
            <input type="checkbox" checked={loescheOpenai} onChange={(e) => setLoescheOpenai(e.target.checked)} /> Im Tool gespeicherten OpenAI-Key löschen (ENV-Fallback greift wieder)
          </label>
        )}

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Firmenprofil (Bieter-Angaben im Ausschreibungs-Antwortentwurf)</label>
          <textarea className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-ez-primary focus:outline-none" rows={4} value={firmenprofil} onChange={(e) => setFirmenprofil(e.target.value)} disabled={!darfSchreiben} />
        </div>

        {fehler && <p className="rounded bg-ez-accent/10 p-2 text-sm text-ez-accent">{fehler}</p>}
        {msg && <p className="text-sm text-ez-ampelGruen">{msg}</p>}

        {darfSchreiben && (
          <div className="flex gap-2">
            <Button onClick={speichern} disabled={busy}>
              {busy ? 'Speichert…' : 'Speichern'}
            </Button>
            <Button variant="ghost" onClick={testen} disabled={busy}>
              Verbindung testen
            </Button>
          </div>
        )}

        {test && (
          <div className="space-y-1 rounded border border-gray-200 p-2 text-sm">
            <p className={test.anthropic.ok ? 'text-ez-ampelGruen' : 'text-ez-accent'}>
              {test.anthropic.ok ? '✓' : '✗'} Anthropic: {test.anthropic.detail}
            </p>
            <p className={test.openai.ok ? 'text-ez-ampelGruen' : 'text-ez-accent'}>
              {test.openai.ok ? '✓' : '✗'} OpenAI (Whisper): {test.openai.detail}
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
