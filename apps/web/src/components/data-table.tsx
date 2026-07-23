'use client';
import { useMemo, useState, type ReactNode } from 'react';

export interface Column<T> {
  key: string;
  label: string;
  /** Zellinhalt (Default: der Textwert). Darf interaktive Elemente enthalten. */
  render?: (row: T) => ReactNode;
  /** Wert für Sortierung/Textfilter (Default: leer). Bei interaktiven Zellen hier den reinen Text liefern. */
  value?: (row: T) => string | number | null | undefined;
  /** Filtertyp je Spalte. 'select' baut die Auswahl aus den vorkommenden Werten. Default 'text'. */
  filter?: 'text' | 'select' | 'none';
  sortable?: boolean; // Default true
  align?: 'left' | 'right';
  className?: string;
  /** Spalte ist bei Spaltenwahl anfangs ausgeblendet (einblendbar). Nur mit spaltenWahl relevant. */
  standardVersteckt?: boolean;
}

type SortState = { key: string; dir: 'asc' | 'desc' } | null;

const text = (v: string | number | null | undefined): string => (v === null || v === undefined ? '' : String(v));

/**
 * Wiederverwendbare Listen-Tabelle mit Sortierung (Klick auf Spaltenkopf) und Filter je Spalte
 * (Textsuche bzw. Auswahl). Optional globale Suche, dichte (Excel-artige) Darstellung und
 * frei ein-/ausblendbare Spalten (in localStorage gemerkt). Rein clientseitig — für vollständig
 * geladene Datensatz-Listen.
 */
export function DataTable<T>({
  columns,
  rows,
  initialSort,
  leerText = 'Keine Einträge.',
  rowKey,
  globaleSuche = false,
  suchePlaceholder = 'Suche über alle Spalten…',
  dicht = false,
  spaltenWahl = false,
  tabellenId,
}: {
  columns: Column<T>[];
  rows: T[];
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  leerText?: string;
  rowKey: (row: T, index: number) => string;
  globaleSuche?: boolean;
  suchePlaceholder?: string;
  dicht?: boolean;
  /** Blendet einen „Spalten"-Knopf ein, über den der User Spalten ein-/ausblenden kann. */
  spaltenWahl?: boolean;
  /** Schlüssel für die Persistenz der Spaltenauswahl in localStorage (nur mit spaltenWahl). */
  tabellenId?: string;
}) {
  const [sort, setSort] = useState<SortState>(initialSort ?? null);
  const [filter, setFilter] = useState<Record<string, string>>({});
  const [suche, setSuche] = useState('');
  const [versteckt, setVersteckt] = useState<Set<string>>(() => {
    if (typeof window !== 'undefined' && tabellenId) {
      try {
        const raw = window.localStorage.getItem(`dt-cols-${tabellenId}`);
        if (raw) return new Set(JSON.parse(raw) as string[]);
      } catch {
        /* ungültiger localStorage-Wert */
      }
    }
    return new Set(columns.filter((c) => c.standardVersteckt).map((c) => c.key));
  });

  const val = (col: Column<T>, row: T): string | number | null | undefined => (col.value ? col.value(row) : undefined);
  const sicht = useMemo(() => (spaltenWahl ? columns.filter((c) => !versteckt.has(c.key)) : columns), [columns, versteckt, spaltenWahl]);

  const toggleSpalte = (key: string) => {
    setVersteckt((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      if (typeof window !== 'undefined' && tabellenId) {
        try {
          window.localStorage.setItem(`dt-cols-${tabellenId}`, JSON.stringify([...next]));
        } catch {
          /* localStorage nicht verfügbar */
        }
      }
      return next;
    });
  };

  const optionen = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const col of sicht) {
      if (col.filter !== 'select') continue;
      const set = new Set<string>();
      for (const r of rows) {
        const t = text(val(col, r));
        if (t) set.add(t);
      }
      out[col.key] = [...set].sort((a, b) => a.localeCompare(b, 'de'));
    }
    return out;
  }, [sicht, rows]);

  const gefiltert = useMemo(() => {
    let data = rows;
    if (suche.trim()) {
      const q = suche.trim().toLowerCase();
      data = data.filter((r) => sicht.some((c) => text(val(c, r)).toLowerCase().includes(q)));
    }
    for (const col of sicht) {
      const f = filter[col.key];
      if (!f) continue;
      if (col.filter === 'select') data = data.filter((r) => text(val(col, r)) === f);
      else {
        const q = f.toLowerCase();
        data = data.filter((r) => text(val(col, r)).toLowerCase().includes(q));
      }
    }
    if (sort) {
      const col = sicht.find((c) => c.key === sort.key);
      if (col) {
        const factor = sort.dir === 'asc' ? 1 : -1;
        data = [...data].sort((a, b) => {
          const av = val(col, a);
          const bv = val(col, b);
          if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * factor;
          return text(av).localeCompare(text(bv), 'de', { numeric: true }) * factor;
        });
      }
    }
    return data;
  }, [rows, sicht, filter, sort, suche]);

  const toggleSort = (col: Column<T>) => {
    if (col.sortable === false) return;
    setSort((s) => (s?.key !== col.key ? { key: col.key, dir: 'asc' } : s.dir === 'asc' ? { key: col.key, dir: 'desc' } : null));
  };
  const aktiveFilter = Object.values(filter).filter(Boolean).length + (suche.trim() ? 1 : 0);
  const pad = dicht ? 'px-1.5 py-0.5' : 'py-2 pr-3';
  const size = dicht ? 'text-xs' : 'text-sm';

  return (
    <div className="space-y-1">
      {(globaleSuche || spaltenWahl) && (
        <div className="flex items-center gap-2">
          {globaleSuche && (
            <input
              className="w-full max-w-md rounded border border-gray-300 px-2 py-1 text-sm"
              placeholder={suchePlaceholder}
              value={suche}
              onChange={(e) => setSuche(e.target.value)}
            />
          )}
          {spaltenWahl && (
            <details className="relative ml-auto shrink-0">
              <summary className="cursor-pointer list-none rounded border border-gray-300 bg-white px-3 py-1 text-sm text-gray-700 hover:bg-gray-50">
                ⚙ Spalten ({sicht.length}/{columns.length})
              </summary>
              <div className="absolute right-0 z-30 mt-1 max-h-80 w-56 overflow-auto rounded border border-gray-200 bg-white p-2 shadow-lg">
                {columns.map((c) => (
                  <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-gray-50">
                    <input type="checkbox" checked={!versteckt.has(c.key)} onChange={() => toggleSpalte(c.key)} />
                    <span className="truncate">{c.label}</span>
                  </label>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
      <div className="flex items-center justify-between text-xs text-gray-400">
        <span>
          {gefiltert.length}
          {gefiltert.length !== rows.length ? ` von ${rows.length}` : ''} Einträge
        </span>
        {aktiveFilter > 0 && (
          <button
            className="text-ez-primary hover:underline"
            onClick={() => {
              setFilter({});
              setSuche('');
            }}
          >
            Filter zurücksetzen
          </button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className={`w-full ${size} tabular-nums`}>
          <thead>
            <tr className="border-b border-gray-200 text-left text-gray-500">
              {sicht.map((col) => {
                const aktiv = sort?.key === col.key;
                return (
                  <th
                    key={col.key}
                    className={`${pad} ${col.align === 'right' ? 'text-right' : ''} ${col.sortable === false ? '' : 'cursor-pointer select-none'} ${dicht ? 'whitespace-nowrap' : ''}`}
                    onClick={() => toggleSort(col)}
                  >
                    {col.label}
                    {col.sortable !== false && <span className="ml-1 text-gray-400">{aktiv ? (sort!.dir === 'asc' ? '▲' : '▼') : '↕'}</span>}
                  </th>
                );
              })}
            </tr>
            <tr className="border-b border-gray-100">
              {sicht.map((col) => (
                <th key={col.key} className={`${dicht ? 'px-1.5 pb-1' : 'pb-2 pr-3'} font-normal`}>
                  {col.filter === 'none' ? null : col.filter === 'select' ? (
                    <select
                      className="w-full rounded border border-gray-200 px-1 py-0.5 text-xs font-normal"
                      value={filter[col.key] ?? ''}
                      onChange={(e) => setFilter((f) => ({ ...f, [col.key]: e.target.value }))}
                    >
                      <option value="">Alle</option>
                      {(optionen[col.key] ?? []).map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="w-full rounded border border-gray-200 px-1 py-0.5 text-xs font-normal"
                      placeholder="Filter…"
                      value={filter[col.key] ?? ''}
                      onChange={(e) => setFilter((f) => ({ ...f, [col.key]: e.target.value }))}
                    />
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {gefiltert.map((row, i) => (
              <tr key={rowKey(row, i)} className={`border-b border-gray-100 align-top ${dicht ? 'hover:bg-gray-50' : ''}`}>
                {sicht.map((col) => (
                  <td key={col.key} className={`${pad} ${col.align === 'right' ? 'text-right tabular-nums' : ''} ${dicht ? 'whitespace-nowrap' : ''} ${col.className ?? ''}`}>
                    {col.render ? col.render(row) : text(val(col, row))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {gefiltert.length === 0 && <p className="py-3 text-sm text-gray-500">{rows.length === 0 ? leerText : 'Keine Treffer für die aktuellen Filter.'}</p>}
      </div>
    </div>
  );
}
