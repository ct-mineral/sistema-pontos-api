import { Body, Controller, Get, Post } from '@nestjs/common';
import { Roles } from '../auth/decorator/roles.decorator.js';
import { QrCodesService } from './qr-codes.service.js';

@Controller('qr-codes')
export class QrCodesController {
  constructor(private readonly qrCodesService: QrCodesService) {}

  @Roles('SERVIDOR')
  @Post('create')
  create(@Body() body: { location?: string }) {
    return this.qrCodesService.create(body);
  }

  @Roles('SERVIDOR')
  @Get('list')
  list() {
    return this.qrCodesService.list();
  }

  @Post('update-status')
  updateStatus(@Body() body: { id?: string; status?: boolean }) {
    return this.qrCodesService.updateStatus(body);
  }
}
