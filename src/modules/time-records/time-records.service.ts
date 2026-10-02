import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { QrCodesService } from '../qr-codes/qr-codes.service.js';
import { RECORD_TYPES } from './constants/record-types.constants.js';

type TimeRecordType = (typeof RECORD_TYPES)[number];

@Injectable()
export class TimeRecordsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly qrCodesService: QrCodesService,
  ) {}

  async create(userId: string, input: { code?: string; type?: string }) {
    const code = input.code?.trim();
    if (!code || !input.type || !isRecordType(input.type)) {
      throw new UnprocessableEntityException('Código e tipo são obrigatórios');
    }

    const qrCode = await this.qrCodesService.findActiveByCode(code);

    const last = await this.prismaService.time_records.findFirst({
      where: { user_id: userId },
      orderBy: { recorded_at: 'desc' },
    });

    if ((!last && input.type !== 'entrada') || last?.type === input.type) {
      throw new UnprocessableEntityException('Sequência de batida inválida');
    }

    const now = new Date();
    const record = await this.prismaService.time_records.create({
      data: {
        id: randomUUID(),
        user_id: userId,
        qr_code_id: qrCode.id,
        type: input.type,
        recorded_at: now,
        created_at: now,
      },
    });

    return toRecord(record, qrCode);
  }

  async listMine(userId: string) {
    const records = await this.prismaService.time_records.findMany({
      where: { user_id: userId },
      include: { qr_codes: true },
      orderBy: { recorded_at: 'desc' },
    });

    return records.map((record) => toRecord(record, record.qr_codes));
  }
}

function isRecordType(value: string): value is TimeRecordType {
  return (RECORD_TYPES as readonly string[]).includes(value);
}

function toRecord(
  record: {
    id: string;
    type: string;
    recorded_at: Date;
    created_at: Date;
  },
  qrCode: { id: string; code: string; location: string },
) {
  return {
    id: record.id,
    type: record.type,
    recordedAt: record.recorded_at,
    createdAt: record.created_at,
    qrCode: {
      id: qrCode.id,
      code: qrCode.code,
      location: qrCode.location,
    },
  };
}
