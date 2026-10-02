import { Module } from '@nestjs/common';
import { TimeRecordsService } from './time-records.service.js';
import { TimeRecordsController } from './time-records.controller.js';
import { PrismaModule } from '../../infra/prisma/prisma.module.js';
import { QrCodesModule } from '../qr-codes/qr-codes.module.js';
import { GroupsModule } from '../groups/groups.module.js';
import { WorkloadAdjustmentsModule } from '../workload-adjustments/workload-adjustments.module.js';

@Module({
  imports: [
    PrismaModule,
    QrCodesModule,
    GroupsModule,
    WorkloadAdjustmentsModule,
  ],
  controllers: [TimeRecordsController],
  providers: [TimeRecordsService],
  exports: [TimeRecordsService],
})
export class TimeRecordsModule {}
