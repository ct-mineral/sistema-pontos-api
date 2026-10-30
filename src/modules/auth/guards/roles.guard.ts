import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import {
  ROLE_BY_SUAP_TYPE,
  type AuthenticatedUser,
  type UserRole,
} from '../constants/roles.constants.js';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator.js';
import { ALLOW_VIEWER_KEY, ROLES_KEY } from '../decorator/roles.decorator.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles?.length) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user) throw new UnauthorizedException();

    if (user.role === ROLE_BY_SUAP_TYPE.Servidor || roles.includes(user.role)) {
      return true;
    }

    const allowViewer = this.reflector.getAllAndOverride<boolean>(ALLOW_VIEWER_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowViewer && user.viewer) return true;

    throw new ForbiddenException();
  }
}
