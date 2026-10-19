import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseFilePipeBuilder,
  Post,
  Query,
  StreamableFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Express } from 'express';
import type { AuthenticatedUser } from '../auth/constants/roles.constants.js';
import { CurrentUser } from '../auth/decorator/current-user.decorator.js';
import { Roles } from '../auth/decorator/roles.decorator.js';
import { TimeRecordsService } from './time-records.service.js';

@Controller('time-records')
export class TimeRecordsController {
  constructor(private readonly timeRecordsService: TimeRecordsService) {}

  @Roles('ALUNO', 'PRESTADOR', 'SERVIDOR')
  @Post('create')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { code?: string; type?: string; groupId?: string },
  ) {
    return this.timeRecordsService.create(user.id, body);
  }

  @Roles('ALUNO', 'PRESTADOR', 'SERVIDOR')
  @Get('group-options')
  groupOptions(@CurrentUser() user: AuthenticatedUser) {
    return this.timeRecordsService.groupOptions(user.id);
  }

  @Roles('ALUNO', 'PRESTADOR', 'SERVIDOR')
  @Post('activity')
  saveActivity(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { exitId?: string; description?: string },
  ) {
    return this.timeRecordsService.saveActivity(user.id, body);
  }

  @Roles('ALUNO', 'PRESTADOR', 'SERVIDOR')
  @Post('justification')
  saveReason(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { exitId?: string; reason?: string },
  ) {
    return this.timeRecordsService.saveReason(user.id, body);
  }

  @Roles('SERVIDOR')
  @Get('justifications')
  listJustifications() {
    return this.timeRecordsService.listJustifications();
  }

  @Roles('ALUNO', 'PRESTADOR', 'SERVIDOR')
  @Get('allowance-groups')
  allowanceGroups(@CurrentUser() user: AuthenticatedUser) {
    return this.timeRecordsService.allowanceGroups(user.id);
  }

  @Roles('ALUNO', 'PRESTADOR', 'SERVIDOR')
  @Post('allowances')
  @UseInterceptors(
    FilesInterceptor('documents', 3, {
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  requestAllowance(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { date?: string; groupId?: string; reason?: string },
    @UploadedFiles(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({
          fileType: /^(application\/pdf|image\/(jpeg|png|webp))$/,
          overrideMimeType: true,
          errorMessage: 'Anexe apenas PDF, JPG, PNG ou WEBP',
        })
        .addMaxSizeValidator({
          maxSize: 5 * 1024 * 1024,
          errorMessage: 'Cada documento pode ter no máximo 5 MB',
        })
        .build({
          fileIsRequired: false,
          errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        }),
    )
    files: Array<Express.Multer.File> = [],
  ) {
    return this.timeRecordsService.requestAllowance(user.id, body, files ?? []);
  }

  @Roles('SERVIDOR')
  @Get('allowances')
  listAllowances() {
    return this.timeRecordsService.listAllowances();
  }

  @Roles('SERVIDOR')
  @Get('allowances/:allowanceId/documents/:documentId')
  async readAllowanceDocument(
    @Param('allowanceId') allowanceId: string,
    @Param('documentId') documentId: string,
  ) {
    const document = await this.timeRecordsService.readAllowanceDocument(allowanceId, documentId);
    const fileName = document.file_name.replace(/["\r\n]/g, '');
    return new StreamableFile(Buffer.from(document.content), {
      type: document.mime_type,
      disposition: `inline; filename="${fileName}"`,
    });
  }

  @Roles('SERVIDOR')
  @Post('allowances/review')
  reviewAllowance(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { id?: string; status?: string },
  ) {
    return this.timeRecordsService.reviewAllowance(user.id, body);
  }

  @Roles('SERVIDOR')
  @Post('justifications/review')
  review(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { id?: string; status?: string; makeupDate?: string; makeupStart?: string },
  ) {
    return this.timeRecordsService.review(user.id, body);
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

  @Get('period')
  period(
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.timeRecordsService.period(user.id, from, to);
  }

  @Roles('SERVIDOR')
  @Get('period-by-user')
  periodByUser(
    @Query('suapEnrollment') suapEnrollment?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.timeRecordsService.periodByEnrollment(suapEnrollment, from, to);
  }
}
