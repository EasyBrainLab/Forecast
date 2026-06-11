import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';
import { DashboardService } from '../dashboard/dashboard.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';

// E&Z-CI
const PRIMARY = '0F516A';
const ACCENT = 'AA003C';
const GRUEN = '1E7B34';

const keur = (eur: number): number => Math.round((eur / 1000) * 10) / 10;

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
