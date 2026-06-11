import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuditAktion } from '@forecast/shared';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEintrag {
  entitaet: string;
  entitaetId?: string | null;
  aktion: AuditAktion;
  userId?: string | null;
  userEmail?: string | null;
  vorherWert?: unknown;
  nachherWert?: unknown;
  ipAdresse?: string | null;
  metadaten?: unknown;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Schreibt einen append-only AuditTrail-Eintrag (optional innerhalb einer Transaktion). */
  async write(eintrag: AuditEintrag, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    await client.auditTrail.create({
      data: {
        entitaet: eintrag.entitaet,
        entitaetId: eintrag.entitaetId ?? null,
        aktion: eintrag.aktion,
        userId: eintrag.userId ?? null,
        userEmail: eintrag.userEmail ?? null,
        vorherWert: (eintrag.vorherWert ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        nachherWert: (eintrag.nachherWert ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        ipAdresse: eintrag.ipAdresse ?? null,
        metadaten: (eintrag.metadaten ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      },
    });
  }
}
