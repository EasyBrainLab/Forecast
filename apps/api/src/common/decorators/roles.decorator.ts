import { SetMetadata } from '@nestjs/common';
import { Rolle } from '@forecast/shared';

export const ROLES_KEY = 'rollen';
/** Erlaubt nur die angegebenen Rollen auf diesem Endpunkt. */
export const Roles = (...rollen: Rolle[]) => SetMetadata(ROLES_KEY, rollen);

/** Alle authentifizierten Rollen (für Endpunkte ohne fachliche Einschränkung, z.B. /me). */
export const ALLE_ROLLEN: Rolle[] = ['AGM', 'VERTRIEBSLEITER', 'BU_LEITER', 'ADMIN', 'SUPPORT'];
export const Authenticated = () => Roles(...ALLE_ROLLEN);
