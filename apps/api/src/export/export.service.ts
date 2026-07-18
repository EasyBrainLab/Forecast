import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';
import { DashboardService } from '../dashboard/dashboard.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';

// E&Z-CI
const PRIMARY = '0F516A';
const ACCENT = 'AA003C';
const GRUEN = '1E7B34';

// Gruppenfarben der App-Konsolidierungssicht (Actual grau, Forecast gelb, FY lila).
const ACTUAL_BG = 'E5E7EB';
const FORECAST_BG = 'FEF3C7';
const FY_BG = 'EDE9FE';
const KOPF_BG = 'F3F4F6';

const keur = (eur: number): number => Math.round((eur / 1000) * 10) / 10;

// Anzeige in vollen kEUR (wie die App: Werte in Tausend EUR, Rundung übernimmt das Zellformat).
const kEurWert = (eur: number): number => eur / 1000;
const MON_KURZ = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const monatNr = (periode: string): number => Number(periode.slice(5));

@Injectable()
export class ExportService {
  constructor(private readonly dashboard: DashboardService) {}

  /** Excel-Abweichungsbericht (kEUR, Farblogik, fixierte Kopfzeile) — Layout-Referenz Konsolidierungsdatei. */
  async abweichungsbericht(jahr: number, aktor: RequestUser): Promise<Buffer> {
    const k = await this.dashboard.konsolidierung(jahr, aktor);
    const schwelle = 10;
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Forecast-Portal';
    const ws = wb.addWorksheet(`Abweichung ${jahr}`, { views: [{ state: 'frozen', ySplit: 3 }] });

    ws.mergeCells('A1:G1');
    ws.getCell('A1').value = `Forecast-Portal BU Brachytherapie — Abweichungsbericht ${jahr} (kEUR)`;
    ws.getCell('A1').font = { bold: true, size: 14, color: { argb: `FF${PRIMARY}` } };
    ws.getCell('A2').value = `Stichtag: ${k.stichtag}`;

    const header = ['Region', 'Ist YTD', 'Forecast Rest', 'YEE', 'Budget', '∆ Bud (abs)', '∆ Bud (%)'];
    const hr = ws.addRow(header);
    hr.eachCell((c) => {
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${PRIMARY}` } };
    });

    for (const z of k.zeilen) {
      const row = ws.addRow([z.bezeichnung, keur(z.istYtd), keur(z.forecastRest), keur(z.yee), keur(z.budget), keur(z.abweichungEur), z.abweichungProzent]);
      const pctCell = row.getCell(7);
      pctCell.numFmt = '0.0"%"';
      if (z.abweichungProzent !== null) {
        if (z.abweichungProzent >= schwelle) pctCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${GRUEN}` } };
        else if (z.abweichungProzent <= -schwelle) pctCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${ACCENT}` } };
      }
      for (let i = 2; i <= 6; i++) row.getCell(i).numFmt = '#,##0.0;[Red]-#,##0.0';
    }
    const g = k.gesamt;
    const totalRow = ws.addRow(['BU-Gesamt', keur(g.istYtd), keur(g.forecastRest), keur(g.yee), keur(g.budget), keur(g.abweichungEur), null]);
    totalRow.eachCell((c) => (c.font = { bold: true }));
    ws.columns.forEach((col) => (col.width = 16));

    const arr = await wb.xlsx.writeBuffer();
    return Buffer.from(arr);
  }

  /**
   * Excel-Export der konsolidierten Monatssicht je Produktgruppe — Layout und Kennzahlen 1:1 wie die
   * App-Sicht (/konsolidierung): 2-zeiliger Gruppen-Header Actual / Forecast / FY, Monatsspalten,
   * ∑-Spalten, BUD & Δ-Spalten, Summenzeile „Umsatz". Werte in kEUR.
   */
  async konsolidierungMonatlichXlsx(jahr: number, aktor: RequestUser): Promise<Buffer> {
    const k = await this.dashboard.konsolidierungMonatlich(jahr, aktor);
    const jj = String(k.jahr).slice(2, 4);
    const istMonate = k.monate.filter((p) => monatNr(p) < k.restAbMonat);
    const fcMonate = k.monate.filter((p) => monatNr(p) >= k.restAbMonat);

    // Kennzahlen je Produktgruppe — identische Logik wie die App-Sicht.
    const metrik = (z: (typeof k.zeilen)[number]) => {
      const summeActual = istMonate.reduce((s, p) => s + (z.istMonate[p] ?? 0), 0);
      const summeForecast = fcMonate.reduce((s, p) => s + (z.forecastMonate[p] ?? 0), 0);
      const bud = k.monate.reduce((s, p) => s + (z.budgetMonate[p] ?? 0), 0);
      const budRest = fcMonate.reduce((s, p) => s + (z.budgetMonate[p] ?? 0), 0);
      const actBud = summeActual + budRest;
      const actFc = summeActual + summeForecast;
      return { summeActual, summeForecast, bud, actBud, actFc, dBudActBud: actBud - bud, dBudActFc: actFc - bud };
    };

    // Spalten-Layout: 1 Produktgruppe | N Ist-Monate | ∑ Actual | M FC-Monate | ∑ Forecast | 5× FY.
    const N = istMonate.length;
    const M = fcMonate.length;
    const cSumActual = 2 + N;
    const cFcStart = 3 + N;
    const cSumForecast = 3 + N + M;
    const cBud = 4 + N + M;
    const cLast = 8 + N + M;

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Forecast-Portal';
    const ws = wb.addWorksheet(`Konsolidierung ${jahr}`, { views: [{ state: 'frozen', xSplit: 1, ySplit: 3 }] });

    // Zeile 1: Titel über die gesamte Breite.
    ws.mergeCells(1, 1, 1, cLast);
    ws.getCell(1, 1).value = `Konsolidierung ${jahr} — Monatssicht je Produktgruppe (kEUR) · Stichtag ${k.stichtag}`;
    ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: `FF${PRIMARY}` } };

    // Zeile 2: Gruppen-Header Actual / Forecast / FY.
    const gruppe = (left: number, right: number, text: string, bg: string) => {
      if (right > left) ws.mergeCells(2, left, 2, right);
      const c = ws.getCell(2, left);
      c.value = text;
      c.alignment = { horizontal: 'center' };
      c.font = { bold: true, color: { argb: `FF${PRIMARY}` } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${bg}` } };
    };
    gruppe(2, cSumActual, 'Actual', ACTUAL_BG);
    gruppe(cFcStart, cSumForecast, 'Forecast', FORECAST_BG);
    gruppe(cBud, cLast, `FY 20${jj}`, FY_BG);

    // Zeile 3: Spaltenköpfe.
    const kopf: string[] = ['Produktgruppe'];
    for (const p of istMonate) kopf.push(`${MON_KURZ[monatNr(p) - 1]}. ${jj}`);
    kopf.push('∑ Actual');
    for (const p of fcMonate) kopf.push(`${MON_KURZ[monatNr(p) - 1]}. ${jj}`);
    kopf.push('∑ Forecast', 'BUD', 'Actual+BUD', 'Actual+FC', 'ΔBud/Act+Bud', 'ΔBud/Act+FC');
    const hr = ws.getRow(3);
    kopf.forEach((text, i) => {
      const c = hr.getCell(i + 1);
      c.value = text;
      c.font = { bold: true };
      c.alignment = { horizontal: i === 0 ? 'left' : 'right' };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${KOPF_BG}` } };
    });
    hr.commit();

    const NUM = '#,##0';
    const DELTA = '#,##0';
    // Setzt eine kEUR-Zahlzelle; leere Monatszellen (Wert 0) bleiben — wie in der App — leer.
    const setNum = (row: ExcelJS.Row, col: number, eur: number, opts?: { fmt?: string; bold?: boolean; delta?: boolean; leerBei0?: boolean; bg?: string }) => {
      const c = row.getCell(col);
      c.numFmt = opts?.fmt ?? NUM;
      c.alignment = { horizontal: 'right' };
      if (opts?.bold) c.font = { ...(c.font ?? {}), bold: true };
      if (opts?.bg) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${opts.bg}` } };
      if (opts?.leerBei0 && eur === 0) {
        c.value = null;
        return;
      }
      c.value = kEurWert(eur);
      if (opts?.delta) c.font = { ...(c.font ?? {}), color: { argb: `FF${eur >= 0 ? GRUEN : ACCENT}` } };
    };

    // Datenzeilen je Produktgruppe.
    for (const z of k.zeilen) {
      const row = ws.addRow([]);
      row.getCell(1).value = z.bezeichnung;
      row.getCell(1).font = { bold: true };
      const m = metrik(z);
      istMonate.forEach((p, i) => setNum(row, 2 + i, z.istMonate[p] ?? 0, { leerBei0: true }));
      setNum(row, cSumActual, m.summeActual, { bold: true, bg: ACTUAL_BG });
      fcMonate.forEach((p, i) => setNum(row, cFcStart + i, z.forecastMonate[p] ?? 0, { leerBei0: true }));
      setNum(row, cSumForecast, m.summeForecast, { bold: true, bg: FORECAST_BG });
      setNum(row, cBud, m.bud, { bg: FY_BG });
      setNum(row, cBud + 1, m.actBud);
      setNum(row, cBud + 2, m.actFc, { bold: true });
      setNum(row, cBud + 3, m.dBudActBud, { fmt: DELTA, delta: true });
      setNum(row, cBud + 4, m.dBudActFc, { fmt: DELTA, delta: true });
    }

    // Summenzeile „Umsatz" über alle Produktgruppen.
    const acc = { summeActual: 0, summeForecast: 0, bud: 0, actBud: 0, actFc: 0, dBudActBud: 0, dBudActFc: 0 };
    const istSum: Record<string, number> = Object.fromEntries(istMonate.map((p) => [p, 0]));
    const fcSum: Record<string, number> = Object.fromEntries(fcMonate.map((p) => [p, 0]));
    for (const z of k.zeilen) {
      for (const p of istMonate) istSum[p] += z.istMonate[p] ?? 0;
      for (const p of fcMonate) fcSum[p] += z.forecastMonate[p] ?? 0;
      const m = metrik(z);
      acc.summeActual += m.summeActual;
      acc.summeForecast += m.summeForecast;
      acc.bud += m.bud;
      acc.actBud += m.actBud;
      acc.actFc += m.actFc;
      acc.dBudActBud += m.dBudActBud;
      acc.dBudActFc += m.dBudActFc;
    }
    const sumRow = ws.addRow([]);
    sumRow.getCell(1).value = 'Umsatz';
    istMonate.forEach((p, i) => setNum(sumRow, 2 + i, istSum[p]));
    setNum(sumRow, cSumActual, acc.summeActual);
    fcMonate.forEach((p, i) => setNum(sumRow, cFcStart + i, fcSum[p]));
    setNum(sumRow, cSumForecast, acc.summeForecast);
    setNum(sumRow, cBud, acc.bud);
    setNum(sumRow, cBud + 1, acc.actBud);
    setNum(sumRow, cBud + 2, acc.actFc);
    setNum(sumRow, cBud + 3, acc.dBudActBud, { fmt: DELTA, delta: true });
    setNum(sumRow, cBud + 4, acc.dBudActFc, { fmt: DELTA, delta: true });
    sumRow.eachCell((c) => (c.font = { ...(c.font ?? {}), bold: true }));
    sumRow.getCell(1).border = { top: { style: 'medium' } };

    // Spaltenbreiten.
    ws.getColumn(1).width = 24;
    for (let col = 2; col <= cLast; col++) ws.getColumn(col).width = col >= cBud + 3 ? 14 : 10;

    const arr = await wb.xlsx.writeBuffer();
    return Buffer.from(arr);
  }

  /** Word-Report im E&Z-CI (Arial, Primärblau/Akzentrot). */
  async wordReport(jahr: number, aktor: RequestUser): Promise<Buffer> {
    const k = await this.dashboard.konsolidierung(jahr, aktor);

    const zelle = (text: string, opts?: { bold?: boolean; color?: string }): TableCell =>
      new TableCell({ children: [new Paragraph({ children: [new TextRun({ text, bold: opts?.bold, color: opts?.color, font: 'Arial' })] })] });

    const headerRow = new TableRow({
      children: ['Region', 'Ist YTD (kEUR)', 'YEE (kEUR)', 'Budget (kEUR)', '∆ %'].map(
        (t) => new TableCell({ shading: { fill: PRIMARY }, children: [new Paragraph({ children: [new TextRun({ text: t, bold: true, color: 'FFFFFF', font: 'Arial' })] })] }),
      ),
    });
    const dataRows = k.zeilen.map(
      (z) =>
        new TableRow({
          children: [
            zelle(z.bezeichnung),
            zelle(String(keur(z.istYtd))),
            zelle(String(keur(z.yee))),
            zelle(String(keur(z.budget))),
            zelle(z.abweichungProzent === null ? '—' : `${z.abweichungProzent}`, { color: (z.abweichungProzent ?? 0) < -10 ? ACCENT : undefined }),
          ],
        }),
    );
    const totalRow = new TableRow({
      children: [zelle('BU-Gesamt', { bold: true }), zelle(String(keur(k.gesamt.istYtd)), { bold: true }), zelle(String(keur(k.gesamt.yee)), { bold: true }), zelle(String(keur(k.gesamt.budget)), { bold: true }), zelle('', { bold: true })],
    });

    const doc = new Document({
      creator: 'Forecast-Portal',
      title: `Forecast-Report ${jahr}`,
      sections: [
        {
          children: [
            new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.LEFT, children: [new TextRun({ text: `Forecast-Report ${jahr}`, color: PRIMARY, bold: true, font: 'Arial', size: 40 })] }),
            new Paragraph({ children: [new TextRun({ text: `BU Brachytherapie — Eckert & Ziegler. Stichtag ${k.stichtag}.`, font: 'Arial' })] }),
            new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: 'Management-Summary', color: PRIMARY, font: 'Arial' })] }),
            new Paragraph({ children: [new TextRun({ text: `Ist YTD ${keur(k.gesamt.istYtd)} kEUR, YEE ${keur(k.gesamt.yee)} kEUR, Budget ${keur(k.gesamt.budget)} kEUR.`, font: 'Arial' })] }),
            new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...dataRows, totalRow] }),
            new Paragraph({ children: [new TextRun({ text: 'Automatisch erzeugt — bereinigte und unbereinigte Sicht auf Anfrage.', italics: true, font: 'Arial', size: 16 })] }),
          ],
        },
      ],
    });
    return Packer.toBuffer(doc);
  }

  /** Rohdaten-Export (CSV, UTF-8 mit BOM, ; -Separator, deutsches Dezimal). */
  async rohdatenCsv(jahr: number, aktor: RequestUser): Promise<Buffer> {
    const k = await this.dashboard.konsolidierung(jahr, aktor);
    const de = (n: number): string => n.toFixed(2).replace('.', ',');
    const zeilen = [
      'Region;Ist YTD;Forecast Rest;YEE;Budget;Abweichung EUR;Abweichung %',
      ...k.zeilen.map((z) => `${z.bezeichnung};${de(z.istYtd)};${de(z.forecastRest)};${de(z.yee)};${de(z.budget)};${de(z.abweichungEur)};${z.abweichungProzent === null ? '' : de(z.abweichungProzent)}`),
    ];
    return Buffer.from('﻿' + zeilen.join('\r\n'), 'utf-8');
  }
}
