import { Module } from '@nestjs/common';
import { QrCodesService } from './qr-codes.service.js';
import { QrCodesController } from './qr-codes.controller.js';
import { PrismaModule } from '../../infra/prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
  controllers: [QrCodesController],
  providers: [QrCodesService],
  exports: [QrCodesService],
})
export class QrCodesModule {}
