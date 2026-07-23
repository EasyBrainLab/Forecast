'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, blobUrl, downloadDatei } from '@/lib/api';
import { Button, Card, keur } from '@/components/ui';

const MON = ['', 'Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

interface Actuals {
  total: number | null;
  regionen: { regionCode: string; eur: number }[];
}
interface Doc {
  id: string;
  jahr: number;
  monat: number;
  dateiname: string;
  groesseBytes: number;
  mimeType: string;
  actuals: Actuals;
  kommentar: string | null;
  hochgeladenVon: string;
  erstelltAm: string;
  actualsErfasst: boolean;
}

const groesse = (b: number): string => (b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

export default function SalesFlashPage() {
  const { data: docs, isLoading } = useQuery({ queryKey: ['sales-flash-docs'], queryFn: () => api.get<Doc[]>('/sales-flash') });
  const [aktivId, setAktivId] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [laedt, setLaedt] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  // Beim ersten Laden automatisch den neuesten Beleg wählen.
  useEffect(() => {
    if (docs && docs.length > 0 && !aktivId) setAktivId(docs[0].id);
  }, [docs, aktivId]);

  const aktiv = useMemo(() => docs?.find((d) => d.id === aktivId) ?? null, [docs, aktivId]);

  // PDF-Blob (auth-geschützt) laden und als Object-URL im iframe anzeigen.
  useEffect(() => {
    if (!aktivId) {
      setPdfUrl(null);
      return;
    }
    let abgebrochen = false;
    let url: string | null = null;
    setLaedt(true);
    setFehler(null);
    blobUrl(`/sales-flash/${aktivId}/download`)
      .then((r) => {
        if (abgebrochen) {
          URL.revokeObjectURL(r.url);
          return;
        }
        url = r.url;
        setPdfUrl(r.url);
      })
      .catch((e) => {
        if (!abgebrochen) setFehler(e instanceof Error ? e.message : 'Beleg konnte nicht geladen werden.');
      })
      .finally(() => {
        if (!abgebrochen) setLaedt(false);
      });
    return () => {
      abgebrochen = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [aktivId]);

  const actuals = aktiv?.actuals;
  const hatActuals = !!actuals && (actuals.total !== null || actuals.regionen.length > 0);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-ez-primary">Sales-Flash-Belege</h1>
        <p className="text-sm text-gray-500">Die monatlichen Controlling-Belege direkt im Browser ansehen — ohne Download. Monat links wählen.</p>
      </div>

      {isLoading && <p className="text-gray-500">Lädt…</p>}
      {docs && docs.length === 0 && (
        <Card>
          <p className="text-gray-500">Noch keine Sales-Flash-Belege hinterlegt. Belege werden unter „Sales-Flash &amp; Abgleich" hochgeladen.</p>
        </Card>
      )}

      {docs && docs.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
          {/* Monatsliste */}
          <Card className="h-fit p-2">
            <div className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Monate</div>
            <ul className="space-y-0.5">
              {docs.map((d) => (
                <li key={d.id}>
                  <button onClick={() => setAktivId(d.id)} className={`w-full rounded px-2 py-1.5 text-left text-sm ${d.id === aktivId ? 'bg-ez-primary text-white' : 'hover:bg-gray-100'}`}>
                    <div className="font-medium">
                      {MON[d.monat]} {d.jahr}
                    </div>
                    <div className={`text-xs ${d.id === aktivId ? 'text-white/70' : 'text-gray-400'}`}>{d.actualsErfasst ? 'Actuals erfasst' : 'ohne Actuals'}</div>
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          {/* Viewer + Metadaten */}
          <div className="space-y-3">
            {aktiv && (
              <Card className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="font-semibold">
                    {MON[aktiv.monat]} {aktiv.jahr}
                  </div>
                  <div className="truncate text-xs text-gray-500">
                    {aktiv.dateiname} · {groesse(aktiv.groesseBytes)} · hochgeladen von {aktiv.hochgeladenVon}
                  </div>
                </div>
                {hatActuals && actuals && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    {actuals.total !== null && (
                      <div>
                        <span className="text-gray-400">Total </span>
                        <b>{keur(actuals.total)}</b>
                      </div>
                    )}
                    {actuals.regionen.map((r) => (
                      <div key={r.regionCode} className="text-gray-600">
                        <span className="text-gray-400">{r.regionCode} </span>
                        {keur(r.eur)}
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => pdfUrl && window.open(pdfUrl, '_blank', 'noopener')} disabled={!pdfUrl}>
                    Neuer Tab ↗
                  </Button>
                  <Button variant="ghost" onClick={() => downloadDatei(`/sales-flash/${aktiv.id}/download`, 'GET', aktiv.dateiname)}>
                    Download
                  </Button>
                </div>
              </Card>
            )}

            <Card className="overflow-hidden p-0">
              {laedt && <p className="p-4 text-gray-500">PDF wird geladen…</p>}
              {fehler && <p className="p-4 text-ez-accent">{fehler}</p>}
              {pdfUrl && !fehler && <iframe src={pdfUrl} title="Sales-Flash-Beleg" className="h-[80vh] w-full border-0" />}
            </Card>
            {aktiv?.kommentar && <p className="text-sm text-gray-500">Kommentar: {aktiv.kommentar}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
