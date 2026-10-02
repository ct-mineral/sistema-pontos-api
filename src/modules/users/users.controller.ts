import { Body, Controller, Post } from '@nestjs/common';
import { Roles } from '../auth/decorator/roles.decorator.js';
import { UsersService } from './users.service.js';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Roles('SERVIDOR')
  @Post('update-status')
  updateStatus(@Body() body: { suapEnrollment?: string; status?: boolean }) {
    return this.usersService.updateStatus(body);
  }
}
