import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator.js';
import { AllowViewer, Roles } from '../auth/decorator/roles.decorator.js';
import { GroupsService } from './groups.service.js';

@Controller('groups')
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  @Roles('SERVIDOR')
  @Post('create')
  create(
    @Body()
    body: {
      name?: string;
      startTime?: string;
      endTime?: string;
      breakStartTime?: string;
      breakEndTime?: string;
      autoPunchTime?: string;
    },
  ) {
    return this.groupsService.create(body);
  }

  @Roles('SERVIDOR')
  @AllowViewer()
  @Get('list')
  list() {
    return this.groupsService.list();
  }

  @Public()
  @Get('auto-punch')
  autoPunch(@Headers('authorization') authorization?: string) {
    const secret = process.env.AUTO_PUNCH_SECRET;
    if (!secret || authorization !== `Bearer ${secret}`) {
      throw new UnauthorizedException();
    }
    return this.groupsService.autoPunchOpenEntries();
  }

  @Roles('SERVIDOR')
  @Post('assign')
  assign(@Body() body: { suapEnrollment?: string; groupId?: string }) {
    return this.groupsService.assign(body);
  }

  @Roles('SERVIDOR')
  @Post('reassign')
  reassign(@Body() body: { suapEnrollment?: string; groupId?: string }) {
    return this.groupsService.reassign(body);
  }

  @Roles('SERVIDOR')
  @Post('unassign')
  unassign(@Body() body: { suapEnrollment?: string; groupId?: string }) {
    return this.groupsService.unassign(body);
  }

  @Roles('SERVIDOR')
  @Post('update')
  update(
    @Body()
    body: {
      id?: string;
      name?: string;
      startTime?: string;
      endTime?: string;
      breakStartTime?: string;
      breakEndTime?: string;
      autoPunchTime?: string;
    },
  ) {
    return this.groupsService.update(body);
  }

  @Roles('SERVIDOR')
  @Post('update-status')
  updateStatus(@Body() body: { id?: string; status?: boolean }) {
    return this.groupsService.updateStatus(body);
  }

  @Roles('SERVIDOR')
  @Post('delete')
  remove(@Body() body: { id?: string }) {
    return this.groupsService.remove(body);
  }
}
