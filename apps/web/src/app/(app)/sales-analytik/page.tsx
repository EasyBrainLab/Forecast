'use client';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { Button, Card } from '@/components/ui';

type Typ = 'preisstabilitaet' | 'umsatzveraenderung' | 'kundenzeitreihe' | 'mengentrend';

const TYP_LABEL: Record<Typ, string> = {
  preisstabilitaet: 'Preisstabilität',
  umsatzveraenderung: 'Umsatzveränderung',
  kundenzeitreihe: 'Kunden-Zeitreihe',
  mengentrend: 'Mengentrend',
};
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

  const { data: opt } = useQuery({ queryKey: ['analytik-opt'], queryFn: () => api.get<FilterOpt>('/sales-analytik/filteroptionen') });
  const { data: kunden } = useQuery({ queryKey: ['analytik-kunden'], queryFn: () => api.get<Kunde[]>('/sales-analytik/kunden') });
  const { data: produkte } = useQuery({ queryKey: ['analytik-produkte'], queryFn: () => api.get<Produkt[]>('/sales-analytik/produkte') });
  const jahreOpt = opt?.jahre ?? [2026, 2025, 2024, 2023, 2022, 2021, 2020];
  const waehrungOpt = opt?.waehrungen.map((w) => w.waehrung) ?? ['EUR'];

  const auswerten = async () => {
    setFehler('');
    setLaedt(true);
    setResult(null);
    try {
      let url = '';
      const w = `waehrung=${waehrung}`;
      if (typ === 'preisstabilitaet') url = `/sales-analytik/preisstabilitaet?jahre=${jahre}&toleranzProzent=${toleranz}&${w}${produktnummer ? `&produktnummer=${encodeURIComponent(produktnummer)}` : ''}`;
      else if (typ === 'umsatzveraenderung') url = `/sales-analytik/umsatzveraenderung?jahrVon=${jahrVon}&jahrBis=${jahrBis}&richtung=${richtung}&${w}`;
      else if (typ === 'mengentrend') url = `/sales-analytik/mengentrend?jahrVon=${jahrVon}&jahrBis=${jahrBis}&dimension=${dimension}&richtung=${richtung}&${w}`;
      else {
        if (!kundenKey) { setFehler('Bitte einen Kunden wählen.'); setLaedt(false); return; }
        const [da, nr] = kundenKey.split('|');
        url = `/sales-analytik/kundenzeitreihe?dataAreaId=${encodeURIComponent(da)}&kundennummer=${encodeURIComponent(nr)}&${w}${produktnummer ? `&produktnummer=${encodeURIComponent(produktnummer)}` : ''}`;
      }
      const res = await api.get<{ zeilen: Record<string, unknown>[]; parameter: Record<string, unknown> }>(url);
      setResult(res);
    } catch (e) {
      setFehler(e instanceof ApiError ? e.message : 'Auswertung fehlgeschlagen.');
    } finally {
      setLaedt(false);
    }
  };

  const zeilen = result?.zeilen ?? [];
  const kopf = useMemo<{ label: string; render: (z: Record<string, unknown>) => string; right?: boolean }[]>(() => {
    if (typ === 'preisstabilitaet') return [
      { label: 'Kunde', render: (z) => (z.kundenname as string) ?? (z.kundennummer as string) },
      { label: 'Produkt', render: (z) => (z.produktname as string) ?? (z.produktnummer as string) },
      { label: 'Preis', render: (z) => num(z.preis as number, 2), right: true },
      { label: 'Jahre', render: (z) => num(z.jahreSpanne as number, 1), right: true },
      { label: 'Rechnungen', render: (z) => num(z.anzahlRechnungen as number), right: true },
      { label: 'von', render: (z) => dat(z.ersteRechnung as string) },
      { label: 'bis', render: (z) => dat(z.letzteRechnung as string) },
    ];
    if (typ === 'umsatzveraenderung') return [
      { label: 'Kunde', render: (z) => (z.kundenname as string) ?? (z.kundennummer as string) },
      { label: `Umsatz ${jahrVon} (kEUR)`, render: (z) => keur(z.umsatzVon as number), right: true },
      { label: `Umsatz ${jahrBis} (kEUR)`, render: (z) => keur(z.umsatzBis as number), right: true },
      { label: 'Δ (kEUR)', render: (z) => keur(z.deltaEur as number), right: true },
      { label: 'Δ %', render: (z) => pct(z.deltaProzent as number | null), right: true },
    ];
    if (typ === 'mengentrend') return [
      { label: dimension === 'produkt' ? 'Produkt' : 'Kunde', render: (z) => (z.label as string) ?? (z.schluessel as string) },
      { label: `Menge ${jahrVon}`, render: (z) => num(z.mengeVon as number), right: true },
      { label: `Menge ${jahrBis}`, render: (z) => num(z.mengeBis as number), right: true },
      { label: 'Δ Menge', render: (z) => num(z.deltaMenge as number), right: true },
      { label: 'Δ %', render: (z) => pct(z.deltaProzent as number | null), right: true },
    ];
    return [
      { label: 'Jahr', render: (z) => String(z.jahr) },
      { label: 'Umsatz (kEUR)', render: (z) => keur(z.umsatz as number), right: true },
      { label: 'Menge', render: (z) => num(z.menge as number), right: true },
      { label: 'Ø-Preis', render: (z) => num(z.durchschnittspreis as number | null, 2), right: true },
    ];
  }, [typ, jahrVon, jahrBis, dimension]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-ez-primary">Sales-Analytik</h1>
        <p className="text-sm text-gray-500">Kundenscharfe Auswertungen aus den D365-Rechnungsdaten. Beträge in kEUR; je Auswertung eine Währung (keine Vermischung). Umsatz ist netto inkl. Gutschriften.</p>
      </div>

      <Card className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(TYP_LABEL) as Typ[]).map((t) => (
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
          <div className="mb-2 text-xs text-gray-500">{zeilen.length} Zeile(n)</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-gray-500">
                  {kopf.map((c) => <th key={c.label} className={`py-2 pr-3 ${c.right ? 'text-right' : ''}`}>{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {zeilen.map((z, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    {kopf.map((c) => <td key={c.label} className={`py-1.5 pr-3 ${c.right ? 'text-right tabular-nums' : ''}`}>{c.render(z)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            {zeilen.length === 0 && <p className="py-3 text-gray-500">Keine Treffer für diese Parameter.</p>}
          </div>
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
