import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Roles } from '../auth/decorator/roles.decorator.js';
import { WorkloadAdjustmentsService } from './workload-adjustments.service.js';

@Controller('workload-adjustments')
export class WorkloadAdjustmentsController {
  constructor(
    private readonly workloadAdjustmentsService: WorkloadAdjustmentsService,
  ) {}

  @Roles('SERVIDOR')
  @Post('create')
  create(
    @Body()
    body: {
      suapEnrollment?: string;
      groupId?: string;
      startTime?: string;
      endTime?: string;
      startDate?: string;
      endDate?: string;
    },
  ) {
    return this.workloadAdjustmentsService.create(body);
  }

  @Roles('SERVIDOR')
  @Post('update')
  update(
    @Body()
    body: {
      id?: string;
      suapEnrollment?: string;
      groupId?: string;
      startTime?: string;
      endTime?: string;
      startDate?: string;
      endDate?: string;
    },
  ) {
    return this.workloadAdjustmentsService.update(body);
  }

  @Roles('SERVIDOR')
  @Post('delete')
  remove(@Body() body: { id?: string }) {
    return this.workloadAdjustmentsService.remove(body);
  }

  @Roles('SERVIDOR')
  @Get('list')
  list(@Query('suapEnrollment') suapEnrollment?: string) {
    return this.workloadAdjustmentsService.list(suapEnrollment);
  }
}
