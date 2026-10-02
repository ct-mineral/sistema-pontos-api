import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/constants/roles.constants.js';
import { CurrentUser } from '../auth/decorator/current-user.decorator.js';
import { Roles } from '../auth/decorator/roles.decorator.js';
import { TimeRecordsService } from './time-records.service.js';

@Controller('time-records')
export class TimeRecordsController {
  constructor(private readonly timeRecordsService: TimeRecordsService) {}

  @Roles('ALUNO', 'PRESTADOR')
  @Post('create')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { code?: string; type?: string },
  ) {
    return this.timeRecordsService.create(user.id, body);
  }

  @Get('list-mine')
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.timeRecordsService.listMine(user.id);
  }

  @Get('summary')
  summary(
    @CurrentUser() user: AuthenticatedUser,
    @Query('date') date?: string,
  ) {
    return this.timeRecordsService.summary(user.id, date);
  }

  @Roles('SERVIDOR')
  @Get('summary-by-user')
  summaryByUser(
    @Query('suapEnrollment') suapEnrollment?: string,
    @Query('date') date?: string,
  ) {
    return this.timeRecordsService.summaryByEnrollment(suapEnrollment, date);
  }
}
