import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import {
  ROLE_BY_SUAP_TYPE,
  type AuthenticatedUser,
  type UserRole,
} from './constants/roles.constants.js';
import { SuapOAuthClient } from './suap/suap-oauth.client.js';
import type { Platform } from './types/platform.types.js';

const SESSION_TTL_SECONDS = 60 * 60 * 8;
const STATE_TTL_SECONDS = 60 * 10;
const MOBILE_CODE_TTL_SECONDS = 60;

@Injectable()
export class AuthService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly suapOAuthClient: SuapOAuthClient,
    private readonly configService: ConfigService,
  ) {}

  private readonly consumedMobileCodes = new Map<string, number>();
  private readonly logger = new Logger(AuthService.name);

  createState(): string {
    return randomUUID();
  }

  signState(state: string, platform: Platform) {
    return this.sign({ use: 'state', state, platform }, STATE_TTL_SECONDS);
  }

  createMobileCode(userId: string) {
    return this.sign(
      { use: 'mobile_code', sub: userId, jti: randomUUID() },
      MOBILE_CODE_TTL_SECONDS,
    );
  }

  async redeemMobileCode(code?: string) {
    if (!code) throw new UnauthorizedException('Código mobile ausente');

    const userId = this.readMobileCode(code);
    const user = await this.prismaService.users.findUnique({
      where: { id: userId },
    });

    if (!user?.status) {
      throw new UnauthorizedException(
        'Usuário não autorizado para acessar o sistema',
      );
    }

    return { token: this.createSession(user.id) };
  }

  createSession(userId: string): string {
    return this.sign({ use: 'session', sub: userId }, SESSION_TTL_SECONDS);
  }

  async loginWithSuap(input: {
    code?: string;
    state?: string;
    stateCookie?: string;
  }) {
    if (!input.code || !input.state || !input.stateCookie) {
      throw new UnauthorizedException('Erro ao fazer login com SUAP');
    }

    const expected = this.readState(input.stateCookie);
    if (!safeEqual(expected.state, input.state)) {
      throw new UnauthorizedException('Erro ao fazer login com SUAP');
    }

    const accessToken = await this.suapOAuthClient.exchangeCode(input.code);
    const profile = await this.suapOAuthClient.getProfile(accessToken);
    this.logger.log(`Usuário autenticado no SUAP: ${profile.nome_usual}`);
    const role = this.toRole(profile.tipo_usuario);
    const current = await this.prismaService.users.findUnique({
      where: { suap_enrollment: profile.identificacao },
    });

    if (!current?.status) {
      throw new UnauthorizedException(
        'Usuário não autorizado para acessar o sistema',
      );
    }

    const now = new Date();
    const name = profile.nome_usual?.trim() || null;
    const photo = profile.foto?.trim() || null;

    const user = await this.prismaService.users.update({
      where: { id: current.id },
      data: { role, name, photo, updated_at: now },
    });

    return { user, platform: expected.platform };
  }

  async authenticate(token: string): Promise<AuthenticatedUser> {
    const userId = this.readSession(token);

    const user = await this.prismaService.users.findUnique({
      where: { id: userId },
    });

    if (!user?.status || !user.role) {
      throw new UnauthorizedException(
        'Usuário não autorizado para acessar o sistema',
      );
    }

    return {
      id: user.id,
      suapEnrollment: user.suap_enrollment,
      name: user.name,
      photo: user.photo,
      role: user.role,
      viewer: user.viewer,
    };
  }

  private toRole(tipoUsuario: string): UserRole {
    const type = suapTypeName(tipoUsuario);
    if (!isSuapType(type)) {
      throw new UnauthorizedException('Tipo de usuário SUAP não reconhecido');
    }

    return ROLE_BY_SUAP_TYPE[type];
  }

  private sign(
    payload:
      | { use: 'state'; state: string; platform: Platform }
      | { use: 'session'; sub: string }
      | { use: 'mobile_code'; sub: string; jti: string },
    ttlSeconds: number,
  ) {
    const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

    const body = base64url(
      JSON.stringify({
        ...payload,
        exp: Math.floor(Date.now() / 1000) + ttlSeconds,
      }),
    );

    const data = `${header}.${body}`;

    const signature = createHmac('sha256', this.secret())
      .update(data)
      .digest('base64url');

    return `${data}.${signature}`;
  }

  private readState(token: string) {
    const payload = this.verify(token);

    if (payload.use !== 'state' || !payload.state || !payload.platform) {
      throw new UnauthorizedException('Erro ao ler estado');
    }

    return { state: payload.state, platform: payload.platform as Platform };
  }

  private readMobileCode(token: string) {
    const payload = this.verify(token);

    if (
      payload.use !== 'mobile_code' ||
      !payload.sub ||
      !payload.jti ||
      !payload.exp
    ) {
      throw new UnauthorizedException('Código mobile inválido');
    }

    const now = Date.now() / 1000;
    for (const [id, expires] of this.consumedMobileCodes) {
      if (expires < now) this.consumedMobileCodes.delete(id);
    }

    if (this.consumedMobileCodes.has(payload.jti)) {
      throw new UnauthorizedException('Código mobile já utilizado');
    }

    this.consumedMobileCodes.set(payload.jti, payload.exp);
    return payload.sub;
  }

  private readSession(token: string) {
    const payload = this.verify(token);

    if (payload.use !== 'session' || !payload.sub) {
      throw new UnauthorizedException('Erro ao ler sessão');
    }

    return payload.sub;
  }

  private verify(token: string) {
    const [header, body, signature] = token.split('.');

    if (!header || !body || !signature) {
      throw new UnauthorizedException('Erro ao verificar token');
    }

    const expected = createHmac('sha256', this.secret())
      .update(`${header}.${body}`)
      .digest('base64url');

    if (!safeEqual(signature, expected)) {
      throw new UnauthorizedException('Erro ao verificar token');
    }

    try {
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as {
        use?: string;
        sub?: string;
        state?: string;
        platform?: Platform;
        jti?: string;
        exp?: number;
      };

      if (!payload.exp || payload.exp < Date.now() / 1000) {
        throw new UnauthorizedException();
      }

      return payload;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Erro ao verificar token');
    }
  }

  private secret() {
    return this.configService.getOrThrow<string>('APP_JWT_SECRET');
  }
}

function suapTypeName(tipoUsuario: string) {
  const value = tipoUsuario.trim();
  if (/^servidor\b/i.test(value)) return 'Servidor';
  return value;
}

function isSuapType(value: string): value is keyof typeof ROLE_BY_SUAP_TYPE {
  return Object.hasOwn(ROLE_BY_SUAP_TYPE, value);
}

function base64url(value: string) {
  return Buffer.from(value).toString('base64url');
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function readCookie(header: string | undefined, name: string) {
  if (!header) return undefined;

  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }

  return undefined;
}
