'use client';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { api, getToken } from '@/lib/api';
import { Button } from '@/components/ui';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

interface GuardrailZahl {
  pfad: string;
  wert: number;
  kontext: string;
}
interface ExtraktionsEintrag {
  abschnitt: string;
  typ: string | null;
  beschreibung: string;
  ergebnis: string | null;
  datum: string | null;
  kundeName: string | null;
  wettbewerberName: string | null;
  customerSiteId: string | null;
  customerSiteMatchName: string | null;
  competitorId: string | null;
  landIso: string | null;
  stadt: string | null;
  menge: number | null;
  kostenEur: number | null;
  erwarteterUmsatzEur: number | null;
  wahrscheinlichkeit: number | null;
  preisInfo: string | null;
}
interface Extraktion {
  kopf: {
    forecastFolgemonatEur: number | null;
    forecastQuartalEur: number | null;
    wettbewerbKeineAenderung: boolean | null;
    marktAllgemein: string | null;
    personal: string | null;
    sonstiges: string | null;
  };
  eintraege: ExtraktionsEintrag[];
  zahlen: GuardrailZahl[];
}
interface VoiceSession {
  id: string;
  status: string;
  transkript: string;
  sprache: string | null;
  extraktion: Extraktion | null;
}
interface VoiceStatus {
  verfuegbar: boolean;
  sprachen: string[];
}

/** Wendet einen korrigierten Guardrail-Wert auf die Extraktion an (pfad: kopf.x | eintraege[i].feld). */
function wendeWertAn(e: Extraktion, pfad: string, wert: number): Extraktion {
  const kopfMatch = /^kopf\.(\w+)$/.exec(pfad);
  if (kopfMatch) return { ...e, kopf: { ...e.kopf, [kopfMatch[1]]: wert } };
  const eintragMatch = /^eintraege\[(\d+)\]\.(\w+)$/.exec(pfad);
  if (eintragMatch) {
    const idx = Number(eintragMatch[1]);
    return { ...e, eintraege: e.eintraege.map((it, i) => (i === idx ? { ...it, [eintragMatch[2]]: wert } : it)) };
  }
  return e;
}

function uploadAudio(blob: Blob, mimeType: string, periode: string, regionCode: string, sprache: string): Promise<VoiceSession> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const q = new URLSearchParams({ periode, regionCode, ...(sprache ? { sprache } : {}) });
    xhr.open('POST', `${BASE}/voice/upload?${q.toString()}`);
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
    xhr.onerror = () => reject(new Error('Netzwerkfehler beim Upload'));
    const fd = new FormData();
    fd.append('audio', blob, `diktat.${mimeType.includes('mp4') ? 'm4a' : 'webm'}`);
    xhr.send(fd);
  });
}

export function VoicePanel({ periode, regionCode, onUebernommen }: { periode: string; regionCode: string; onUebernommen: () => void }) {
  const t = useTranslations('voice');
  const qc = useQueryClient();
  const { data: status } = useQuery({ queryKey: ['voice-status'], queryFn: () => api.get<VoiceStatus>('/voice/status'), staleTime: 5 * 60_000 });

  const [phase, setPhase] = useState<'idle' | 'recording' | 'uploading' | 'transkribiert' | 'extrahiert' | 'uebernehme' | 'fertig'>('idle');
  const [sprache, setSprache] = useState('');
  const [sekunden, setSekunden] = useState(0);
  const [fehler, setFehler] = useState('');
  const [session, setSession] = useState<VoiceSession | null>(null);
  const [extraktion, setExtraktion] = useState<Extraktion | null>(null);
  const [geprueft, setGeprueft] = useState<Set<string>>(new Set());
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    recorderRef.current?.stream.getTracks().forEach((tr) => tr.stop());
  }, []);

  if (!status) return null;
  if (!status.verfuegbar) {
    return <p className="rounded border border-gray-200 bg-gray-50 p-2 text-xs text-gray-500">🎙 {t('nichtVerfuegbar')}</p>;
  }

  const mimeKandidaten = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  const mimeType = typeof MediaRecorder !== 'undefined' ? (mimeKandidaten.find((m) => MediaRecorder.isTypeSupported(m)) ?? '') : '';

  const starten = async () => {
    setFehler('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (ev) => ev.data.size > 0 && chunksRef.current.push(ev.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((tr) => tr.stop());
        setPhase('uploading');
        try {
          const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
          const s = await uploadAudio(blob, rec.mimeType || 'audio/webm', periode, regionCode, sprache);
          setSession(s);
          setPhase('transkribiert');
        } catch (e) {
          setFehler((e as Error).message);
          setPhase('idle');
        }
      };
      rec.start();
      recorderRef.current = rec;
      setSekunden(0);
      timerRef.current = setInterval(() => setSekunden((sek) => sek + 1), 1000);
      setPhase('recording');
    } catch {
      setFehler(t('mikrofonFehler'));
    }
  };

  const stoppen = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    recorderRef.current?.stop();
  };

  const extrahieren = async () => {
    if (!session) return;
    setFehler('');
    setPhase('uebernehme');
    try {
      const s = await api.post<VoiceSession>(`/voice/${session.id}/extrahieren`);
      setSession(s);
      setExtraktion(s.extraktion);
      setGeprueft(new Set());
      setPhase('extrahiert');
    } catch (e) {
      setFehler((e as Error).message);
      setPhase('transkribiert');
    }
  };

  const korrigieren = (pfad: string, wertStr: string) => {
    if (!extraktion) return;
    const wert = Number(wertStr.replace(',', '.'));
    if (Number.isNaN(wert)) return;
    setExtraktion((cur) => {
      if (!cur) return cur;
      const zahlen = cur.zahlen.map((z) => (z.pfad === pfad ? { ...z, wert } : z));
      return { ...wendeWertAn(cur, pfad, wert), zahlen };
    });
  };

  const alleGeprueft = !!extraktion && extraktion.zahlen.every((z) => geprueft.has(z.pfad));

  const uebernehmen = async () => {
    if (!session || !extraktion) return;
    setFehler('');
    setPhase('uebernehme');
    try {
      // Kopf-Felder (nur gesetzte Werte — Whitelist-PATCH serverseitig)
      const kopf: Record<string, unknown> = {};
      if (extraktion.kopf.forecastFolgemonatEur != null) kopf.forecastFolgemonatEur = extraktion.kopf.forecastFolgemonatEur;
      if (extraktion.kopf.forecastQuartalEur != null) kopf.forecastQuartalEur = extraktion.kopf.forecastQuartalEur;
      if (extraktion.kopf.wettbewerbKeineAenderung != null) kopf.wettbewerbKeineAenderung = extraktion.kopf.wettbewerbKeineAenderung;
      if (extraktion.kopf.marktAllgemein) kopf.marktAllgemein = extraktion.kopf.marktAllgemein;
      if (extraktion.kopf.personal) kopf.personal = extraktion.kopf.personal;
      if (extraktion.kopf.sonstiges) kopf.sonstiges = extraktion.kopf.sonstiges;
      if (Object.keys(kopf).length) await api.put(`/report/periode/${periode}/region/${regionCode}`, kopf);
      // Einträge anlegen (Wettbewerbs-Einträge ohne Stammlisten-Treffer würden serverseitig abgelehnt -> Hinweis in beschreibung)
      for (const it of extraktion.eintraege) {
        const payload: Record<string, unknown> = {
          abschnitt: it.abschnitt,
          typ: it.typ ?? undefined,
          beschreibung: it.wettbewerberName && !it.competitorId ? `[${it.wettbewerberName}] ${it.beschreibung}` : it.beschreibung,
          ergebnis: it.ergebnis ?? undefined,
          datum: it.datum ?? undefined,
          customerSiteId: it.customerSiteId ?? undefined,
          competitorId: it.competitorId ?? undefined,
          landIso: it.landIso ?? undefined,
          stadt: it.stadt ?? undefined,
          menge: it.menge ?? undefined,
          kostenEur: it.kostenEur ?? undefined,
          erwarteterUmsatzEur: it.erwarteterUmsatzEur ?? undefined,
          wahrscheinlichkeit: it.wahrscheinlichkeit ?? undefined,
          preisInfo: it.preisInfo ?? undefined,
        };
        if (it.abschnitt === 'WETTBEWERB' && !it.competitorId) payload.abschnitt = 'KRITISCH'; // Fallback statt Serverfehler
        await api.post(`/report/periode/${periode}/region/${regionCode}/eintraege`, payload);
      }
      await api.post(`/voice/${session.id}/bestaetigen`);
      setPhase('fertig');
      qc.invalidateQueries({ queryKey: ['report', periode] });
      onUebernommen();
    } catch (e) {
      setFehler((e as Error).message);
      setPhase('extrahiert');
    }
  };

  const verwerfen = async () => {
    if (session) await api.del(`/voice/${session.id}`).catch(() => undefined);
    setSession(null);
    setExtraktion(null);
    setGeprueft(new Set());
    setPhase('idle');
    setFehler('');
  };

  return (
    <div className="space-y-2 rounded border border-ez-primary/30 bg-ez-primary/5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-ez-primary">🎙 {t('titel')}</h4>
        {phase === 'idle' && (
          <div className="flex items-center gap-2">
            <select className="rounded border border-gray-300 px-2 py-1 text-xs" value={sprache} onChange={(e) => setSprache(e.target.value)}>
              <option value="">{t('spracheAuto')}</option>
              {status.sprachen.map((s) => (
                <option key={s} value={s}>
                  {s.toUpperCase()}
                </option>
              ))}
            </select>
            <Button className="px-3 py-1 text-xs" onClick={starten}>
              {t('aufnehmen')}
            </Button>
          </div>
        )}
      </div>
      {phase === 'idle' && <p className="text-xs text-gray-500">{t('beschreibung')}</p>}

      {phase === 'recording' && (
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-2 text-sm text-ez-accent">
            <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-ez-accent" />
            {t('nimmtAuf', { sekunden })}
          </span>
          <Button variant="danger" className="px-3 py-1 text-xs" onClick={stoppen}>
            {t('stoppen')}
          </Button>
        </div>
      )}
      {phase === 'uploading' && <p className="text-sm text-gray-500">{t('verarbeite')}</p>}

      {(phase === 'transkribiert' || phase === 'extrahiert') && session && (
        <div className="space-y-2">
          <div>
            <div className="mb-0.5 text-xs font-medium text-gray-600">
              {t('transkript')}
              {session.sprache ? ` · ${session.sprache.toUpperCase()}` : ''}
            </div>
            <p className="max-h-32 overflow-y-auto rounded bg-white p-2 text-xs text-gray-700">{session.transkript}</p>
          </div>
          {phase === 'transkribiert' && (
            <div className="flex gap-2">
              <Button className="px-3 py-1 text-xs" onClick={extrahieren}>
                {t('extrahieren')}
              </Button>
              <Button variant="ghost" className="px-3 py-1 text-xs" onClick={verwerfen}>
                {t('verwerfen')}
              </Button>
            </div>
          )}
        </div>
      )}
      {phase === 'uebernehme' && <p className="text-sm text-gray-500">{extraktion ? t('uebernimmt') : t('extrahiert')}</p>}

      {phase === 'extrahiert' && extraktion && (
        <div className="space-y-2">
          <p className="text-xs text-gray-600">
            {t('eintraegeVorschau', { anzahl: extraktion.eintraege.length, kopf: Object.values(extraktion.kopf).filter((v) => v != null && v !== '').length })}
          </p>
          <div className="rounded border border-ez-accent/40 bg-white p-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-semibold text-ez-accent">{t('guardrailTitel')}</span>
              {extraktion.zahlen.length > 0 && (
                <button className="text-xs text-ez-primary hover:underline" onClick={() => setGeprueft(new Set(extraktion.zahlen.map((z) => z.pfad)))}>
                  {t('alleBestaetigen')}
                </button>
              )}
            </div>
            <p className="mb-2 text-[11px] text-gray-500">{t('guardrailText')}</p>
            {extraktion.zahlen.length === 0 && <p className="text-xs text-gray-400">{t('keineZahlen')}</p>}
            <div className="space-y-1">
              {extraktion.zahlen.map((z) => (
                <div key={z.pfad} className="flex flex-wrap items-center gap-2 border-t border-gray-100 py-1 text-xs">
                  <span className="min-w-[180px] flex-1 italic text-gray-600">
                    {t('kontext')}: „{z.kontext}"
                  </span>
                  <label className="flex items-center gap-1">
                    {t('wert')}:
                    <input
                      className="w-28 rounded border border-gray-300 px-1.5 py-0.5 text-right tabular-nums"
                      defaultValue={z.wert}
                      onChange={(e) => korrigieren(z.pfad, e.target.value)}
                    />
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
            </div>
            {!alleGeprueft && extraktion.zahlen.length > 0 && (
              <p className="mt-1 text-[11px] font-medium text-ez-accent">{t('nochOffen', { anzahl: extraktion.zahlen.filter((z) => !geprueft.has(z.pfad)).length })}</p>
            )}
          </div>
          <div className="flex gap-2">
            <Button className="px-3 py-1 text-xs" disabled={!alleGeprueft} onClick={uebernehmen}>
              {t('uebernehmen')}
            </Button>
            <Button variant="ghost" className="px-3 py-1 text-xs" onClick={verwerfen}>
              {t('verwerfen')}
            </Button>
          </div>
        </div>
      )}

      {phase === 'fertig' && (
        <div className="space-y-1">
          <p className="text-sm text-ez-ampelGruen">{t('uebernommen')}</p>
          <Button variant="ghost" className="px-3 py-1 text-xs" onClick={verwerfen}>
            {t('neuesDiktat')}
          </Button>
        </div>
      )}

      {fehler && <p className="rounded bg-ez-accent/10 p-1.5 text-xs text-ez-accent">{fehler}</p>}
    </div>
  );
}
