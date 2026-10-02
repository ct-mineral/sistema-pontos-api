import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

@Injectable()
export class QrCodesService {
  constructor(private readonly prismaService: PrismaService) {}

  async create(input: { code?: string; location?: string }) {
    const code = input.code?.trim();
    const location = input.location?.trim();

    if (!code || !location) {
      throw new UnprocessableEntityException('Código e local são obrigatórios');
    }

    try {
      const qrCode = await this.prismaService.qr_codes.create({
        data: {
          id: randomUUID(),
          code,
          location,
          created_at: new Date(),
        },
      });

      return {
        id: qrCode.id,
        code: qrCode.code,
        location: qrCode.location,
        status: qrCode.status,
        createdAt: qrCode.created_at,
      };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('QR code já cadastrado');
      }
      throw error;
    }
  }

  async list() {
    const qrCodes = await this.prismaService.qr_codes.findMany({
      orderBy: { created_at: 'desc' },
    });

    return qrCodes.map((qrCode) => ({
      id: qrCode.id,
      code: qrCode.code,
      location: qrCode.location,
      status: qrCode.status,
      createdAt: qrCode.created_at,
    }));
  }

  async findActiveByCode(code: string) {
    const qrCode = await this.prismaService.qr_codes.findUnique({
      where: { code },
    });

    if (!qrCode?.status) {
      throw new NotFoundException('QR code não encontrado');
    }

    return qrCode;
  }
}

function isUniqueViolation(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}
