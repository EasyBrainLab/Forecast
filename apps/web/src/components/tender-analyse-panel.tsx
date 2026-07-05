'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { api, getToken } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, Card } from '@/components/ui';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

interface AnalyseZahl {
  pfad: string;
  wert: number | string;
  kontext: string;
}
interface AnalyseFrage {
  frage: string;
  antwortVorschlag: string;
  quelle: string;
}
interface AnalyseLos {
  bezeichnung: string;
  menge: number | null;
  volumenEur: number | null;
}
interface Analyse {
  referenznummer: string | null;
  auftraggeber: string | null;
  stadt: string | null;
  landIso: string | null;
  veroeffentlichtAm: string | null;
  abgabefrist: string | null;
  zusammenfassung: string;
  lose: AnalyseLos[];
  nachweise: string[];
  fragen: AnalyseFrage[];
  zahlen: AnalyseZahl[];
}
interface Dokument {
  id: string;
  status: string;
  dateiname: string;
  analyse: Analyse | null;
}
interface Region {
  code: string;
  bezeichnung: string;
  forecastRelevant: boolean;
}

function uploadDokument(file: File, regionCode: string): Promise<Dokument> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const q = regionCode ? `?regionCode=${encodeURIComponent(regionCode)}` : '';
    xhr.open('POST', `${BASE}/tender-analyse/upload${q}`);
    xhr.setRequestHeader('Authorization', `Bearer ${getToken()}`);
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error(Array.isArray(data?.message) ? data.message.join(', ') : (data?.message ?? `Fehler ${xhr.status}`)));
      } catch {
        reject(new Error(`Unerwartete Antwort (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error('Netzwerkfehler'));
    const fd = new FormData();
    fd.append('dokument', file);
    xhr.send(fd);
  });
}

/** Korrigierten Guardrail-Wert auf die Analyse anwenden (abgabefrist | veroeffentlichtAm | lose[i].feld). */
function wendeWertAn(a: Analyse, pfad: string, wert: string): Analyse {
  if (pfad === 'abgabefrist') return { ...a, abgabefrist: wert };
  if (pfad === 'veroeffentlichtAm') return { ...a, veroeffentlichtAm: wert };
  const m = /^lose\[(\d+)\]\.(menge|volumenEur)$/.exec(pfad);
  if (m) {
    const idx = Number(m[1]);
    const num = Number(String(wert).replace(',', '.'));
    if (Number.isNaN(num)) return a;
    return { ...a, lose: a.lose.map((l, i) => (i === idx ? { ...l, [m[2]]: num } : l)) };
  }
  return a;
}

export function TenderAnalysePanel({ regionen, onTenderAngelegt }: { regionen: Region[]; onTenderAngelegt: () => void }) {
  const t = useTranslations('tenderKi');
  const tc = useTranslations('common');
  const { user } = useAuth();
  const istAgm = user?.rolle === 'AGM';
  const { data: status } = useQuery({ queryKey: ['tender-ki-status'], queryFn: () => api.get<{ verfuegbar: boolean }>('/tender-analyse/status'), staleTime: 5 * 60_000 });

  const fileRef = useRef<HTMLInputElement>(null);
  const [datei, setDatei] = useState<File | null>(null);
  const [regionCode, setRegionCode] = useState('');
  const [phase, setPhase] = useState<'idle' | 'laeuft' | 'analysiert' | 'uebernehme' | 'fertig'>('idle');
  const [dok, setDok] = useState<Dokument | null>(null);
  const [analyse, setAnalyse] = useState<Analyse | null>(null);
  const [geprueft, setGeprueft] = useState<Set<string>>(new Set());
  const [fehler, setFehler] = useState('');

  if (!status) return null;
  if (!status.verfuegbar) {
    return (
      <p className="rounded border border-gray-200 bg-gray-50 p-2 text-xs text-gray-500">
        🤖 {t('nichtVerfuegbar')}{' '}
        {(user?.rolle === 'ADMIN' || user?.rolle === 'SUPPORT') && (
          <Link className="text-ez-primary underline" href="/admin/ki">
            → /admin/ki
          </Link>
        )}
      </p>
    );
  }

  const starten = async () => {
    if (!datei) return;
    const name = datei.name.toLowerCase();
    if (!name.endsWith('.pdf') && !name.endsWith('.txt')) return setFehler(t('formatFehler'));
    setFehler('');
    setPhase('laeuft');
    try {
      const up = await uploadDokument(datei, regionCode);
      const an = await api.post<Dokument>(`/tender-analyse/${up.id}/analysieren`);
      setDok(an);
      setAnalyse(an.analyse);
      setGeprueft(new Set());
      setPhase('analysiert');
    } catch (e) {
      setFehler((e as Error).message);
      setPhase('idle');
    }
  };

  const korrigieren = (pfad: string, wert: string) => {
    setAnalyse((cur) => {
      if (!cur) return cur;
      const zahlen = cur.zahlen.map((z) => (z.pfad === pfad ? { ...z, wert } : z));
      return { ...wendeWertAn(cur, pfad, wert), zahlen };
    });
  };

  const setFrage = (i: number, antwort: string) =>
    setAnalyse((cur) => (cur ? { ...cur, fragen: cur.fragen.map((f, j) => (j === i ? { ...f, antwortVorschlag: antwort } : f)) } : cur));

  const alleGeprueft = !!analyse && analyse.zahlen.every((z) => geprueft.has(z.pfad));

  const tenderAnlegen = async () => {
    if (!dok || !analyse) return;
    setFehler('');
    setPhase('uebernehme');
    try {
      await api.post(`/tender-analyse/${dok.id}/tender`, {
        referenznummer: analyse.referenznummer ?? undefined,
        krankenhaus: analyse.auftraggeber ?? undefined,
        stadt: analyse.stadt ?? undefined,
        landIso: analyse.landIso ?? undefined,
        regionCode: regionCode || undefined,
        veroeffentlichtAm: analyse.veroeffentlichtAm ?? undefined,
        abgabefrist: analyse.abgabefrist ?? undefined,
        lose: analyse.lose,
      });
      setPhase('fertig');
      onTenderAngelegt();
    } catch (e) {
      setFehler((e as Error).message);
      setPhase('analysiert');
    }
  };

  const docxLaden = async () => {
    if (!dok || !analyse) return;
    setFehler('');
    try {
      const res = await fetch(`${BASE}/tender-analyse/${dok.id}/antwort-docx`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fragen: analyse.fragen }),
      });
      if (!res.ok) throw new Error(`Fehler ${res.status}`);
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition') ?? '';
      const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? 'angebot-entwurf.docx';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setFehler((e as Error).message);
    }
  };

  const zuruecksetzen = () => {
    setDok(null);
    setAnalyse(null);
    setGeprueft(new Set());
    setDatei(null);
    setPhase('idle');
    setFehler('');
  };

  const kernFeld = (label: string, wert: string | null, onChange: (v: string) => void, type = 'text') => (
    <div>
      <label className="mb-0.5 block text-xs font-medium text-gray-600">{label}</label>
      <input type={type} className="w-full rounded border border-gray-300 px-2 py-1 text-sm" value={wert ?? ''} onChange={(e) => onChange(e.target.value)} />
    </div>
  );

  return (
    <Card className="space-y-3 border-ez-primary/40 bg-ez-primary/5">
      <div>
        <h3 className="font-semibold text-ez-primary">🤖 {t('titel')}</h3>
        {phase === 'idle' && <p className="text-xs text-gray-500">{t('beschreibung')}</p>}
      </div>

      {phase === 'idle' && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[220px] flex-1">
            <label className="mb-0.5 block text-xs font-medium text-gray-600">{t('datei')}</label>
            <input ref={fileRef} type="file" accept=".pdf,.txt" className="w-full text-sm" onChange={(e) => setDatei(e.target.files?.[0] ?? null)} />
          </div>
          <div>
            <label className="mb-0.5 block text-xs font-medium text-gray-600">
              {tc('region')} {istAgm ? '*' : ''}
            </label>
            <select className="rounded border border-gray-300 px-2 py-1.5 text-sm" value={regionCode} onChange={(e) => setRegionCode(e.target.value)}>
              <option value="">—</option>
              {regionen.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.code}
                </option>
              ))}
            </select>
          </div>
          <Button onClick={starten} disabled={!datei || (istAgm && !regionCode)}>
            {t('hochladen')}
          </Button>
        </div>
      )}
      {phase === 'laeuft' && <p className="text-sm text-gray-500">{t('laeuft')}</p>}
      {phase === 'uebernehme' && <p className="text-sm text-gray-500">{tc('laedt')}</p>}

      {phase === 'analysiert' && analyse && (
        <div className="space-y-3">
          <div>
            <h4 className="text-xs font-semibold text-gray-600">{t('zusammenfassung')}</h4>
            <p className="rounded bg-white p-2 text-sm text-gray-700">{analyse.zusammenfassung}</p>
          </div>

          <div>
            <h4 className="mb-1 text-xs font-semibold text-gray-600">{t('kerndaten')}</h4>
            <div className="grid gap-2 sm:grid-cols-3">
              {kernFeld('Referenz *', analyse.referenznummer, (v) => setAnalyse({ ...analyse, referenznummer: v }))}
              {kernFeld('Auftraggeber / Klinik *', analyse.auftraggeber, (v) => setAnalyse({ ...analyse, auftraggeber: v }))}
              {kernFeld(tc('stadt'), analyse.stadt, (v) => setAnalyse({ ...analyse, stadt: v }))}
              {kernFeld('Land (ISO)', analyse.landIso, (v) => setAnalyse({ ...analyse, landIso: v.toUpperCase() }))}
              {kernFeld('Veröffentlicht', analyse.veroeffentlichtAm, (v) => setAnalyse({ ...analyse, veroeffentlichtAm: v }), 'date')}
              {kernFeld('Abgabefrist *', analyse.abgabefrist, (v) => setAnalyse({ ...analyse, abgabefrist: v }), 'date')}
            </div>
          </div>

          {analyse.lose.length > 0 && (
            <div>
              <h4 className="mb-1 text-xs font-semibold text-gray-600">{t('lose')}</h4>
              <table className="w-full rounded bg-white text-xs">
                <thead className="text-left text-gray-500">
                  <tr>
                    <th className="p-1">{t('losBezeichnung')}</th>
                    <th className="p-1 text-right">{t('losMenge')}</th>
                    <th className="p-1 text-right">{t('losVolumen')}</th>
                  </tr>
                </thead>
                <tbody>
                  {analyse.lose.map((l, i) => (
                    <tr key={i} className="border-t border-gray-100">
                      <td className="p-1">{l.bezeichnung}</td>
                      <td className="p-1 text-right tabular-nums">{l.menge ?? '—'}</td>
                      <td className="p-1 text-right tabular-nums">{l.volumenEur?.toLocaleString('de-DE') ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="rounded border border-ez-accent/40 bg-white p-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-semibold text-ez-accent">{t('guardrailTitel')}</span>
              {analyse.zahlen.length > 0 && (
                <button className="text-xs text-ez-primary hover:underline" onClick={() => setGeprueft(new Set(analyse.zahlen.map((z) => z.pfad)))}>
                  {t('alleBestaetigen')}
                </button>
              )}
            </div>
            <p className="mb-1 text-[11px] text-gray-500">{t('guardrailText')}</p>
            {analyse.zahlen.map((z) => (
              <div key={z.pfad} className="flex flex-wrap items-center gap-2 border-t border-gray-100 py-1 text-xs">
                <span className="min-w-[200px] flex-1 italic text-gray-600">
                  {t('kontext')}: „{z.kontext}"
                </span>
                <label className="flex items-center gap-1">
                  {t('wert')}:
                  <input className="w-32 rounded border border-gray-300 px-1.5 py-0.5 text-right" value={String(z.wert)} onChange={(e) => korrigieren(z.pfad, e.target.value)} />
                </label>
                <label className="flex items-center gap-1 font-medium">
                  <input
                    type="checkbox"
                    checked={geprueft.has(z.pfad)}
                    onChange={(e) => {
                      const next = new Set(geprueft);
                      if (e.target.checked) next.add(z.pfad);
                      else next.delete(z.pfad);
                      setGeprueft(next);
                    }}
                  />
                  {t('bestaetigt')}
                </label>
              </div>
            ))}
            {!alleGeprueft && analyse.zahlen.length > 0 && (
              <p className="mt-1 text-[11px] font-medium text-ez-accent">{t('nochOffen', { anzahl: analyse.zahlen.filter((z) => !geprueft.has(z.pfad)).length })}</p>
            )}
          </div>

          {analyse.fragen.length > 0 && (
            <div>
              <h4 className="mb-1 text-xs font-semibold text-gray-600">{t('fragen')}</h4>
              <div className="space-y-2 rounded bg-white p-2">
                {analyse.fragen.map((f, i) => (
                  <div key={i} className="border-t border-gray-100 pt-1 text-xs first:border-t-0 first:pt-0">
                    <div className="font-medium text-gray-700">{f.frage}</div>
                    <textarea className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1" rows={2} placeholder="[ausfüllen]" value={f.antwortVorschlag} onChange={(e) => setFrage(i, e.target.value)} />
                    {f.quelle && (
                      <div className="text-[10px] text-gray-400">
                        {t('quelle')}: {f.quelle}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {analyse.nachweise.length > 0 && (
            <div>
              <h4 className="mb-1 text-xs font-semibold text-gray-600">{t('nachweise')}</h4>
              <ul className="rounded bg-white p-2 text-xs text-gray-700">
                {analyse.nachweise.map((nw, i) => (
                  <li key={i}>☐ {nw}</li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-[11px] text-gray-500">{t('entwurfHinweis')}</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={tenderAnlegen} disabled={!alleGeprueft}>
              {t('tenderAnlegen')}
            </Button>
            <Button variant="ghost" onClick={docxLaden} disabled={!alleGeprueft}>
              {t('antwortDocx')}
            </Button>
            <Button variant="ghost" onClick={async () => { if (dok) await api.del(`/tender-analyse/${dok.id}`).catch(() => undefined); zuruecksetzen(); }}>
              {t('verwerfen')}
            </Button>
          </div>
        </div>
      )}

      {phase === 'fertig' && (
        <div className="space-y-2">
          <p className="text-sm text-ez-ampelGruen">{t('tenderAngelegt')}</p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={docxLaden}>
              {t('antwortDocx')}
            </Button>
            <Button variant="ghost" onClick={zuruecksetzen}>
              {t('neu')}
            </Button>
          </div>
        </div>
      )}

      {fehler && <p className="rounded bg-ez-accent/10 p-1.5 text-xs text-ez-accent">{fehler}</p>}
    </Card>
  );
}
