'use client';
import { Fragment, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { api, downloadDatei } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Ampel, Button, Card, keur, prozent } from '@/components/ui';

const NEG = '#AA003C';
const POS = '#1E7B34';
const LEITUNG = ['VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN'];

interface Periode {
  periode: string;
  regionCode: string;
  status: string;
}
interface Drill {
  e1Id: string;
  e1Name: string;
  wertA: number;
  wertB: number;
  abweichungEur: number;
  abweichungProzent: number | null;
}
interface Zeile {
  landId: string;
  landName: string;
  wertA: number;
  wertB: number;
  abweichungEur: number;
  abweichungProzent: number | null;
  ampel: 'gruen' | 'rot' | 'grau';
  produktgruppen: Drill[];
}
interface Vergleich {
  periodeA: string;
  periodeB: string;
  regionCode: string;
  jahr: number;
  modus: 'YEE' | 'RESTMONATE';
  ueberlappAbMonat: number | null;
  schwellwertProzent: number;
  summe: { wertA: number; wertB: number; abweichungEur: number; abweichungProzent: number | null };
  laender: Zeile[];
}
interface Rueckfrage {
  id: string;
  landId: string | null;
  frage: string;
  frageVonName: string;
  frageAm: string;
  antwort: string | null;
  antwortVonName: string | null;
  antwortAm: string | null;
  status: 'OFFEN' | 'BEANTWORTET' | 'GESCHLOSSEN';
}
interface StatementResp {
  regionen: { regionCode: string; statement: { rueckfragen: Rueckfrage[] } | null }[];
}

const deltaFarbe = (v: number): string | undefined => (v < 0 ? NEG : v > 0 ? POS : undefined);
const mitVz = (eur: number): string => `${eur >= 0 ? '+' : ''}${keur(eur)}`;
const kurzDatum = (iso: string): string => new Date(iso).toLocaleDateString('de-DE');

export default function ForecastVergleichPage() {
  const t = useTranslations('forecastVergleich');
  const tc = useTranslations('common');
  const { user } = useAuth();
  const qc = useQueryClient();
  const istLeitung = user ? LEITUNG.includes(user.rolle) : false;
  const istAgm = user?.rolle === 'AGM';

  const { data: perioden } = useQuery({ queryKey: ['fc-meine'], queryFn: () => api.get<Periode[]>('/forecast/meine') });
  const regionen = useMemo(() => [...new Set((perioden ?? []).map((p) => p.regionCode))].sort(), [perioden]);
  const [region, setRegion] = useState<string | null>(null);
  const aktRegion = region ?? regionen[0] ?? null;
  const regPerioden = useMemo(
    () => [...new Set((perioden ?? []).filter((p) => p.regionCode === aktRegion).map((p) => p.periode))].sort().reverse(),
    [perioden, aktRegion],
  );

  const [pa, setPa] = useState<string | null>(null);
  const [pb, setPb] = useState<string | null>(null);
  const [modus, setModus] = useState<'YEE' | 'RESTMONATE'>('YEE');
  const periodeB = pb ?? regPerioden[0] ?? null;
  const periodeA = pa ?? regPerioden[1] ?? null;

  const gueltig = !!aktRegion && !!periodeA && !!periodeB && periodeA !== periodeB;
  const { data, isLoading } = useQuery({
    queryKey: ['fc-vergleich', aktRegion, periodeA, periodeB, modus],
    queryFn: () => api.get<Vergleich>(`/forecast/vergleich?periodeA=${periodeA}&periodeB=${periodeB}&regionCode=${aktRegion}&modus=${modus}`),
    enabled: gueltig,
  });

  // Rückfragen hängen am jüngeren Stand (periodeB).
  const { data: stmt } = useQuery({
    queryKey: ['fc-vergleich-rf', periodeB],
    queryFn: () => api.get<StatementResp>(`/agm-statement/periode/${periodeB}`),
    enabled: !!aktRegion && !!periodeB,
  });
  const rueckfragen = useMemo<Rueckfrage[]>(
    () => stmt?.regionen.find((r) => r.regionCode === aktRegion)?.statement?.rueckfragen ?? [],
    [stmt, aktRegion],
  );
  const invalidate = (): Promise<void> => qc.invalidateQueries({ queryKey: ['fc-vergleich-rf'] });

  const [offen, setOffen] = useState<Set<string>>(new Set());
  const toggle = (id: string): void =>
    setOffen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const [frageLand, setFrageLand] = useState<string | null>(null);
  const [frageText, setFrageText] = useState('');
  const [antwortText, setAntwortText] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const basis = `/agm-statement/periode/${periodeB}/region/${aktRegion}/rueckfrage`;
  const stelleFrage = async (landId: string): Promise<void> => {
    if (!frageText.trim() || busy) return;
    setBusy(true);
    try {
      await api.post(basis, { landId, frage: frageText });
      setFrageLand(null);
      setFrageText('');
      await invalidate();
    } finally {
      setBusy(false);
    }
  };
  const beantworte = async (id: string): Promise<void> => {
    if (!antwortText[id]?.trim() || busy) return;
    setBusy(true);
    try {
      await api.post(`${basis}/${id}/antwort`, { antwort: antwortText[id] });
      setAntwortText((s) => ({ ...s, [id]: '' }));
      await invalidate();
    } finally {
      setBusy(false);
    }
  };
  const schliesse = async (id: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await api.post(`${basis}/${id}/schliessen`);
      await invalidate();
    } finally {
      setBusy(false);
    }
  };

  const statusFarbe: Record<Rueckfrage['status'], string> = {
    OFFEN: 'bg-amber-100 text-amber-800',
    BEANTWORTET: 'bg-sky-100 text-sky-800',
    GESCHLOSSEN: 'bg-gray-100 text-gray-600',
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-ez-primary">{t('titel')}</h1>
        <p className="mt-1 text-sm text-gray-500">{t('untertitel')}</p>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-sm">
            <div className="mb-1 text-gray-500">{t('region')}</div>
            <select
              className="rounded border px-2 py-1"
              value={aktRegion ?? ''}
              onChange={(e) => {
                setRegion(e.target.value);
                setPa(null);
                setPb(null);
              }}
            >
              {regionen.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <div className="mb-1 text-gray-500">{t('standA')}</div>
            <select className="rounded border px-2 py-1" value={periodeA ?? ''} onChange={(e) => setPa(e.target.value)}>
              {regPerioden.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <div className="mb-1 text-gray-500">{t('standB')}</div>
            <select className="rounded border px-2 py-1" value={periodeB ?? ''} onChange={(e) => setPb(e.target.value)}>
              {regPerioden.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <div className="text-sm">
            <div className="mb-1 text-gray-500">{t('modus')}</div>
            <div className="flex gap-1">
              {(['YEE', 'RESTMONATE'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setModus(m)}
                  className={`rounded border px-3 py-1 ${modus === m ? 'border-ez-primary bg-ez-primary text-white' : 'bg-white'}`}
                >
                  {t(m === 'YEE' ? 'modusYee' : 'modusRest')}
                </button>
              ))}
            </div>
          </div>
        </div>
        <p className="mt-3 text-xs text-gray-500">{t(modus === 'YEE' ? 'hinweisYee' : 'hinweisRest')}</p>
      </Card>

      {aktRegion && regPerioden.length < 2 && (
        <Card>
          <p className="text-gray-600">{t('keinePerioden')}</p>
        </Card>
      )}
      {periodeA && periodeB && periodeA === periodeB && (
        <Card>
          <p className="text-gray-600">{t('gleicherStand')}</p>
        </Card>
      )}
      {isLoading && <p className="text-gray-500">{tc('laedt')}</p>}

      {data && gueltig && (
        <>
          <Card className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-wide text-gray-500">
                  {t('summe')} · {data.periodeA} → {data.periodeB}
                </div>
                <div className="mt-1 flex items-baseline gap-4">
                  <span className="text-sm text-gray-500">
                    {keur(data.summe.wertA)} → {keur(data.summe.wertB)} kEUR
                  </span>
                  <span className="text-2xl font-bold" style={{ color: deltaFarbe(data.summe.abweichungEur) }}>
                    {mitVz(data.summe.abweichungEur)} kEUR
                  </span>
                  <span className="text-sm" style={{ color: deltaFarbe(data.summe.abweichungEur) }}>
                    {prozent(data.summe.abweichungProzent)}
                  </span>
                </div>
              </div>
              <Button
                variant="ghost"
                onClick={() =>
                  downloadDatei(
                    `/export/forecast-vergleich?periodeA=${periodeA}&periodeB=${periodeB}&regionCode=${aktRegion}&modus=${modus}`,
                    'GET',
                    `forecast-vergleich-${aktRegion}-${periodeA}-${periodeB}.xlsx`,
                  )
                }
              >
                {t('kurzbericht')}
              </Button>
            </div>
          </Card>

          <Card className="p-4">
            <table className="w-full text-sm">
              <thead className="text-left text-gray-500">
                <tr>
                  <th className="w-6 py-1" />
                  <th className="py-1">{t('land')}</th>
                  <th className="py-1 text-right">{data.periodeA}</th>
                  <th className="py-1 text-right">{data.periodeB}</th>
                  <th className="py-1 text-right">Δ kEUR</th>
                  <th className="py-1 text-right">Δ %</th>
                  <th className="w-6 py-1 text-center" />
                  {istLeitung && <th className="py-1 text-right">{t('aktion')}</th>}
                </tr>
              </thead>
              <tbody>
                {data.laender.map((l) => {
                  const auf = offen.has(l.landId);
                  const spalten = istLeitung ? 8 : 7;
                  return (
                    <Fragment key={l.landId}>
                      <tr className="cursor-pointer border-t hover:bg-gray-50" onClick={() => toggle(l.landId)}>
                        <td className="py-1 text-gray-400">{l.produktgruppen.length > 1 ? (auf ? '▾' : '▸') : ''}</td>
                        <td className="py-1 font-medium">{l.landName}</td>
                        <td className="py-1 text-right text-gray-500">{keur(l.wertA)}</td>
                        <td className="py-1 text-right text-gray-500">{keur(l.wertB)}</td>
                        <td className="py-1 text-right font-semibold" style={{ color: deltaFarbe(l.abweichungEur) }}>
                          {mitVz(l.abweichungEur)}
                        </td>
                        <td className="py-1 text-right" style={{ color: deltaFarbe(l.abweichungEur) }}>
                          {prozent(l.abweichungProzent)}
                        </td>
                        <td className="py-1 text-center">
                          <Ampel farbe={l.ampel} />
                        </td>
                        {istLeitung && (
                          <td className="py-1 text-right">
                            <button
                              className="rounded border border-ez-primary px-2 py-0.5 text-xs text-ez-primary hover:bg-ez-primary hover:text-white"
                              onClick={(e) => {
                                e.stopPropagation();
                                setFrageLand(frageLand === l.landId ? null : l.landId);
                              }}
                            >
                              {t('rueckfrageStellen')}
                            </button>
                          </td>
                        )}
                      </tr>
                      {auf &&
                        l.produktgruppen.map((d) => (
                          <tr key={`${l.landId}|${d.e1Id}`} className="border-t bg-gray-50/50 text-xs text-gray-600">
                            <td />
                            <td className="py-1 pl-3">{d.e1Name}</td>
                            <td className="py-1 text-right">{keur(d.wertA)}</td>
                            <td className="py-1 text-right">{keur(d.wertB)}</td>
                            <td className="py-1 text-right" style={{ color: deltaFarbe(d.abweichungEur) }}>
                              {mitVz(d.abweichungEur)}
                            </td>
                            <td className="py-1 text-right" style={{ color: deltaFarbe(d.abweichungEur) }}>
                              {prozent(d.abweichungProzent)}
                            </td>
                            <td />
                            {istLeitung && <td />}
                          </tr>
                        ))}
                      {frageLand === l.landId && (
                        <tr className="border-t bg-ez-primary/5">
                          <td colSpan={spalten} className="p-2">
                            <div className="flex items-start gap-2">
                              <textarea
                                className="min-h-[3rem] flex-1 rounded border px-2 py-1 text-sm"
                                placeholder={t('fragePlaceholder')}
                                value={frageText}
                                onChange={(e) => setFrageText(e.target.value)}
                              />
                              <div className="flex flex-col gap-1">
                                <Button onClick={() => stelleFrage(l.landId)}>{t('senden')}</Button>
                                <Button
                                  variant="ghost"
                                  onClick={() => {
                                    setFrageLand(null);
                                    setFrageText('');
                                  }}
                                >
                                  {t('abbrechen')}
                                </Button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                <tr className="border-t-2 font-semibold">
                  <td />
                  <td className="py-1">{t('summe')}</td>
                  <td className="py-1 text-right">{keur(data.summe.wertA)}</td>
                  <td className="py-1 text-right">{keur(data.summe.wertB)}</td>
                  <td className="py-1 text-right" style={{ color: deltaFarbe(data.summe.abweichungEur) }}>
                    {mitVz(data.summe.abweichungEur)}
                  </td>
                  <td className="py-1 text-right" style={{ color: deltaFarbe(data.summe.abweichungEur) }}>
                    {prozent(data.summe.abweichungProzent)}
                  </td>
                  <td />
                  {istLeitung && <td />}
                </tr>
              </tbody>
            </table>
          </Card>

          <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold text-ez-primary">{t('rueckfragenTitel')}</h3>
            {rueckfragen.length === 0 && <p className="text-sm text-gray-500">{t('keineRueckfragen')}</p>}
            <div className="space-y-3">
              {rueckfragen.map((rf) => (
                <div key={rf.id} className="rounded border p-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    {rf.landId && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium">{rf.landId}</span>}
                    <span className={`rounded px-1.5 py-0.5 text-xs ${statusFarbe[rf.status]}`}>{t(`status${rf.status}`)}</span>
                    <span className="text-xs text-gray-400">
                      {rf.frageVonName} · {kurzDatum(rf.frageAm)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm">
                    <span className="text-gray-400">{t('frage')}: </span>
                    {rf.frage}
                  </p>
                  {rf.antwort && (
                    <p className="mt-1 border-l-2 border-ez-primary/30 pl-2 text-sm">
                      <span className="text-gray-400">
                        {t('antwort')} ({rf.antwortVonName}
                        {rf.antwortAm ? ` · ${kurzDatum(rf.antwortAm)}` : ''}):{' '}
                      </span>
                      {rf.antwort}
                    </p>
                  )}
                  {istAgm && rf.status === 'OFFEN' && (
                    <div className="mt-2 flex items-start gap-2">
                      <textarea
                        className="min-h-[2.5rem] flex-1 rounded border px-2 py-1 text-sm"
                        placeholder={t('antwortPlaceholder')}
                        value={antwortText[rf.id] ?? ''}
                        onChange={(e) => setAntwortText((s) => ({ ...s, [rf.id]: e.target.value }))}
                      />
                      <Button onClick={() => beantworte(rf.id)}>{t('beantworten')}</Button>
                    </div>
                  )}
                  {istLeitung && rf.status === 'BEANTWORTET' && (
                    <div className="mt-2">
                      <Button variant="ghost" onClick={() => schliesse(rf.id)}>
                        {t('schliessen')}
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
