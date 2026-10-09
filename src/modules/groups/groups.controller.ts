import { Body, Controller, Get, Post } from '@nestjs/common';
import { Roles } from '../auth/decorator/roles.decorator.js';
import { GroupsService } from './groups.service.js';

@Controller('groups')
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  @Roles('SERVIDOR')
  @Post('create')
  create(@Body() body: { name?: string; startTime?: string; endTime?: string }) {
    return this.groupsService.create(body);
  }

  @Roles('SERVIDOR')
  @Get('list')
  list() {
    return this.groupsService.list();
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
}
