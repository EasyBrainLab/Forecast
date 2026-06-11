import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Rolle } from '@forecast/shared';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { RequestUser } from '../decorators/current-user.decorator';

/**
 * Fail-closed: Öffentliche Routen passieren. Jede andere Route MUSS @Roles deklarieren —
 * fehlt die Deklaration, wird mit 403 abgewiesen (kein implizit erlaubter Zugriff).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const rollen = this.reflector.getAllAndOverride<Rolle[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!rollen || rollen.length === 0) {
      throw new ForbiddenException('Endpunkt ohne Rollen-Deklaration (fail-closed).');
    }

    const request = context.switchToHttp().getRequest<{ user?: RequestUser }>();
    const user = request.user;
    if (!user || !rollen.includes(user.rolle)) {
      throw new ForbiddenException('Keine Berechtigung für diese Aktion.');
    }
    return true;
  }
}
