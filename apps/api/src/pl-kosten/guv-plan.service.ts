import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { pickDefined } from '../common/util/whitelist.util';

/** Whitelist-Eingabe der Monatsplanung. Werte in Anzeige-Einheit (kEUR / Prozent / FTE). */
export interface GuvPlanPatch {
  /** Gross-Margin in Prozent (0..100). null = löschen. */
  grossMarginPct?: number | null;
  /** Sonstige Kosten als POSITIVER Betrag in kEUR (Kostenhöhe); wird negativ in vollem EUR gespeichert. null = löschen. */
  otherCostsKeur?: number | null;
  /** FTE-Anzahl. null = löschen. */
  fteAnzahl?: number | null;
}

@Injectable()
export class GuvPlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Setzt/aktualisiert die Monatsplanung (BU_LEITER/ADMIN). Whitelist, keine Body-Übernahme. */
  async patch(jahr: number, monat: number, body: GuvPlanPatch, aktor: { id: string; email: string }) {
    if (!Number.isInteger(monat) || monat < 1 || monat > 12) throw new BadRequestException('monat muss 1..12 sein.');
    if (!Number.isInteger(jahr) || jahr < 2020 || jahr > new Date().getUTCFullYear() + 5) throw new BadRequestException('jahr ungültig.');

    const w = pickDefined(body, ['grossMarginPct', 'otherCostsKeur', 'fteAnzahl']);
    if (Object.keys(w).length === 0) throw new BadRequestException('Kein gültiges Feld übergeben.');

    if (w.grossMarginPct != null && (w.grossMarginPct < 0 || w.grossMarginPct > 100)) throw new BadRequestException('grossMarginPct muss 0..100 sein.');
    if (w.fteAnzahl != null && w.fteAnzahl < 0) throw new BadRequestException('fteAnzahl darf nicht negativ sein.');
    if (w.otherCostsKeur != null && w.otherCostsKeur < 0) throw new BadRequestException('otherCostsKeur ist der Kostenbetrag (positiv).');

    // Übersetzung Anzeige → Speicherung: Other Costs positiv (kEUR) → negativ (voller EUR).
    const daten: Prisma.GuvPlanUncheckedCreateInput = { jahr, monat };
    if ('grossMarginPct' in w) daten.grossMarginPct = w.grossMarginPct == null ? null : new Prisma.Decimal(w.grossMarginPct);
    if ('otherCostsKeur' in w) daten.otherCostsEur = w.otherCostsKeur == null ? null : new Prisma.Decimal(Math.round(-Math.abs(w.otherCostsKeur) * 1000 * 100) / 100);
    if ('fteAnzahl' in w) daten.fteAnzahl = w.fteAnzahl == null ? null : new Prisma.Decimal(w.fteAnzahl);
    daten.aktualisiertVon = aktor.id;

    const { jahr: _j, monat: _m, ...updateFelder } = daten;
    const row = await this.prisma.guvPlan.upsert({
      where: { jahr_monat: { jahr, monat } },
      create: daten,
      update: updateFelder,
    });

    await this.audit.write({
      entitaet: 'GuvPlan',
      entitaetId: row.id,
      aktion: 'UPDATE',
      userId: aktor.id,
      userEmail: aktor.email,
      metadaten: { jahr, monat, ...w },
    });
    return row;
  }
}
