import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/prisma/prisma.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { SuapOAuthClient } from './suap/suap-oauth.client.js';

@Module({
  imports: [PrismaModule],
  controllers: [AuthController],
  providers: [AuthService, SuapOAuthClient],
  exports: [AuthService],
})
export class AuthModule {}
