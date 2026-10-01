import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SuapProfile } from './types/suap.types.js';

@Injectable()
export class SuapOAuthClient {
  constructor(private readonly configService: ConfigService) {}

  buildAuthorizeUrl(state: string) {
    const url = new URL('/o/authorize/', this.baseUrl());
    url.searchParams.set('response_type', 'code');
    url.searchParams.set(
      'client_id',
      this.configService.getOrThrow('SUAP_CLIENT_ID'),
    );
    url.searchParams.set(
      'redirect_uri',
      this.configService.getOrThrow('SUAP_REDIRECT_URI'),
    );
    url.searchParams.set('scope', 'identificacao');
    url.searchParams.set('state', state);
    return url.toString();
  }

  async exchangeCode(code: string) {
    try {
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.configService.getOrThrow('SUAP_REDIRECT_URI'),
        client_id: this.configService.getOrThrow('SUAP_CLIENT_ID'),
        client_secret: this.configService.getOrThrow('SUAP_CLIENT_SECRET'),
      });

      const response = await fetch(new URL('/o/token/', this.baseUrl()), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });

      if (!response.ok) {
        throw new UnauthorizedException('Falha na troca de código');
      }

      const data = (await response.json()) as { access_token?: string };

      if (!data.access_token) {
        throw new UnauthorizedException('Falha na troca de código');
      }

      return data.access_token;
    } catch (error) {
      throw new UnauthorizedException(`Falha na troca de código: ${error}`);
    }
  }

  async getProfile(accessToken: string): Promise<SuapProfile> {
    try {
      const response = await fetch(new URL('/api/rh/eu/', this.baseUrl()), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!response.ok) {
        throw new UnauthorizedException('Falha ao buscar perfil');
      }

      const profile = (await response.json()) as SuapProfile;

      if (!profile.identificacao || !profile.tipo_usuario) {
        throw new UnauthorizedException('Falha ao buscar perfil');
      }

      return profile;
    } catch (error) {
      throw new UnauthorizedException(`Falha ao buscar perfil: ${error}`);
    }
  }

  private baseUrl() {
    return this.configService
      .getOrThrow<string>('SUAP_BASE_URL')
      .replace(/\/$/, '');
  }
}
