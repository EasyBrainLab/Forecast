'use client';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { Button, Card } from '@/components/ui';

const GRUND_LABEL: Record<string, string> = {
  KEINE_ABWEICHUNG: 'Keine wesentliche Abweichung',
  MARKT: 'Marktentwicklung',
  WETTBEWERB: 'Wettbewerb',
  PREIS: 'Preis / Konditionen',
  PROJEKTVERSCHIEBUNG: 'Projekt-/Lieferverschiebung',
  REGULATORISCH: 'Regulatorik / Zulassung',
  LIEFERFAEHIGKEIT: 'Lieferfähigkeit / Produktion',
  EINMALEFFEKT: 'Einmaleffekt',
  SONSTIGES: 'Sonstiges',
};
const MON = ['', 'Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

interface ActionItem {
  beschreibung: string;
  faelligBis: string | null;
  erledigt: boolean;
}
interface Statement {
  abweichungGrund: string;
  abweichungKommentar: string | null;
  risiken: string | null;
  chancen: string | null;
  pipeline: string | null;
  kundenGewonnen: string | null;
  kundenVerloren: string | null;
  preisWettbewerb: string | null;
  forecastRealistisch: boolean;
  forecastKommentar: string | null;
  actionItems: ActionItem[];
  status: string;
  userName?: string;
  eingereichtAm?: string | null;
}
interface RegionStatement {
  regionCode: string;
  bezeichnung: string;
  status: string;
  statement: Statement | null;
}
interface PeriodeData {
  periode: string;
  bearbeitbar: boolean;
  regionen: RegionStatement[];
}

const leer = (): Statement => ({
  abweichungGrund: 'KEINE_ABWEICHUNG',
  abweichungKommentar: '',
  risiken: '',
  chancen: '',
  pipeline: '',
  kundenGewonnen: '',
  kundenVerloren: '',
  preisWettbewerb: '',
  forecastRealistisch: true,
  forecastKommentar: '',
  actionItems: [],
  status: 'OFFEN',
});

function Feld({ label, value, onChange, readOnly, rows = 2 }: { label: string; value: string; onChange: (v: string) => void; readOnly: boolean; rows?: number }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">{label}</label>
      <textarea
        className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-ez-primary focus:outline-none disabled:bg-gray-50 disabled:text-gray-600"
        rows={rows}
        value={value}
        disabled={readOnly}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function StatementForm({ periode, rs, bearbeitbar }: { periode: string; rs: RegionStatement; bearbeitbar: boolean }) {
  const qc = useQueryClient();
  const [s, setS] = useState<Statement>(rs.statement ?? leer());
  const [fehler, setFehler] = useState('');
  const [msg, setMsg] = useState('');
  const eingereicht = rs.status === 'EINGEREICHT';
  const readOnly = !bearbeitbar || eingereicht;

  useEffect(() => {
    setS(rs.statement ?? leer());
  }, [rs.statement, rs.regionCode]);

  const upd = (patch: Partial<Statement>) => setS((cur) => ({ ...cur, ...patch }));
  const reload = () => qc.invalidateQueries({ queryKey: ['statement', periode] });

  const speichern = async () => {
    setFehler('');
    setMsg('');
    try {
      await api.put(`/agm-statement/periode/${periode}/region/${rs.regionCode}`, s);
      setMsg('Entwurf gespeichert.');
      reload();
    } catch (e) {
      setFehler(e instanceof ApiError ? e.message : 'Fehler.');
    }
  };
  const einreichen = async () => {
    setFehler('');
    setMsg('');
    try {
      await api.put(`/agm-statement/periode/${periode}/region/${rs.regionCode}`, s);
      await api.post(`/agm-statement/periode/${periode}/region/${rs.regionCode}/einreichen`);
      reload();
    } catch (e) {
      setFehler(e instanceof ApiError ? e.message : 'Fehler.');
    }
  };
  const zuruecksetzen = async () => {
    await api.post(`/agm-statement/periode/${periode}/region/${rs.regionCode}/zuruecksetzen`);
    reload();
  };

  const ai = s.actionItems ?? [];
  const setAi = (next: ActionItem[]) => upd({ actionItems: next });

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-ez-primary">
          {rs.regionCode} · {rs.bezeichnung}
        </h3>
        <span className={`rounded px-2 py-0.5 text-xs ${eingereicht ? 'bg-ez-ampelGruen/15 text-ez-ampelGruen' : 'bg-gray-100 text-gray-600'}`}>
          {eingereicht ? `eingereicht${rs.statement?.userName ? ` · ${rs.statement.userName}` : ''}` : rs.status === 'OFFEN' ? 'offen' : 'Entwurf'}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Hauptgrund der Abweichung zum Budget</label>
          <select
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50"
            value={s.abweichungGrund}
            disabled={readOnly}
            onChange={(e) => upd({ abweichungGrund: e.target.value })}
          >
            {Object.entries(GRUND_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <Feld label="Kommentar zum Abweichungsgrund (Pflicht bei Abweichung)" value={s.abweichungKommentar ?? ''} onChange={(v) => upd({ abweichungKommentar: v })} readOnly={readOnly} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Feld label="Risiken (was kann den Forecast gefährden?)" value={s.risiken ?? ''} onChange={(v) => upd({ risiken: v })} readOnly={readOnly} />
        <Feld label="Chancen (Upside-Potenzial)" value={s.chancen ?? ''} onChange={(v) => upd({ chancen: v })} readOnly={readOnly} />
      </div>
      <Feld label="Pipeline / wichtige laufende Deals" value={s.pipeline ?? ''} onChange={(v) => upd({ pipeline: v })} readOnly={readOnly} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Feld label="Neu gewonnene Kunden" value={s.kundenGewonnen ?? ''} onChange={(v) => upd({ kundenGewonnen: v })} readOnly={readOnly} />
        <Feld label="Verlorene Kunden" value={s.kundenVerloren ?? ''} onChange={(v) => upd({ kundenVerloren: v })} readOnly={readOnly} />
      </div>
      <Feld label="Preis- / Wettbewerbssituation" value={s.preisWettbewerb ?? ''} onChange={(v) => upd({ preisWettbewerb: v })} readOnly={readOnly} />

      <div className="rounded border border-gray-200 p-3">
        <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
          <input type="checkbox" checked={s.forecastRealistisch} disabled={readOnly} onChange={(e) => upd({ forecastRealistisch: e.target.checked })} />
          Ich halte den aktuellen Forecast für realistisch
        </label>
        {!s.forecastRealistisch && (
          <div className="mt-2">
            <Feld label="Begründung (Pflicht, wenn nicht realistisch)" value={s.forecastKommentar ?? ''} onChange={(v) => upd({ forecastKommentar: v })} readOnly={readOnly} />
          </div>
        )}
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">Maßnahmen / Action-Items</span>
          {!readOnly && (
            <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setAi([...ai, { beschreibung: '', faelligBis: null, erledigt: false }])}>
              + Maßnahme
            </Button>
          )}
        </div>
        {ai.length === 0 && <p className="text-xs text-gray-400">Keine Maßnahmen erfasst.</p>}
        <div className="space-y-2">
          {ai.map((it, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <input
                type="checkbox"
                checked={it.erledigt}
                disabled={readOnly}
                onChange={(e) => setAi(ai.map((x, j) => (j === i ? { ...x, erledigt: e.target.checked } : x)))}
              />
              <input
                className="min-w-[200px] flex-1 rounded border border-gray-300 px-2 py-1 text-sm disabled:bg-gray-50"
                placeholder="Beschreibung"
                value={it.beschreibung}
                disabled={readOnly}
                onChange={(e) => setAi(ai.map((x, j) => (j === i ? { ...x, beschreibung: e.target.value } : x)))}
              />
              <input
                type="date"
                className="rounded border border-gray-300 px-2 py-1 text-sm disabled:bg-gray-50"
                value={it.faelligBis ?? ''}
                disabled={readOnly}
                onChange={(e) => setAi(ai.map((x, j) => (j === i ? { ...x, faelligBis: e.target.value || null } : x)))}
              />
              {!readOnly && (
                <button className="text-xs text-ez-accent" onClick={() => setAi(ai.filter((_, j) => j !== i))}>
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {fehler && <p className="rounded bg-ez-accent/10 p-2 text-sm text-ez-accent">{fehler}</p>}
      {msg && <p className="text-sm text-ez-ampelGruen">{msg}</p>}

      {bearbeitbar && (
        <div className="flex gap-2">
          {!eingereicht ? (
            <>
              <Button variant="ghost" onClick={speichern}>
                Entwurf speichern
              </Button>
              <Button onClick={einreichen}>Speichern & einreichen</Button>
            </>
          ) : (
            <Button variant="ghost" onClick={zuruecksetzen}>
              Wieder öffnen
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

export default function StatementPage() {
  const heute = new Date();
  const [jahr, setJahr] = useState(heute.getUTCFullYear());
  const [monat, setMonat] = useState(heute.getUTCMonth() + 1);
  const periode = `${jahr}-${String(monat).padStart(2, '0')}`;
  const { data, isLoading } = useQuery({ queryKey: ['statement', periode], queryFn: () => api.get<PeriodeData>(`/agm-statement/periode/${periode}`) });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ez-primary">Vertriebs-Statement</h1>
          <p className="text-sm text-gray-500">
            Strukturierte Einschätzung zum Forecast je Region. {data?.bearbeitbar ? 'Bitte ausfüllen und einreichen.' : 'Überblick über die eingereichten Statements.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select className="rounded border border-gray-300 px-2 py-1 text-sm" value={monat} onChange={(e) => setMonat(Number(e.target.value))}>
            {MON.slice(1).map((m, i) => (
              <option key={i + 1} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
          <select className="rounded border border-gray-300 px-2 py-1 text-sm" value={jahr} onChange={(e) => setJahr(Number(e.target.value))}>
            {[2025, 2026, 2027].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </div>

      {isLoading && <p className="text-gray-500">Lädt…</p>}
      {data && data.regionen.length === 0 && (
        <Card>
          <p className="text-gray-600">Keine Region zugeordnet. Bitte wenden Sie sich an die Administration.</p>
        </Card>
      )}
      {data?.regionen.map((rs) => (
        <StatementForm key={rs.regionCode} periode={periode} rs={rs} bearbeitbar={data.bearbeitbar} />
      ))}
    </div>
  );
}
