import { Body, Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { AuthService, readCookie } from './auth.service.js';
import { CurrentUser } from './decorator/current-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import type { AuthenticatedUser } from './constants/roles.constants.js';
import { SuapOAuthClient } from './suap/suap-oauth.client.js';

const STATE_COOKIE = 'suap_oauth_state';
const SESSION_COOKIE = 'session';
const SESSION_MAX_AGE_MS = 60 * 60 * 8 * 1000;

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly suapOAuthClient: SuapOAuthClient,
    private readonly configService: ConfigService,
  ) {}

  @Public()
  @Get('suap')
  login(
    @Query('platform') platform: string | undefined,
    @Res() response: Response,
  ) {
    const target = platform === 'mobile' ? 'mobile' : 'web';
    const state = this.authService.createState();
    response.cookie(STATE_COOKIE, this.authService.signState(state, target), {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.configService.get('NODE_ENV') === 'production',
      maxAge: 10 * 60 * 1000,
      path: '/api/auth/suap/callback',
    });
    response.redirect(this.suapOAuthClient.buildAuthorizeUrl(state));
  }

  @Public()
  @Get('suap/callback')
  async callback(@Req() request: Request, @Res() response: Response) {
    const { user, platform } = await this.authService.loginWithSuap({
      code: request.query.code as string | undefined,
      state: request.query.state as string | undefined,
      stateCookie: readCookie(request.headers.cookie, STATE_COOKIE),
    });
    response.clearCookie(STATE_COOKIE, { path: '/api/auth/suap/callback' });
    if (platform === 'mobile') {
      const url = new URL(this.configService.getOrThrow('MOBILE_REDIRECT_URL'));
      url.searchParams.set('code', this.authService.createMobileCode(user.id));
      response.redirect(url.toString());
      return;
    }
    response.cookie(SESSION_COOKIE, this.authService.createSession(user.id), {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.configService.get('NODE_ENV') === 'production',
      maxAge: SESSION_MAX_AGE_MS,
      path: '/api',
    });
    response.redirect(this.configService.getOrThrow('FRONTEND_URL'));
  }

  @Public()
  @Post('mobile/session')
  mobileSession(@Body() body: { code?: string }) {
    return this.authService.redeemMobileCode(body?.code);
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }
}
