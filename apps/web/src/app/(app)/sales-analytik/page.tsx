'use client';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { Button, Card } from '@/components/ui';
import { DataTable, type Column } from '@/components/data-table';

type Zeile = Record<string, unknown>;
const s = (v: unknown): string => (v == null ? '' : String(v));
const nz = (v: unknown): number => (typeof v === 'number' ? v : 0);
const zeit = (v: unknown): number => (v ? new Date(v as string).getTime() : 0);

type Typ = 'preisstabilitaet' | 'umsatzveraenderung' | 'kundenzeitreihe' | 'mengentrend';
type Quelle = 'D365' | 'CONTROLLING';

const TYP_LABEL: Record<Typ, string> = {
  preisstabilitaet: 'Preisstabilität',
  umsatzveraenderung: 'Umsatzveränderung',
  kundenzeitreihe: 'Kunden-Zeitreihe',
  mengentrend: 'Mengentrend',
};
// CONTROLLING (Sales-Flash, Netto-Umsatz ohne Menge/Preis) unterstützt nur die umsatzbasierten Auswertungen.
const CONTROLLING_TABS: Typ[] = ['umsatzveraenderung', 'kundenzeitreihe'];
const TYP_HINWEIS: Record<Typ, string> = {
  preisstabilitaet: 'Kunden, die für ein Produkt über ≥ N Jahre denselben Preis zahlen.',
  umsatzveraenderung: 'Größte Umsatzsteigerung / -rückgang je Kunde zwischen zwei Jahren.',
  kundenzeitreihe: 'Umsatz, Menge und Ø-Preis eines Kunden über die Jahre.',
  mengentrend: 'Größte Mengenveränderung je Kunde oder Produkt zwischen zwei Jahren.',
};

interface FilterOpt { jahre: number[]; waehrungen: { waehrung: string; anzahl: number }[] }
interface Kunde { dataAreaId: string; kundennummer: string; name: string }
interface Produkt { produktnummer: string; produktname: string | null; anzahl: number }

// kEUR-Anzeige (Tausend EUR, 1 Nachkommastelle) bzw. Menge/Preis in voller Zahl.
const keur = (v: number) => (v / 1000).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const num = (v: number | null, d = 0) => (v === null ? '—' : v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d }));
const pct = (v: number | null) => (v === null ? '—' : `${v.toLocaleString('de-DE', { maximumFractionDigits: 1 })} %`);
const dat = (s: string) => new Date(s).toLocaleDateString('de-DE');

export default function SalesAnalytikPage() {
  const [quelle, setQuelle] = useState<Quelle>('D365');
  const [typ, setTyp] = useState<Typ>('preisstabilitaet');
  const [waehrung, setWaehrung] = useState('EUR');
  const [jahre, setJahre] = useState(3);
  const [toleranz, setToleranz] = useState(0);
  const [jahrVon, setJahrVon] = useState(2020);
  const [jahrBis, setJahrBis] = useState(2026);
  const [richtung, setRichtung] = useState<'steigerung' | 'rueckgang' | 'beide'>('beide');
  const [dimension, setDimension] = useState<'kunde' | 'produkt'>('kunde');
  const [produktnummer, setProduktnummer] = useState('');
  const [kundenKey, setKundenKey] = useState(''); // "dataAreaId|kundennummer"
  const [result, setResult] = useState<{ zeilen: Record<string, unknown>[]; parameter: Record<string, unknown> } | null>(null);
  const [fehler, setFehler] = useState('');
  const [laedt, setLaedt] = useState(false);
  const [kiFrage, setKiFrage] = useState('');
  const [kiAntwort, setKiAntwort] = useState<{ analyseTyp: string; erklaerung: string; antwort: string } | null>(null);
  const [kiLaedt, setKiLaedt] = useState(false);

  const { data: opt } = useQuery({ queryKey: ['analytik-opt', quelle], queryFn: () => api.get<FilterOpt>(`/sales-analytik/filteroptionen?quelle=${quelle}`) });
  const { data: kunden } = useQuery({ queryKey: ['analytik-kunden', quelle], queryFn: () => api.get<Kunde[]>(`/sales-analytik/kunden?quelle=${quelle}`) });
  const { data: produkte } = useQuery({ queryKey: ['analytik-produkte', quelle], queryFn: () => api.get<Produkt[]>(`/sales-analytik/produkte?quelle=${quelle}`) });
  const jahreOpt = opt?.jahre ?? [2026, 2025, 2024, 2023, 2022, 2021, 2020];
  const waehrungOpt = opt?.waehrungen.map((w) => w.waehrung) ?? ['EUR'];
  const sichtbareTabs: Typ[] = quelle === 'CONTROLLING' ? CONTROLLING_TABS : (Object.keys(TYP_LABEL) as Typ[]);

  const wechsleQuelle = (nq: Quelle) => {
    setQuelle(nq);
    setResult(null);
    setFehler('');
    setKundenKey('');
    setProduktnummer('');
    if (nq === 'CONTROLLING' && !CONTROLLING_TABS.includes(typ)) setTyp('umsatzveraenderung');
  };

  const auswerten = async () => {
    setFehler('');
    setLaedt(true);
    setResult(null);
    try {
      let url = '';
      const w = `waehrung=${waehrung}`;
      const qp = `&quelle=${quelle}`;
      if (typ === 'preisstabilitaet') url = `/sales-analytik/preisstabilitaet?jahre=${jahre}&toleranzProzent=${toleranz}&${w}${produktnummer ? `&produktnummer=${encodeURIComponent(produktnummer)}` : ''}`;
      else if (typ === 'umsatzveraenderung') url = `/sales-analytik/umsatzveraenderung?jahrVon=${jahrVon}&jahrBis=${jahrBis}&richtung=${richtung}&${w}${qp}`;
      else if (typ === 'mengentrend') url = `/sales-analytik/mengentrend?jahrVon=${jahrVon}&jahrBis=${jahrBis}&dimension=${dimension}&richtung=${richtung}&${w}`;
      else {
        if (!kundenKey) { setFehler('Bitte einen Kunden wählen.'); setLaedt(false); return; }
        const [da, nr] = kundenKey.split('|');
        url = `/sales-analytik/kundenzeitreihe?dataAreaId=${encodeURIComponent(da)}&kundennummer=${encodeURIComponent(nr)}&${w}${produktnummer ? `&produktnummer=${encodeURIComponent(produktnummer)}` : ''}${qp}`;
      }
      const res = await api.get<{ zeilen: Record<string, unknown>[]; parameter: Record<string, unknown> }>(url);
      setResult(res);
    } catch (e) {
      setFehler(e instanceof ApiError ? e.message : 'Auswertung fehlgeschlagen.');
    } finally {
      setLaedt(false);
    }
  };

  const frageStellen = async () => {
    if (!kiFrage.trim()) return;
    setFehler('');
    setKiLaedt(true);
    setKiAntwort(null);
    setResult(null);
    try {
      const res = await api.post<{ analyseTyp: Typ | 'unbekannt'; erklaerung: string; antwort: string; ergebnis: { typ: Typ; parameter: Record<string, unknown>; zeilen: Record<string, unknown>[] } | null }>('/sales-ki/frage', { frage: kiFrage });
      setKiAntwort({ analyseTyp: res.analyseTyp, erklaerung: res.erklaerung, antwort: res.antwort });
      if (res.ergebnis) {
        const par = res.ergebnis.parameter;
        setTyp(res.ergebnis.typ);
        if (typeof par.jahrVon === 'number') setJahrVon(par.jahrVon);
        if (typeof par.jahrBis === 'number') setJahrBis(par.jahrBis);
        if (par.dimension === 'kunde' || par.dimension === 'produkt') setDimension(par.dimension);
        if (typeof par.waehrung === 'string') setWaehrung(par.waehrung);
        setResult({ zeilen: res.ergebnis.zeilen, parameter: par });
      }
    } catch (e) {
      setFehler(e instanceof ApiError ? e.message : 'KI-Anfrage fehlgeschlagen.');
    } finally {
      setKiLaedt(false);
    }
  };

  const zeilen = result?.zeilen ?? [];
  const spalten = useMemo<Column<Zeile>[]>(() => {
    const R = (align: 'right') => ({ align, filter: 'none' as const });
    if (typ === 'preisstabilitaet') return [
      { key: 'kunde', label: 'Kunde', value: (z) => s(z.kundenname ?? z.kundennummer), render: (z) => s(z.kundenname ?? z.kundennummer) },
      { key: 'produkt', label: 'Produkt', value: (z) => s(z.produktname ?? z.produktnummer), render: (z) => s(z.produktname ?? z.produktnummer) },
      { key: 'preis', label: 'Preis', ...R('right'), value: (z) => nz(z.preis), render: (z) => num(z.preis as number, 2) },
      { key: 'jahre', label: 'Jahre', ...R('right'), value: (z) => nz(z.jahreSpanne), render: (z) => num(z.jahreSpanne as number, 1) },
      { key: 'anzahl', label: 'Rechnungen', ...R('right'), value: (z) => nz(z.anzahlRechnungen), render: (z) => num(z.anzahlRechnungen as number) },
      { key: 'von', label: 'von', ...R('right'), value: (z) => zeit(z.ersteRechnung), render: (z) => dat(z.ersteRechnung as string) },
      { key: 'bis', label: 'bis', ...R('right'), value: (z) => zeit(z.letzteRechnung), render: (z) => dat(z.letzteRechnung as string) },
    ];
    if (typ === 'umsatzveraenderung') return [
      { key: 'kunde', label: 'Kunde', value: (z) => s(z.kundenname ?? z.kundennummer), render: (z) => s(z.kundenname ?? z.kundennummer) },
      { key: 'von', label: `Umsatz ${jahrVon} (kEUR)`, ...R('right'), value: (z) => nz(z.umsatzVon), render: (z) => keur(z.umsatzVon as number) },
      { key: 'bis', label: `Umsatz ${jahrBis} (kEUR)`, ...R('right'), value: (z) => nz(z.umsatzBis), render: (z) => keur(z.umsatzBis as number) },
      { key: 'delta', label: 'Δ (kEUR)', ...R('right'), value: (z) => nz(z.deltaEur), render: (z) => keur(z.deltaEur as number) },
      { key: 'deltaP', label: 'Δ %', ...R('right'), value: (z) => nz(z.deltaProzent), render: (z) => pct(z.deltaProzent as number | null) },
    ];
    if (typ === 'mengentrend') return [
      { key: 'label', label: dimension === 'produkt' ? 'Produkt' : 'Kunde', value: (z) => s(z.label ?? z.schluessel), render: (z) => s(z.label ?? z.schluessel) },
      { key: 'von', label: `Menge ${jahrVon}`, ...R('right'), value: (z) => nz(z.mengeVon), render: (z) => num(z.mengeVon as number) },
      { key: 'bis', label: `Menge ${jahrBis}`, ...R('right'), value: (z) => nz(z.mengeBis), render: (z) => num(z.mengeBis as number) },
      { key: 'delta', label: 'Δ Menge', ...R('right'), value: (z) => nz(z.deltaMenge), render: (z) => num(z.deltaMenge as number) },
      { key: 'deltaP', label: 'Δ %', ...R('right'), value: (z) => nz(z.deltaProzent), render: (z) => pct(z.deltaProzent as number | null) },
    ];
    const zeitreihe: Column<Zeile>[] = [
      { key: 'jahr', label: 'Jahr', ...R('right'), value: (z) => nz(z.jahr), render: (z) => String(z.jahr) },
      { key: 'umsatz', label: 'Umsatz (kEUR)', ...R('right'), value: (z) => nz(z.umsatz), render: (z) => keur(z.umsatz as number) },
    ];
    // Menge/Ø-Preis nur bei D365 (im Controlling-Netto-Umsatz nicht enthalten).
    if (quelle === 'D365') zeitreihe.push(
      { key: 'menge', label: 'Menge', ...R('right'), value: (z) => nz(z.menge), render: (z) => num(z.menge as number) },
      { key: 'preis', label: 'Ø-Preis', ...R('right'), value: (z) => nz(z.durchschnittspreis), render: (z) => num(z.durchschnittspreis as number | null, 2) },
    );
    return zeitreihe;
  }, [typ, jahrVon, jahrBis, dimension, quelle]);

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold text-ez-primary">Sales-Analytik</h1>
        <p className="text-sm text-gray-500">
          {quelle === 'D365'
            ? 'Kundenscharfe Auswertungen aus den D365-Rechnungsdaten (brutto fakturiert, mit Menge/Preis). Beträge in kEUR; je Auswertung eine Währung.'
            : 'Kundenscharfe Auswertungen auf dem maßgeblichen Controlling-Umsatz (Sales Flash, Netto). Beträge in kEUR. Menge/Preis sind hier nicht enthalten.'}
        </p>
        <div className="inline-flex overflow-hidden rounded border border-gray-300 text-sm">
          {(['D365', 'CONTROLLING'] as Quelle[]).map((qq) => (
            <button
              key={qq}
              onClick={() => wechsleQuelle(qq)}
              className={`px-3 py-1 ${quelle === qq ? 'bg-ez-primary text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              {qq === 'D365' ? 'D365-Rechnungen' : 'Controlling-Umsatz'}
            </button>
          ))}
        </div>
      </div>

      {quelle === 'D365' && (
      <Card className="space-y-2">
        <h2 className="font-semibold text-ez-primary">Frage stellen</h2>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className={`${INP} min-w-[280px] flex-1`}
            placeholder="z. B. Welche Kunden zahlen seit über 3 Jahren denselben Preis?"
            value={kiFrage}
            onChange={(e) => setKiFrage(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') frageStellen(); }}
          />
          <Button onClick={frageStellen} disabled={kiLaedt || !kiFrage.trim()}>{kiLaedt ? 'Denkt nach…' : 'Fragen'}</Button>
        </div>
        {kiAntwort && (
          <div className="rounded border border-ez-primary/30 bg-ez-primary/5 p-3 text-sm">
            <p className="font-medium text-gray-800">{kiAntwort.antwort}</p>
            {kiAntwort.erklaerung && <p className="mt-1 text-xs text-gray-500">Interpretation: {kiAntwort.erklaerung}</p>}
          </div>
        )}
        <p className="text-xs text-gray-400">Die KI wählt nur eine der Auswertungen unten und deren Parameter — die Zahlen kommen aus der Datenbank, nicht aus dem Sprachmodell.</p>
      </Card>
      )}

      <Card className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {sichtbareTabs.map((t) => (
            <button
              key={t}
              onClick={() => { setTyp(t); setResult(null); setFehler(''); }}
              className={`rounded border px-3 py-1 text-sm ${typ === t ? 'border-ez-primary bg-ez-primary text-white' : 'bg-white'}`}
            >
              {TYP_LABEL[t]}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-500">{TYP_HINWEIS[typ]}</p>

        <div className="flex flex-wrap items-end gap-3">
          {typ === 'preisstabilitaet' && (
            <>
              <Feld label="Mindestjahre"><input type="number" min={1} max={20} value={jahre} onChange={(e) => setJahre(Number(e.target.value))} className={INP} /></Feld>
              <Feld label="Toleranz %"><input type="number" min={0} max={50} value={toleranz} onChange={(e) => setToleranz(Number(e.target.value))} className={INP} /></Feld>
              <ProduktFeld produkte={produkte} value={produktnummer} onChange={setProduktnummer} />
            </>
          )}
          {(typ === 'umsatzveraenderung' || typ === 'mengentrend') && (
            <>
              <Feld label="Jahr von"><JahrSelect jahre={jahreOpt} value={jahrVon} onChange={setJahrVon} /></Feld>
              <Feld label="Jahr bis"><JahrSelect jahre={jahreOpt} value={jahrBis} onChange={setJahrBis} /></Feld>
              <Feld label="Richtung">
                <select className={INP} value={richtung} onChange={(e) => setRichtung(e.target.value as typeof richtung)}>
                  <option value="beide">größte Veränderung</option>
                  <option value="steigerung">nur Steigerung</option>
                  <option value="rueckgang">nur Rückgang</option>
                </select>
              </Feld>
              {typ === 'mengentrend' && (
                <Feld label="je">
                  <select className={INP} value={dimension} onChange={(e) => setDimension(e.target.value as typeof dimension)}>
                    <option value="kunde">Kunde</option>
                    <option value="produkt">Produkt</option>
                  </select>
                </Feld>
              )}
            </>
          )}
          {typ === 'kundenzeitreihe' && (
            <>
              <Feld label="Kunde">
                <select className={`${INP} min-w-[240px]`} value={kundenKey} onChange={(e) => setKundenKey(e.target.value)}>
                  <option value="">— wählen —</option>
                  {(kunden ?? []).map((k) => (
                    <option key={`${k.dataAreaId}|${k.kundennummer}`} value={`${k.dataAreaId}|${k.kundennummer}`}>{k.name} ({k.dataAreaId}/{k.kundennummer})</option>
                  ))}
                </select>
              </Feld>
              <ProduktFeld produkte={produkte} value={produktnummer} onChange={setProduktnummer} />
            </>
          )}
          <Feld label="Währung">
            <select className={INP} value={waehrung} onChange={(e) => setWaehrung(e.target.value)}>
              {waehrungOpt.map((w) => <option key={w} value={w}>{w}</option>)}
            </select>
          </Feld>
          <Button onClick={auswerten} disabled={laedt}>{laedt ? 'Werte aus…' : 'Auswerten'}</Button>
        </div>
        {fehler && <p className="rounded bg-ez-accent/10 p-2 text-sm text-ez-accent">{fehler}</p>}
      </Card>

      {result && (
        <Card>
          <DataTable rows={zeilen} rowKey={(_z, i) => String(i)} columns={spalten} leerText="Keine Treffer für diese Parameter." />
        </Card>
      )}
    </div>
  );
}

const INP = 'rounded border border-gray-300 px-2 py-2 text-sm';

function Feld({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-600">{label}</label>
      {children}
    </div>
  );
}
function JahrSelect({ jahre, value, onChange }: { jahre: number[]; value: number; onChange: (n: number) => void }) {
  return (
    <select className={INP} value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {jahre.map((j) => <option key={j} value={j}>{j}</option>)}
    </select>
  );
}
function ProduktFeld({ produkte, value, onChange }: { produkte?: Produkt[]; value: string; onChange: (s: string) => void }) {
  return (
    <Feld label="Produkt (optional)">
      <select className={`${INP} min-w-[220px]`} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— alle —</option>
        {(produkte ?? []).map((p) => <option key={p.produktnummer} value={p.produktnummer}>{p.produktname ?? p.produktnummer}</option>)}
      </select>
    </Feld>
  );
}
