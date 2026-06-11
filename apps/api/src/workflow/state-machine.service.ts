import { ConflictException, ForbiddenException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { findTransition, type Rolle, type Transition } from '@forecast/shared';

export interface TransitionContext {
  rolle: Rolle;
  aktorId: string;
  antragstellerId?: string;
  begruendung?: string | null;
  kommentar?: string | null;
  /** true, wenn der Schwellwert verletzt ist (steuert Pflichtkommentar bei BEI_SCHWELLWERT). */
  kommentarErforderlich?: boolean;
  /** erlaubt SYSTEM-Übergänge (Cron/Workflow-intern). */
  system?: boolean;
}

/**
 * Zentrale Transition-Validierung (§8.1). Backend ist Autorität: prüft Existenz (409),
 * Rolle (403), Selbstfreigabe (403), Pflicht-Begründung/-Kommentar (422).
 */
@Injectable()
export class StateMachineService {
  pruefe<S extends string>(transitions: readonly Transition<S>[], von: S, ziel: S, ctx: TransitionContext): Transition<S> {
    const def = findTransition(transitions, von, ziel);
    if (!def) throw new ConflictException(`Übergang ${von} → ${ziel} nicht erlaubt.`);
    if (def.system && !ctx.system) throw new ForbiddenException('System-Übergang, keine Nutzeraktion.');
    if (!def.system && !def.rollen.includes(ctx.rolle)) {
      throw new ForbiddenException('Keine Berechtigung für diesen Übergang.');
    }
    if (def.keineSelbstfreigabe && ctx.antragstellerId && ctx.antragstellerId === ctx.aktorId) {
      throw new ForbiddenException('Selbstfreigabe nicht erlaubt (4-Augen-Prinzip).');
    }
    if (def.begruendungPflicht && !ctx.begruendung?.trim()) {
      throw new UnprocessableEntityException('Begründung erforderlich.');
    }
    if (def.kommentarPflicht === true && !ctx.kommentar?.trim()) {
      throw new UnprocessableEntityException('Kommentar erforderlich.');
    }
    if (def.kommentarPflicht === 'BEI_SCHWELLWERT' && ctx.kommentarErforderlich && !ctx.kommentar?.trim()) {
      throw new UnprocessableEntityException('Pflichtkommentar bei Schwellwert-Überschreitung erforderlich.');
    }
    return def;
  }
}
