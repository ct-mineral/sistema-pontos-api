import { Module } from '@nestjs/common';
import { WorkloadAdjustmentsService } from './workload-adjustments.service.js';
import { WorkloadAdjustmentsController } from './workload-adjustments.controller.js';
import { PrismaModule } from '../../infra/prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
  controllers: [WorkloadAdjustmentsController],
  providers: [WorkloadAdjustmentsService],
  exports: [WorkloadAdjustmentsService],
})
export class WorkloadAdjustmentsModule {}
