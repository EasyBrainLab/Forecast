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
}

type SortState = { key: string; dir: 'asc' | 'desc' } | null;

const text = (v: string | number | null | undefined): string => (v === null || v === undefined ? '' : String(v));

/**
 * Wiederverwendbare Listen-Tabelle mit Sortierung (Klick auf Spaltenkopf) und Filter je Spalte
 * (Textsuche bzw. Auswahl). Rein clientseitig — für vollständig geladene Datensatz-Listen.
 */
export function DataTable<T>({
  columns,
  rows,
  initialSort,
  leerText = 'Keine Einträge.',
  rowKey,
}: {
  columns: Column<T>[];
  rows: T[];
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  leerText?: string;
  rowKey: (row: T, index: number) => string;
}) {
  const [sort, setSort] = useState<SortState>(initialSort ?? null);
  const [filter, setFilter] = useState<Record<string, string>>({});

  const val = (col: Column<T>, row: T): string | number | null | undefined => (col.value ? col.value(row) : undefined);

  const optionen = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const col of columns) {
      if (col.filter !== 'select') continue;
      const set = new Set<string>();
      for (const r of rows) { const t = text(val(col, r)); if (t) set.add(t); }
      out[col.key] = [...set].sort((a, b) => a.localeCompare(b, 'de'));
    }
    return out;
  }, [columns, rows]);

  const gefiltert = useMemo(() => {
    let data = rows;
    for (const col of columns) {
      const f = filter[col.key];
      if (!f) continue;
      if (col.filter === 'select') data = data.filter((r) => text(val(col, r)) === f);
      else { const q = f.toLowerCase(); data = data.filter((r) => text(val(col, r)).toLowerCase().includes(q)); }
    }
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      if (col) {
        const factor = sort.dir === 'asc' ? 1 : -1;
        data = [...data].sort((a, b) => {
          const av = val(col, a); const bv = val(col, b);
          if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * factor;
          return text(av).localeCompare(text(bv), 'de', { numeric: true }) * factor;
        });
      }
    }
    return data;
  }, [rows, columns, filter, sort]);

  const toggleSort = (col: Column<T>) => {
    if (col.sortable === false) return;
    setSort((s) => (s?.key !== col.key ? { key: col.key, dir: 'asc' } : s.dir === 'asc' ? { key: col.key, dir: 'desc' } : null));
  };
  const aktiveFilter = Object.values(filter).filter(Boolean).length;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs text-gray-400">
        <span>{gefiltert.length}{gefiltert.length !== rows.length ? ` von ${rows.length}` : ''} Einträge</span>
        {aktiveFilter > 0 && (
          <button className="text-ez-primary hover:underline" onClick={() => setFilter({})}>Filter zurücksetzen</button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-gray-500">
              {columns.map((col) => {
                const aktiv = sort?.key === col.key;
                return (
                  <th key={col.key} className={`py-2 pr-3 ${col.align === 'right' ? 'text-right' : ''} ${col.sortable === false ? '' : 'cursor-pointer select-none'}`} onClick={() => toggleSort(col)}>
                    {col.label}
                    {col.sortable !== false && <span className="ml-1 text-gray-400">{aktiv ? (sort!.dir === 'asc' ? '▲' : '▼') : '↕'}</span>}
                  </th>
                );
              })}
            </tr>
            <tr className="border-b border-gray-100">
              {columns.map((col) => (
                <th key={col.key} className="pb-2 pr-3 font-normal">
                  {col.filter === 'none' ? null : col.filter === 'select' ? (
                    <select className="w-full rounded border border-gray-200 px-1 py-1 text-xs font-normal" value={filter[col.key] ?? ''} onChange={(e) => setFilter((f) => ({ ...f, [col.key]: e.target.value }))}>
                      <option value="">Alle</option>
                      {(optionen[col.key] ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input className="w-full rounded border border-gray-200 px-1 py-1 text-xs font-normal" placeholder="Filter…" value={filter[col.key] ?? ''} onChange={(e) => setFilter((f) => ({ ...f, [col.key]: e.target.value }))} />
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {gefiltert.map((row, i) => (
              <tr key={rowKey(row, i)} className="border-b border-gray-100 align-top">
                {columns.map((col) => (
                  <td key={col.key} className={`py-2 pr-3 ${col.align === 'right' ? 'text-right tabular-nums' : ''} ${col.className ?? ''}`}>
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
