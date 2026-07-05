import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TenderDokument } from '@prisma/client';
import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { KiConfigService } from '../ki/ki-config.service';
import { TenderAnalyseProvider, type TenderAnalyse, type AnalyseFrage } from './tender-analyse.provider';
import { TenderService } from './tender.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';

const MAX_BYTES = 15 * 1024 * 1024;
const PRIMARY = '0F516A';

/** Vom Nutzer bestätigte/edtierte Übernahme-Daten für die Tender-Anlage. */
export interface UebernahmeInput {
  referenznummer?: string;
  krankenhaus?: string;
  stadt?: string | null;
  landIso?: string | null;
  regionCode?: string | null;
  veroeffentlichtAm?: string | null;
  abgabefrist?: string;
  notiz?: string | null;
  lose?: { bezeichnung: string; menge?: number | null; volumenEur?: number | null }[];
}

@Injectable()
export class TenderAnalyseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly provider: TenderAnalyseProvider,
    private readonly tender: TenderService,
    private readonly config: KiConfigService,
  ) {}

  private toDto(d: TenderDokument) {
    return {
      id: d.id,
      tenderId: d.tenderId,
      dateiname: d.dateiname,
      mimeType: d.mimeType,
      groesseBytes: d.groesseBytes,
      status: d.status,
      analyse: d.analyse as unknown as TenderAnalyse | null,
      llmModell: d.llmModell,
      regionCode: d.regionCode,
      hochgeladenVon: d.hochgeladenVon,
      erstelltAm: d.erstelltAm,
    };
  }

  private async holeEigenes(id: string, aktor: RequestUser): Promise<TenderDokument> {
    const d = await this.prisma.tenderDokument.findUnique({ where: { id } });
    if (!d) throw new NotFoundException('Dokument nicht gefunden.');
    // AGM: nur eigene Uploads (VL/BU/Admin/Support: alle).
    if (aktor.rolle === 'AGM' && d.hochgeladenVonId !== aktor.id) throw new ForbiddenException('Nur eigene Dokumente.');
    return d;
  }

  async liste(aktor: RequestUser) {
    const where: Prisma.TenderDokumentWhereInput = aktor.rolle === 'AGM' ? { hochgeladenVonId: aktor.id } : {};
    const rows = await this.prisma.tenderDokument.findMany({ where, orderBy: { erstelltAm: 'desc' }, take: 30 });
    return rows.map((d) => this.toDto(d));
  }

  async upload(inhalt: Buffer, dateiname: string, mimeType: string, regionCode: string | undefined, aktor: RequestUser) {
    if (!inhalt?.length) throw new BadRequestException('Keine Datei übergeben.');
    if (inhalt.length > MAX_BYTES) throw new BadRequestException('Dokument zu groß (max. 15 MB).');
    const mime = mimeType.split(';')[0].trim().toLowerCase();
    if (!mime.includes('pdf') && mime !== 'text/plain') {
      throw new BadRequestException('Nur PDF (empfohlen) oder Text werden unterstützt. Word-Dateien bitte als PDF exportieren.');
    }
    const d = await this.prisma.tenderDokument.create({
      data: {
        dateiname: dateiname.slice(0, 200),
        mimeType: mime,
        groesseBytes: inhalt.length,
        inhalt,
        regionCode: regionCode?.trim() || null,
        hochgeladenVonId: aktor.id,
        hochgeladenVon: aktor.email,
      },
    });
    await this.audit.write({ entitaet: 'TenderDokument', entitaetId: d.id, aktion: 'CREATE', userId: aktor.id, userEmail: aktor.email, metadaten: { dateiname, bytes: inhalt.length } });
    return this.toDto(d);
  }

  async analysieren(id: string, aktor: RequestUser) {
    const d = await this.holeEigenes(id, aktor);
    const analyse = await this.provider.analysiere(Buffer.from(d.inhalt), d.mimeType);
    const providerName = await this.provider.provider();
    const updated = await this.prisma.tenderDokument.update({
      where: { id },
      data: { status: 'ANALYSIERT', analyse: analyse as unknown as Prisma.InputJsonValue, llmModell: providerName === 'anthropic' ? await this.config.llmModell() : 'mock' },
    });
    await this.audit.write({ entitaet: 'TenderDokument', entitaetId: id, aktion: 'UPDATE', userId: aktor.id, userEmail: aktor.email, metadaten: { schritt: 'ANALYSE', fragen: analyse.fragen.length, lose: analyse.lose.length, zahlen: analyse.zahlen.length } });
    return this.toDto(updated);
  }

  /** Legt aus den vom Nutzer bestätigten Daten einen Tender an und verknüpft das Dokument. */
  async tenderAnlegen(id: string, input: UebernahmeInput, aktor: RequestUser) {
    const d = await this.holeEigenes(id, aktor);
    if (d.status !== 'ANALYSIERT') throw new BadRequestException('Erst analysieren, dann übernehmen.');
    const analyse = d.analyse as unknown as TenderAnalyse | null;
    const neu = await this.tender.erstellen(
      {
        referenznummer: input.referenznummer ?? analyse?.referenznummer ?? undefined,
        krankenhaus: input.krankenhaus ?? analyse?.auftraggeber ?? undefined,
        stadt: input.stadt ?? analyse?.stadt ?? null,
        landIso: input.landIso ?? analyse?.landIso ?? null,
        regionCode: input.regionCode ?? d.regionCode ?? null,
        veroeffentlichtAm: input.veroeffentlichtAm ?? analyse?.veroeffentlichtAm ?? null,
        abgabefrist: input.abgabefrist ?? analyse?.abgabefrist ?? undefined,
        notiz: input.notiz ?? (analyse ? `KI-Analyse (${d.dateiname}): ${analyse.zusammenfassung}`.slice(0, 4000) : null),
        lose: input.lose ?? analyse?.lose?.map((l) => ({ bezeichnung: l.bezeichnung, menge: l.menge, volumenEur: l.volumenEur })) ?? [],
      },
      aktor,
    );
    await this.prisma.tenderDokument.update({ where: { id }, data: { tenderId: neu.id, status: 'UEBERNOMMEN' } });
    await this.audit.write({ entitaet: 'TenderDokument', entitaetId: id, aktion: 'STATUS_WECHSEL', userId: aktor.id, userEmail: aktor.email, nachherWert: { status: 'UEBERNOMMEN', tenderId: neu.id } });
    return { tender: neu, dokumentId: id };
  }

  async verwerfen(id: string, aktor: RequestUser) {
    const d = await this.holeEigenes(id, aktor);
    await this.prisma.tenderDokument.update({ where: { id }, data: { status: 'VERWORFEN' } });
    await this.audit.write({ entitaet: 'TenderDokument', entitaetId: d.id, aktion: 'STATUS_WECHSEL', userId: aktor.id, userEmail: aktor.email, nachherWert: { status: 'VERWORFEN' } });
    return { verworfen: true };
  }

  // ─────────── Antwortentwurf (DOCX) ───────────

  /** Erzeugt den Angebots-/Antwortentwurf; `fragen` = final vom Nutzer geprüfte Antworten. */
  async antwortDocx(id: string, fragen: AnalyseFrage[] | undefined, aktor: RequestUser): Promise<{ dateiname: string; buffer: Buffer }> {
    const d = await this.holeEigenes(id, aktor);
    const analyse = d.analyse as unknown as TenderAnalyse | null;
    if (!analyse) throw new BadRequestException('Erst analysieren.');
    const finaleFragen = (fragen?.length ? fragen : analyse.fragen).slice(0, 100);
    const firmenprofil = await this.config.firmenprofil();

    const h = (text: string) => new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 }, children: [new TextRun({ text, color: PRIMARY, bold: true })] });
    const p = (text: string, opts: { bold?: boolean; italics?: boolean; size?: number } = {}) =>
      new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text, bold: opts.bold, italics: opts.italics, size: opts.size })] });
    const zelle = (text: string, opts: { bold?: boolean; fill?: string } = {}) =>
      new TableCell({ shading: opts.fill ? { fill: opts.fill } : undefined, children: [new Paragraph({ children: [new TextRun({ text, bold: opts.bold })] })] });

    const kern: [string, string][] = [
      ['Referenznummer', analyse.referenznummer ?? '—'],
      ['Auftraggeber', analyse.auftraggeber ?? '—'],
      ['Ort', [analyse.stadt, analyse.landIso].filter(Boolean).join(', ') || '—'],
      ['Veröffentlicht am', analyse.veroeffentlichtAm ?? '—'],
      ['Abgabefrist', analyse.abgabefrist ?? '—'],
      ['Quelldokument', d.dateiname],
    ];

    const doc = new Document({
      styles: { default: { document: { run: { font: 'Arial', size: 22 } } } },
      sections: [
        {
          children: [
            new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: 'Angebots-Entwurf zur Ausschreibung', bold: true, size: 40, color: PRIMARY })] }),
            new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [new TextRun({ text: 'ENTWURF — KI-unterstützt erstellt, vor Einreichung fachlich prüfen', italics: true, size: 20, color: 'AA003C' })] }),

            h('1 · Bieter'),
            ...firmenprofil.split('\n').map((zeileText) => p(zeileText)),

            h('2 · Ausschreibung (Kerndaten)'),
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: kern.map(([k, v]) => new TableRow({ children: [zelle(k, { bold: true, fill: 'F2F2F2' }), zelle(v)] })),
            }),

            h('3 · Zusammenfassung'),
            p(analyse.zusammenfassung || '—'),

            ...(analyse.lose.length
              ? [
                  h('4 · Lose'),
                  new Table({
                    width: { size: 100, type: WidthType.PERCENTAGE },
                    rows: [
                      new TableRow({ children: [zelle('Los', { bold: true, fill: 'F2F2F2' }), zelle('Menge', { bold: true, fill: 'F2F2F2' }), zelle('Volumen (EUR)', { bold: true, fill: 'F2F2F2' })] }),
                      ...analyse.lose.map((l) => new TableRow({ children: [zelle(l.bezeichnung), zelle(l.menge != null ? String(l.menge) : '—'), zelle(l.volumenEur != null ? l.volumenEur.toLocaleString('de-DE') : '—')] })),
                    ],
                  }),
                ]
              : []),

            h(`${analyse.lose.length ? 5 : 4} · Geforderte Angaben & Antworten`),
            p('Antworten sind KI-Vorschläge bzw. im Tool geprüfte Eingaben — leere Felder vor Abgabe ergänzen.', { italics: true, size: 18 }),
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: [
                new TableRow({ children: [zelle('Geforderte Angabe / Frage', { bold: true, fill: 'F2F2F2' }), zelle('Antwort (Entwurf)', { bold: true, fill: 'F2F2F2' }), zelle('Fundstelle', { bold: true, fill: 'F2F2F2' })] }),
                ...finaleFragen.map((f) => new TableRow({ children: [zelle(f.frage), zelle(f.antwortVorschlag || '[ausfüllen]'), zelle(f.quelle || '—')] })),
              ],
            }),

            ...(analyse.nachweise.length
              ? [
                  h(`${analyse.lose.length ? 6 : 5} · Checkliste geforderter Nachweise`),
                  ...analyse.nachweise.map((nw) => p(`☐  ${nw}`)),
                ]
              : []),
          ],
        },
      ],
    });

    const buffer = Buffer.from(await Packer.toBuffer(doc));
    await this.audit.write({ entitaet: 'TenderDokument', entitaetId: id, aktion: 'EXPORT', userId: aktor.id, userEmail: aktor.email, metadaten: { typ: 'ANTWORT_DOCX', fragen: finaleFragen.length } });
    const basis = (analyse.referenznummer ?? d.dateiname.replace(/\.[^.]+$/, '')).replace(/[^\w-]+/g, '_').slice(0, 60);
    return { dateiname: `angebot-entwurf-${basis}.docx`, buffer };
  }
}
