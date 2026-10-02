import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './infra/prisma/prisma.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './modules/auth/guards/auth.guard.js';
import { RolesGuard } from './modules/auth/guards/roles.guard.js';
import { QrCodesModule } from './modules/qr-codes/qr-codes.module.js';
import { TimeRecordsModule } from './modules/time-records/time-records.module.js';
import { GroupsModule } from './modules/groups/groups.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    QrCodesModule,
    TimeRecordsModule,
    GroupsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
