'use client';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { api, ApiError } from '@/lib/api';
import { Button, Card } from '@/components/ui';
import { monKurz } from '@/lib/monate';
import { VoicePanel } from '@/components/voice-panel';

const KRITISCH_TYPEN = ['TENDER', 'KUNDENVERLUST', 'NEUKUNDE', 'PRODUKTPROBLEM', 'LIEFERPROBLEM', 'SONSTIGES'];
const AKTIVITAET_TYPEN = ['BESUCH', 'TRAINING', 'MEETING', 'SUPPORT'];
const ABSCHNITT_REIHENFOLGE = ['KRITISCH', 'IMPLANTATION', 'AKTIVITAET_NEUKUNDE', 'AKTIVITAET_BESTAND', 'MARKETING', 'PROJEKT', 'NAECHSTE_AKTIVITAET', 'WETTBEWERB'] as const;
type Abschnitt = (typeof ABSCHNITT_REIHENFOLGE)[number];

interface Eintrag {
  id: string;
  abschnitt: Abschnitt;
  typ: string | null;
  customerSiteId: string | null;
  customerSiteName: string | null;
  competitorId: string | null;
  competitorName: string | null;
  tenderId: string | null;
  tenderReferenz: string | null;
  e1Id: string | null;
  e1Name: string | null;
  datum: string | null;
  beschreibung: string;
  ergebnis: string | null;
  landIso: string | null;
  stadt: string | null;
  erwarteterUmsatzEur: number | null;
  wahrscheinlichkeit: number | null;
  kostenEur: number | null;
  menge: number | null;
  preisInfo: string | null;
}
interface Report {
  id: string;
  status: string;
  userName: string | null;
  forecastFolgemonatEur: number | null;
  forecastQuartalEur: number | null;
  wettbewerbKeineAenderung: boolean;
  marktAllgemein: string | null;
  personal: string | null;
  sonstiges: string | null;
  eingereichtAm: string | null;
  gelesenVon: string | null;
  eintraege: Eintrag[];
}
interface RegionReport {
  regionCode: string;
  bezeichnung: string;
  status: string;
  report: Report | null;
}
interface PeriodeData {
  periode: string;
  bearbeitbar: boolean;
  regionen: RegionReport[];
}
interface ZahlenZeile {
  e1Id: string;
  e1Name: string;
  planMonat: number;
  istMonat: number;
  deltaEur: number;
  deltaProzent: number | null;
  planYtd: number;
  istYtd: number;
  vorjahrMonat: number;
  vorjahrYtd: number;
}
interface Site {
  id: string;
  name: string;
  regionCode: string | null;
}
interface Competitor {
  id: string;
  name: string;
}
interface TenderRef {
  id: string;
  referenznummer: string;
  krankenhaus: string;
  status: string;
}

const f0 = (v: number): string => Math.round(v / 1000).toLocaleString('de-DE');
const eur = (v: number | null): string => (v == null ? '—' : v.toLocaleString('de-DE'));

interface EintragDraft {
  typ: string;
  customerSiteId: string;
  competitorId: string;
  tenderId: string;
  e1Id: string;
  datum: string;
  beschreibung: string;
  ergebnis: string;
  landIso: string;
  stadt: string;
  erwarteterUmsatzEur: string;
  wahrscheinlichkeit: string;
  kostenEur: string;
  menge: string;
  preisInfo: string;
}
const leerDraft = (): EintragDraft => ({ typ: '', customerSiteId: '', competitorId: '', tenderId: '', e1Id: '', datum: '', beschreibung: '', ergebnis: '', landIso: '', stadt: '', erwarteterUmsatzEur: '', wahrscheinlichkeit: '', kostenEur: '', menge: '', preisInfo: '' });

function Feld({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-0.5 block text-xs font-medium text-gray-600">{label}</label>
      {children}
    </div>
  );
}
const inputCls = 'w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-ez-primary focus:outline-none';

function EintragForm({ abschnitt, sites, competitors, tenderListe, e1Liste, onSave, onCancel }: { abschnitt: Abschnitt; sites: Site[]; competitors: Competitor[]; tenderListe: TenderRef[]; e1Liste: { e1Id: string; e1Name: string }[]; onSave: (payload: Record<string, unknown>) => Promise<void>; onCancel: () => void }) {
  const t = useTranslations('report');
  const [d, setD] = useState<EintragDraft>(leerDraft());
  const [fehler, setFehler] = useState('');
  const upd = (p: Partial<EintragDraft>) => setD((c) => ({ ...c, ...p }));
  const zahl = (s: string): number | undefined => (s.trim() ? Number(s.replace(',', '.')) : undefined);

  const zeige = {
    typKritisch: abschnitt === 'KRITISCH',
    typAktivitaet: abschnitt === 'AKTIVITAET_NEUKUNDE' || abschnitt === 'AKTIVITAET_BESTAND',
    site: abschnitt !== 'NAECHSTE_AKTIVITAET' && abschnitt !== 'MARKETING',
    competitor: abschnitt === 'WETTBEWERB',
    tender: abschnitt === 'KRITISCH',
    e1: abschnitt === 'KRITISCH',
    datum: abschnitt !== 'WETTBEWERB' && abschnitt !== 'IMPLANTATION' && abschnitt !== 'PROJEKT',
    ergebnis: zeigeErgebnis(abschnitt),
    projekt: abschnitt === 'PROJEKT',
    kosten: abschnitt === 'MARKETING',
    menge: abschnitt === 'IMPLANTATION',
    preisInfo: abschnitt === 'WETTBEWERB',
  };
  function zeigeErgebnis(a: Abschnitt): boolean {
    return a === 'AKTIVITAET_NEUKUNDE' || a === 'AKTIVITAET_BESTAND';
  }

  const speichern = async () => {
    setFehler('');
    try {
      await onSave({
        abschnitt,
        typ: d.typ || undefined,
        customerSiteId: d.customerSiteId || undefined,
        competitorId: d.competitorId || undefined,
        tenderId: d.tenderId || undefined,
        e1Id: d.e1Id || undefined,
        datum: d.datum || undefined,
        beschreibung: d.beschreibung.trim() || '—',
        ergebnis: d.ergebnis.trim() || undefined,
        landIso: d.landIso.trim() || undefined,
        stadt: d.stadt.trim() || undefined,
        erwarteterUmsatzEur: zahl(d.erwarteterUmsatzEur),
        wahrscheinlichkeit: zahl(d.wahrscheinlichkeit),
        kostenEur: zahl(d.kostenEur),
        menge: zahl(d.menge),
        preisInfo: d.preisInfo.trim() || undefined,
      });
      setD(leerDraft());
    } catch (e) {
      setFehler(e instanceof ApiError ? e.message : 'Fehler.');
    }
  };

  return (
    <div className="space-y-2 rounded border border-ez-primary/30 bg-ez-primary/5 p-2">
      <div className="grid gap-2 sm:grid-cols-3">
        {(zeige.typKritisch || zeige.typAktivitaet) && (
          <Feld label={t('typ')}>
            <select className={inputCls} value={d.typ} onChange={(e) => upd({ typ: e.target.value })}>
              <option value="">{t('keineAuswahl')}</option>
              {(zeige.typKritisch ? KRITISCH_TYPEN : AKTIVITAET_TYPEN).map((ty) => (
                <option key={ty} value={ty}>
                  {t(`typLabel.${ty}`)}
                </option>
              ))}
            </select>
          </Feld>
        )}
        {zeige.site && (
          <Feld label={t('standort')}>
            <select className={inputCls} value={d.customerSiteId} onChange={(e) => upd({ customerSiteId: e.target.value })}>
              <option value="">{t('keineAuswahl')}</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Feld>
        )}
        {zeige.competitor && (
          <Feld label={t('wettbewerberFeld')}>
            <select className={inputCls} value={d.competitorId} onChange={(e) => upd({ competitorId: e.target.value })}>
              <option value="">{t('keineAuswahl')}</option>
              {competitors.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Feld>
        )}
        {zeige.tender && (
          <Feld label={t('tenderFeld')}>
            <select className={inputCls} value={d.tenderId} onChange={(e) => upd({ tenderId: e.target.value })}>
              <option value="">{t('keineAuswahl')}</option>
              {tenderListe.map((tn) => (
                <option key={tn.id} value={tn.id}>
                  {tn.referenznummer} · {tn.krankenhaus}
                </option>
              ))}
            </select>
          </Feld>
        )}
        {zeige.e1 && (
          <Feld label={t('produktlinie')}>
            <select className={inputCls} value={d.e1Id} onChange={(e) => upd({ e1Id: e.target.value })}>
              <option value="">{t('keineAuswahl')}</option>
              {e1Liste.map((e1) => (
                <option key={e1.e1Id} value={e1.e1Id}>
                  {e1.e1Name}
                </option>
              ))}
            </select>
          </Feld>
        )}
        {zeige.datum && (
          <Feld label={t('datum')}>
            <input type="date" className={inputCls} value={d.datum} onChange={(e) => upd({ datum: e.target.value })} />
          </Feld>
        )}
        {zeige.menge && (
          <Feld label={t('menge')}>
            <input className={inputCls} value={d.menge} onChange={(e) => upd({ menge: e.target.value })} />
          </Feld>
        )}
        {zeige.kosten && (
          <Feld label={t('kosten')}>
            <input className={inputCls} value={d.kostenEur} onChange={(e) => upd({ kostenEur: e.target.value })} />
          </Feld>
        )}
        {zeige.projekt && (
          <>
            <Feld label={t('erwarteterUmsatz')}>
              <input className={inputCls} value={d.erwarteterUmsatzEur} onChange={(e) => upd({ erwarteterUmsatzEur: e.target.value })} />
            </Feld>
            <Feld label={t('wahrscheinlichkeit')}>
              <input className={inputCls} value={d.wahrscheinlichkeit} onChange={(e) => upd({ wahrscheinlichkeit: e.target.value })} />
            </Feld>
            <Feld label="Land (ISO)">
              <input className={inputCls} value={d.landIso} onChange={(e) => upd({ landIso: e.target.value.toUpperCase() })} />
            </Feld>
            <Feld label="Stadt / City">
              <input className={inputCls} value={d.stadt} onChange={(e) => upd({ stadt: e.target.value })} />
            </Feld>
          </>
        )}
        {zeige.preisInfo && (
          <Feld label={t('preisInfo')}>
            <input className={inputCls} value={d.preisInfo} onChange={(e) => upd({ preisInfo: e.target.value })} />
          </Feld>
        )}
      </div>
      <Feld label={t('beschreibungFeld')}>
        <textarea className={inputCls} rows={2} value={d.beschreibung} onChange={(e) => upd({ beschreibung: e.target.value })} />
      </Feld>
      {zeige.ergebnis && (
        <Feld label={t('ergebnis')}>
          <input className={inputCls} value={d.ergebnis} onChange={(e) => upd({ ergebnis: e.target.value })} />
        </Feld>
      )}
      {fehler && <p className="rounded bg-ez-accent/10 p-1.5 text-xs text-ez-accent">{fehler}</p>}
      <div className="flex gap-2">
        <Button className="px-3 py-1 text-xs" onClick={speichern}>
          {t('speichernEintrag')}
        </Button>
        <Button variant="ghost" className="px-3 py-1 text-xs" onClick={onCancel}>
          ✕
        </Button>
      </div>
    </div>
  );
}

function EintragZeile({ e, readOnly, onDelete }: { e: Eintrag; readOnly: boolean; onDelete: (id: string) => void }) {
  const t = useTranslations('report');
  const meta: string[] = [];
  if (e.typ) meta.push(t(`typLabel.${e.typ}`));
  if (e.e1Name) meta.push(e.e1Name);
  if (e.customerSiteName) meta.push(e.customerSiteName);
  if (e.competitorName) meta.push(e.competitorName);
  if (e.tenderReferenz) meta.push(`⚑ ${e.tenderReferenz}`);
  if (e.datum) meta.push(new Date(e.datum).toLocaleDateString('de-DE'));
  if (e.menge != null) meta.push(`${eur(e.menge)} Stk.`);
  if (e.kostenEur != null) meta.push(`${eur(e.kostenEur)} €`);
  if (e.erwarteterUmsatzEur != null) meta.push(`${eur(e.erwarteterUmsatzEur)} €${e.wahrscheinlichkeit != null ? ` · ${e.wahrscheinlichkeit}%` : ''}`);
  if (e.landIso || e.stadt) meta.push([e.stadt, e.landIso].filter(Boolean).join(', '));
  if (e.preisInfo) meta.push(e.preisInfo);
  return (
    <div className="flex items-start justify-between gap-2 border-b border-gray-100 py-1.5 text-sm">
      <div>
        {meta.length > 0 && <span className="mr-2 text-xs text-gray-500">[{meta.join(' · ')}]</span>}
        <span className="text-gray-800">{e.beschreibung}</span>
        {e.ergebnis && <span className="text-gray-500"> → {e.ergebnis}</span>}
      </div>
      {!readOnly && (
        <button className="shrink-0 text-xs text-ez-accent hover:underline" onClick={() => onDelete(e.id)}>
          ✕
        </button>
      )}
    </div>
  );
}

function RegionReportCard({ periode, rr, bearbeitbar, sites, competitors, tenderListe }: { periode: string; rr: RegionReport; bearbeitbar: boolean; sites: Site[]; competitors: Competitor[]; tenderListe: TenderRef[] }) {
  const t = useTranslations('report');
  const tc = useTranslations('common');
  const qc = useQueryClient();
  const r = rr.report;
  const eingereicht = rr.status === 'EINGEREICHT' || rr.status === 'GELESEN';
  const readOnly = !bearbeitbar || eingereicht;
  const [kopf, setKopf] = useState({ forecastFolgemonatEur: '', forecastQuartalEur: '', wettbewerbKeineAenderung: false, marktAllgemein: '', personal: '', sonstiges: '' });
  const [offenesFormular, setOffenesFormular] = useState<Abschnitt | null>(null);
  const [fehler, setFehler] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    setKopf({
      forecastFolgemonatEur: r?.forecastFolgemonatEur != null ? String(r.forecastFolgemonatEur) : '',
      forecastQuartalEur: r?.forecastQuartalEur != null ? String(r.forecastQuartalEur) : '',
      wettbewerbKeineAenderung: r?.wettbewerbKeineAenderung ?? false,
      marktAllgemein: r?.marktAllgemein ?? '',
      personal: r?.personal ?? '',
      sonstiges: r?.sonstiges ?? '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periode, rr.regionCode, rr.status]);

  const { data: zahlen } = useQuery({
    queryKey: ['report-zahlen', periode, rr.regionCode],
    queryFn: () => api.get<{ zeilen: ZahlenZeile[] }>(`/report/zahlen/${periode}/${rr.regionCode}`),
  });
  const e1Liste = (zahlen?.zeilen ?? []).map((z) => ({ e1Id: z.e1Id, e1Name: z.e1Name }));

  const reload = () => qc.invalidateQueries({ queryKey: ['report', periode] });
  const fehlerVon = (e: unknown) => setFehler(e instanceof ApiError ? e.message : tc('fehler'));
  const zahl = (s: string): number | null => (s.trim() ? Number(s.replace(',', '.')) : null);

  const kopfSpeichern = async (still = false) => {
    setFehler('');
    setMsg('');
    try {
      await api.put(`/report/periode/${periode}/region/${rr.regionCode}`, {
        forecastFolgemonatEur: zahl(kopf.forecastFolgemonatEur),
        forecastQuartalEur: zahl(kopf.forecastQuartalEur),
        wettbewerbKeineAenderung: kopf.wettbewerbKeineAenderung,
        marktAllgemein: kopf.marktAllgemein || null,
        personal: kopf.personal || null,
        sonstiges: kopf.sonstiges || null,
      });
      if (!still) {
        setMsg(t('gespeichert'));
        reload();
      }
    } catch (e) {
      fehlerVon(e);
      throw e;
    }
  };
  const einreichen = async () => {
    setFehler('');
    setMsg('');
    try {
      await kopfSpeichern(true);
      await api.post(`/report/periode/${periode}/region/${rr.regionCode}/einreichen`);
      reload();
    } catch (e) {
      fehlerVon(e);
    }
  };
  const wiederOeffnen = async () => {
    setFehler('');
    try {
      await api.post(`/report/periode/${periode}/region/${rr.regionCode}/zuruecksetzen`);
      reload();
    } catch (e) {
      fehlerVon(e);
    }
  };
  const eintragAnlegen = async (payload: Record<string, unknown>) => {
    await api.post(`/report/periode/${periode}/region/${rr.regionCode}/eintraege`, payload);
    setOffenesFormular(null);
    reload();
  };
  const eintragLoeschen = async (id: string) => {
    setFehler('');
    try {
      await api.del(`/report/eintrag/${id}`);
      reload();
    } catch (e) {
      fehlerVon(e);
    }
  };

  const eintraege = (a: Abschnitt) => (r?.eintraege ?? []).filter((e) => e.abschnitt === a);

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-ez-primary">
          {rr.regionCode} · {rr.bezeichnung}
        </h3>
        <span className={`rounded px-2 py-0.5 text-xs ${eingereicht ? 'bg-ez-ampelGruen/15 text-ez-ampelGruen' : 'bg-gray-100 text-gray-600'}`}>
          {t(`statusLabel.${rr.status}`)}
          {r?.userName ? ` · ${r.userName}` : ''}
        </span>
      </div>
      {eingereicht && r?.eingereichtAm && (
        <p className="text-xs text-gray-500">{t('eingereichtInfo', { datum: new Date(r.eingereichtAm).toLocaleDateString('de-DE'), von: r.gelesenVon ?? 'leer' })}</p>
      )}

      {!readOnly && <VoicePanel periode={periode} regionCode={rr.regionCode} onUebernommen={reload} />}

      {/* §2 Zahlenteil (automatisch) */}
      <div>
        <h4 className="mb-1 text-sm font-semibold text-gray-700">{t('zahlenTitel')}</h4>
        {zahlen && zahlen.zeilen.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs tabular-nums">
              <thead className="bg-gray-50 text-left text-gray-500">
                <tr>
                  <th className="p-1">{t('spalteProduktlinie')}</th>
                  <th className="p-1 text-right">{t('spaltePlan')}</th>
                  <th className="p-1 text-right">{t('spalteIst')}</th>
                  <th className="p-1 text-right">{t('spalteDelta')}</th>
                  <th className="p-1 text-right">{t('spalteDeltaProzent')}</th>
                  <th className="p-1 text-right">{t('spaltePlanYtd')}</th>
                  <th className="p-1 text-right">{t('spalteIstYtd')}</th>
                  <th className="p-1 text-right">{t('spaltePy')}</th>
                  <th className="p-1 text-right">{t('spaltePyYtd')}</th>
                </tr>
              </thead>
              <tbody>
                {zahlen.zeilen.map((z) => (
                  <tr key={z.e1Id} className="border-t border-gray-100">
                    <td className="p-1 font-medium">{z.e1Name}</td>
                    <td className="p-1 text-right">{f0(z.planMonat)}</td>
                    <td className="p-1 text-right">{f0(z.istMonat)}</td>
                    <td className={`p-1 text-right ${z.deltaEur < 0 ? 'text-ez-accent' : 'text-ez-ampelGruen'}`}>{f0(z.deltaEur)}</td>
                    <td className={`p-1 text-right ${(z.deltaProzent ?? 0) < 0 ? 'text-ez-accent' : 'text-ez-ampelGruen'}`}>{z.deltaProzent == null ? '—' : `${z.deltaProzent.toLocaleString('de-DE')} %`}</td>
                    <td className="p-1 text-right">{f0(z.planYtd)}</td>
                    <td className="p-1 text-right">{f0(z.istYtd)}</td>
                    <td className="p-1 text-right text-gray-500">{f0(z.vorjahrMonat)}</td>
                    <td className="p-1 text-right text-gray-500">{f0(z.vorjahrYtd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-0.5 text-[10px] text-gray-400">{t('kEur')}</p>
          </div>
        ) : (
          <p className="text-xs text-gray-400">{t('zahlenLeer')}</p>
        )}
      </div>

      {/* Abschnitte mit Einträgen */}
      {ABSCHNITT_REIHENFOLGE.map((a) => (
        <div key={a}>
          <div className="mb-1 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-gray-700">{t(`abschnitt.${a}`)}</h4>
            {!readOnly && offenesFormular !== a && (
              <Button variant="ghost" className="px-2 py-0.5 text-xs" onClick={() => setOffenesFormular(a)}>
                {t('eintragHinzufuegen')}
              </Button>
            )}
          </div>
          {a === 'WETTBEWERB' && (
            <label className="mb-1 flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={kopf.wettbewerbKeineAenderung} disabled={readOnly} onChange={(e) => setKopf({ ...kopf, wettbewerbKeineAenderung: e.target.checked })} />
              {t('keineAenderung')}
            </label>
          )}
          {eintraege(a).length === 0 && offenesFormular !== a && <p className="text-xs text-gray-400">{t('keineEintraege')}</p>}
          {eintraege(a).map((e) => (
            <EintragZeile key={e.id} e={e} readOnly={readOnly} onDelete={eintragLoeschen} />
          ))}
          {offenesFormular === a && !readOnly && (
            <EintragForm abschnitt={a} sites={sites} competitors={competitors} tenderListe={tenderListe} e1Liste={e1Liste} onSave={eintragAnlegen} onCancel={() => setOffenesFormular(null)} />
          )}
          {a === 'MARKETING' && (
            <div className="mt-3 rounded border border-ez-primary/20 bg-ez-primary/5 p-2">
              <h4 className="mb-1 text-sm font-semibold text-gray-700">{t('ausblickTitel')}</h4>
              <div className="grid gap-2 sm:grid-cols-2">
                <Feld label={t('forecastFolgemonat')}>
                  <input className={inputCls} disabled={readOnly} value={kopf.forecastFolgemonatEur} onChange={(e) => setKopf({ ...kopf, forecastFolgemonatEur: e.target.value })} />
                </Feld>
                <Feld label={t('forecastQuartal')}>
                  <input className={inputCls} disabled={readOnly} value={kopf.forecastQuartalEur} onChange={(e) => setKopf({ ...kopf, forecastQuartalEur: e.target.value })} />
                </Feld>
              </div>
            </div>
          )}
        </div>
      ))}

      {/* §8 Freitexte */}
      <div>
        <h4 className="mb-1 text-sm font-semibold text-gray-700">{t('abschnitt8Titel')}</h4>
        <div className="grid gap-2 sm:grid-cols-3">
          <Feld label={t('markt')}>
            <textarea className={inputCls} rows={2} disabled={readOnly} value={kopf.marktAllgemein} onChange={(e) => setKopf({ ...kopf, marktAllgemein: e.target.value })} />
          </Feld>
          <Feld label={t('personal')}>
            <textarea className={inputCls} rows={2} disabled={readOnly} value={kopf.personal} onChange={(e) => setKopf({ ...kopf, personal: e.target.value })} />
          </Feld>
          <Feld label={t('sonstiges')}>
            <textarea className={inputCls} rows={2} disabled={readOnly} value={kopf.sonstiges} onChange={(e) => setKopf({ ...kopf, sonstiges: e.target.value })} />
          </Feld>
        </div>
      </div>

      {fehler && <p className="rounded bg-ez-accent/10 p-2 text-sm text-ez-accent">{fehler}</p>}
      {msg && <p className="text-sm text-ez-ampelGruen">{msg}</p>}

      {bearbeitbar && (
        <div className="space-y-1 border-t border-gray-100 pt-2">
          {!eingereicht ? (
            <>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => kopfSpeichern()}>
                  {t('entwurfSpeichern')}
                </Button>
                <Button onClick={einreichen}>{t('einreichen')}</Button>
              </div>
              <p className="text-xs text-gray-400">{t('pflichtHinweis')}</p>
            </>
          ) : (
            <Button variant="ghost" onClick={wiederOeffnen}>
              {t('wiederOeffnen')}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

export default function ReportPage() {
  const t = useTranslations('report');
  const tc = useTranslations('common');
  const locale = useLocale();
  const MON = monKurz(locale);
  const heute = new Date();
  // Default: Vormonat (Berichtsmonat)
  const [jahr, setJahr] = useState(heute.getUTCMonth() === 0 ? heute.getUTCFullYear() - 1 : heute.getUTCFullYear());
  const [monat, setMonat] = useState(heute.getUTCMonth() === 0 ? 12 : heute.getUTCMonth());
  const periode = `${jahr}-${String(monat).padStart(2, '0')}`;

  const { data, isLoading } = useQuery({ queryKey: ['report', periode], queryFn: () => api.get<PeriodeData>(`/report/periode/${periode}`) });
  const { data: sites } = useQuery({ queryKey: ['sites'], queryFn: () => api.get<Site[]>('/customer-site') });
  const { data: competitors } = useQuery({ queryKey: ['competitor-aktiv'], queryFn: () => api.get<Competitor[]>('/competitor?nurAktiv=true') });
  const { data: tenderListe } = useQuery({ queryKey: ['tender', ''], queryFn: () => api.get<TenderRef[]>('/tender') });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ez-primary">{t('titel')}</h1>
          <p className="text-sm text-gray-500">{t('beschreibung')}</p>
        </div>
        <div className="flex items-center gap-2">
          <select className="rounded border border-gray-300 px-2 py-1 text-sm" value={monat} onChange={(e) => setMonat(Number(e.target.value))}>
            {MON.map((m, i) => (
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

      {isLoading && <p className="text-gray-500">{tc('laedt')}</p>}
      {data && data.regionen.length === 0 && (
        <Card>
          <p className="text-gray-600">{t('keineRegion')}</p>
        </Card>
      )}
      {data?.regionen.map((rr) => (
        <RegionReportCard key={rr.regionCode} periode={periode} rr={rr} bearbeitbar={data.bearbeitbar} sites={sites ?? []} competitors={competitors ?? []} tenderListe={tenderListe ?? []} />
      ))}
    </div>
  );
}
