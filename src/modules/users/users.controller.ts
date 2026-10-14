import { Body, Controller, Get, Post } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/constants/roles.constants.js';
import { CurrentUser } from '../auth/decorator/current-user.decorator.js';
import { Roles } from '../auth/decorator/roles.decorator.js';
import { UsersService } from './users.service.js';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Roles('SERVIDOR')
  @Get('list')
  list() {
    return this.usersService.list();
  }

  @Roles('SERVIDOR')
  @Post('authorize')
  authorize(@Body() body: { suapEnrollment?: string }) {
    return this.usersService.authorize(body);
  }

  @Roles('SERVIDOR')
  @Post('update-status')
  updateStatus(@Body() body: { suapEnrollment?: string; status?: boolean }) {
    return this.usersService.updateStatus(body);
  }

  @Roles('SERVIDOR')
  @Post('update')
  update(@Body() body: { id?: string; suapEnrollment?: string }) {
    return this.usersService.update(body);
  }

  @Roles('SERVIDOR')
  @Post('delete')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { id?: string },
  ) {
    return this.usersService.remove(body, user.id);
  }
}
