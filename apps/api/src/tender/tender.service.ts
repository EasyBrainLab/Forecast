import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TenderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ScopeService } from '../scope/scope.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';

export interface LosInput {
  bezeichnung: string;
  volumenEur?: number | null;
  menge?: number | null;
}

/** Felder, die ein Nutzer setzen darf (Whitelist-PATCH; nie status/erstellerId/timestamps aus dem Body). */
export interface TenderInput {
  referenznummer?: string;
  krankenhaus?: string;
  stadt?: string | null;
  landIso?: string | null;
  regionCode?: string | null;
  veroeffentlichtAm?: string | null;
  abgabefrist?: string;
  wettbewerber?: string[];
  eigenerPreisEur?: number | null;
  wettbewerbPreisEur?: number | null;
  notiz?: string | null;
  lose?: LosInput[];
}

const STATUS_WERTE: readonly TenderStatus[] = ['BEOBACHTET', 'EINGEREICHT', 'GEWONNEN', 'VERLOREN', 'STORNIERT'];

const dec = (d: Prisma.Decimal | null): number | null => (d == null ? null : Number(d));

@Injectable()
export class TenderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
  ) {}

  // ─────────── Helfer ───────────

  private parseDatum(wert: string | null | undefined, feld: string, pflicht = false): Date | null {
    if (wert == null || wert === '') {
      if (pflicht) throw new BadRequestException(`${feld} ist erforderlich.`);
      return null;
    }
    const d = new Date(wert);
    if (Number.isNaN(d.getTime())) throw new BadRequestException(`${feld} ist kein gültiges Datum.`);
    return d;
  }

  private sanitizeWettbewerber(items: unknown): string[] {
    if (!Array.isArray(items)) return [];
    return [...new Set(items.map((s) => String(s ?? '').trim()).filter(Boolean).map((s) => s.slice(0, 120)))].slice(0, 30);
  }

  private sanitizeLose(items: unknown): { bezeichnung: string; volumenEur: number | null; menge: number | null }[] {
    if (!Array.isArray(items)) return [];
    return items
      .map((it) => {
        const o = it as Record<string, unknown>;
        const bezeichnung = String(o.bezeichnung ?? '').trim();
        if (!bezeichnung) return null;
        const zahl = (v: unknown): number | null => {
          if (v == null || v === '') return null;
          const n = Number(v);
          return Number.isFinite(n) ? n : null;
        };
        return { bezeichnung: bezeichnung.slice(0, 200), volumenEur: zahl(o.volumenEur), menge: zahl(o.menge) };
      })
      .filter((x): x is { bezeichnung: string; volumenEur: number | null; menge: number | null } => x !== null)
      .slice(0, 50);
  }

  /** Lese-Filter (fail-closed): AGM -> eigene Regionen, sonst unbeschränkt. */
  private async leseWhere(aktor: RequestUser): Promise<Prisma.TenderWhereInput> {
    const scope = await this.scope.getScope(aktor);
    return this.scope.regionWhere(scope) as Prisma.TenderWhereInput;
  }

  private toDto(t: Prisma.TenderGetPayload<{ include: { lose: true } }>) {
    return {
      id: t.id,
      referenznummer: t.referenznummer,
      krankenhaus: t.krankenhaus,
      stadt: t.stadt,
      landIso: t.landIso,
      regionCode: t.regionCode,
      veroeffentlichtAm: t.veroeffentlichtAm,
      abgabefrist: t.abgabefrist,
      status: t.status,
      wettbewerber: t.wettbewerber,
      eigenerPreisEur: dec(t.eigenerPreisEur),
      wettbewerbPreisEur: dec(t.wettbewerbPreisEur),
      notiz: t.notiz,
      erstelltVon: t.erstelltVon,
      erstelltAm: t.erstelltAm,
      aktualisiertAm: t.aktualisiertAm,
      lose: t.lose
        .slice()
        .sort((a, b) => a.erstelltAm.getTime() - b.erstelltAm.getTime())
        .map((l) => ({ id: l.id, bezeichnung: l.bezeichnung, volumenEur: dec(l.volumenEur), menge: dec(l.menge) })),
    };
  }

  // ─────────── Lesen ───────────

  /** Alle sichtbaren Tender (gescoped), optional nach Status gefiltert, nach Frist aufsteigend. */
  async liste(aktor: RequestUser, status?: string) {
    const where = await this.leseWhere(aktor);
    if (status && (STATUS_WERTE as readonly string[]).includes(status)) {
      where.status = status as TenderStatus;
    }
    const rows = await this.prisma.tender.findMany({ where, include: { lose: true }, orderBy: [{ abgabefrist: 'asc' }] });
    return rows.map((t) => this.toDto(t));
  }

  async holen(id: string, aktor: RequestUser) {
    const t = await this.prisma.tender.findUnique({ where: { id }, include: { lose: true } });
    if (!t) throw new NotFoundException('Tender nicht gefunden.');
    const scope = await this.scope.getScope(aktor);
    if (!scope.unbeschraenkt && (t.regionCode == null || !scope.regionCodes.includes(t.regionCode))) {
      throw new ForbiddenException('Kein Zugriff auf diesen Tender.');
    }
    return this.toDto(t);
  }

  // ─────────── Schreiben ───────────

  /** Sichert, dass der Aktor in die angegebene Region schreiben darf (AGM: nur eigene). */
  private async assertRegionSchreibbar(aktor: RequestUser, regionCode: string | null): Promise<void> {
    const scope = await this.scope.getScope(aktor);
    if (aktor.rolle !== 'AGM') return;
    if (!regionCode) throw new BadRequestException('AGM müssen dem Tender eine eigene Region zuordnen.');
    this.scope.assertSchreibScope(scope, regionCode);
  }

  async erstellen(input: TenderInput, aktor: RequestUser) {
    const referenznummer = String(input.referenznummer ?? '').trim();
    const krankenhaus = String(input.krankenhaus ?? '').trim();
    if (!referenznummer) throw new BadRequestException('Referenznummer ist erforderlich.');
    if (!krankenhaus) throw new BadRequestException('Krankenhaus/Standort ist erforderlich.');
    const abgabefrist = this.parseDatum(input.abgabefrist, 'Abgabefrist', true) as Date;
    const veroeffentlichtAm = this.parseDatum(input.veroeffentlichtAm, 'Veröffentlichungsdatum');
    const regionCode = input.regionCode ? String(input.regionCode).trim() : null;
    await this.assertRegionSchreibbar(aktor, regionCode);

    const lose = this.sanitizeLose(input.lose);
    const created = await this.prisma.tender.create({
      data: {
        referenznummer: referenznummer.slice(0, 120),
        krankenhaus: krankenhaus.slice(0, 200),
        stadt: input.stadt ? String(input.stadt).slice(0, 120) : null,
        landIso: input.landIso ? String(input.landIso).slice(0, 8) : null,
        regionCode,
        veroeffentlichtAm,
        abgabefrist,
        wettbewerber: this.sanitizeWettbewerber(input.wettbewerber),
        eigenerPreisEur: input.eigenerPreisEur ?? null,
        wettbewerbPreisEur: input.wettbewerbPreisEur ?? null,
        notiz: input.notiz ? String(input.notiz).slice(0, 4000) : null,
        erstelltVonId: aktor.id,
        erstelltVon: aktor.email,
        lose: { create: lose },
      },
      include: { lose: true },
    });
    await this.audit.write({ entitaet: 'Tender', entitaetId: created.id, aktion: 'CREATE', userId: aktor.id, userEmail: aktor.email, metadaten: { referenznummer, regionCode } });
    return this.toDto(created);
  }

  async aktualisieren(id: string, input: TenderInput, aktor: RequestUser) {
    const vorhanden = await this.prisma.tender.findUnique({ where: { id } });
    if (!vorhanden) throw new NotFoundException('Tender nicht gefunden.');
    // Schreibrecht auf die BESTEHENDE Region prüfen …
    await this.assertRegionSchreibbar(aktor, vorhanden.regionCode);
    // … und, falls die Region umgehängt wird, auch auf die neue.
    const neueRegion = input.regionCode !== undefined ? (input.regionCode ? String(input.regionCode).trim() : null) : undefined;
    if (neueRegion !== undefined && neueRegion !== vorhanden.regionCode) await this.assertRegionSchreibbar(aktor, neueRegion);

    // Whitelist-PATCH: nur explizit übergebene Felder schreiben.
    const data: Prisma.TenderUncheckedUpdateInput = {};
    if (input.referenznummer !== undefined) {
      const r = String(input.referenznummer).trim();
      if (!r) throw new BadRequestException('Referenznummer darf nicht leer sein.');
      data.referenznummer = r.slice(0, 120);
    }
    if (input.krankenhaus !== undefined) {
      const k = String(input.krankenhaus).trim();
      if (!k) throw new BadRequestException('Krankenhaus/Standort darf nicht leer sein.');
      data.krankenhaus = k.slice(0, 200);
    }
    if (input.stadt !== undefined) data.stadt = input.stadt ? String(input.stadt).slice(0, 120) : null;
    if (input.landIso !== undefined) data.landIso = input.landIso ? String(input.landIso).slice(0, 8) : null;
    if (neueRegion !== undefined) data.regionCode = neueRegion;
    if (input.veroeffentlichtAm !== undefined) data.veroeffentlichtAm = this.parseDatum(input.veroeffentlichtAm, 'Veröffentlichungsdatum');
    if (input.abgabefrist !== undefined) {
      data.abgabefrist = this.parseDatum(input.abgabefrist, 'Abgabefrist', true) as Date;
      // Frist verschoben -> Reminder-Schwelle zurücksetzen, damit für die neue Frist erneut erinnert wird.
      data.reminderSchwelleTage = null;
    }
    if (input.wettbewerber !== undefined) data.wettbewerber = this.sanitizeWettbewerber(input.wettbewerber);
    if (input.eigenerPreisEur !== undefined) data.eigenerPreisEur = input.eigenerPreisEur;
    if (input.wettbewerbPreisEur !== undefined) data.wettbewerbPreisEur = input.wettbewerbPreisEur;
    if (input.notiz !== undefined) data.notiz = input.notiz ? String(input.notiz).slice(0, 4000) : null;

    const lose = input.lose !== undefined ? this.sanitizeLose(input.lose) : undefined;
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.tender.update({ where: { id }, data });
      if (lose !== undefined) {
        await tx.tenderLos.deleteMany({ where: { tenderId: id } });
        if (lose.length) await tx.tenderLos.createMany({ data: lose.map((l) => ({ ...l, tenderId: id })) });
      }
      return tx.tender.findUniqueOrThrow({ where: { id }, include: { lose: true } });
    });
    await this.audit.write({ entitaet: 'Tender', entitaetId: id, aktion: 'UPDATE', userId: aktor.id, userEmail: aktor.email, metadaten: { felder: Object.keys(data) } });
    return this.toDto(result);
  }

  async statusSetzen(id: string, status: string, aktor: RequestUser) {
    if (!(STATUS_WERTE as readonly string[]).includes(status)) throw new BadRequestException('Ungültiger Status.');
    const vorhanden = await this.prisma.tender.findUnique({ where: { id } });
    if (!vorhanden) throw new NotFoundException('Tender nicht gefunden.');
    await this.assertRegionSchreibbar(aktor, vorhanden.regionCode);
    const result = await this.prisma.tender.update({ where: { id }, data: { status: status as TenderStatus }, include: { lose: true } });
    await this.audit.write({ entitaet: 'Tender', entitaetId: id, aktion: 'STATUS_WECHSEL', userId: aktor.id, userEmail: aktor.email, vorherWert: { status: vorhanden.status }, nachherWert: { status } });
    return this.toDto(result);
  }

  /** Hartes Löschen nur für Leitung/Admin (Fehleingaben); Reps stornieren über den Status. */
  async loeschen(id: string, aktor: RequestUser) {
    const vorhanden = await this.prisma.tender.findUnique({ where: { id } });
    if (!vorhanden) throw new NotFoundException('Tender nicht gefunden.');
    await this.prisma.tender.delete({ where: { id } });
    await this.audit.write({ entitaet: 'Tender', entitaetId: id, aktion: 'DELETE', userId: aktor.id, userEmail: aktor.email, vorherWert: { referenznummer: vorhanden.referenznummer, status: vorhanden.status } });
    return { geloescht: true };
  }
}
