import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Rolle } from '@forecast/shared';

export interface RequestUser {
  id: string;
  email: string;
  rolle: Rolle;
}

/** Liefert den authentifizierten Nutzer aus dem Request (gesetzt durch die JwtStrategy). */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): RequestUser => {
  const request = ctx.switchToHttp().getRequest<{ user: RequestUser }>();
  return request.user;
});
