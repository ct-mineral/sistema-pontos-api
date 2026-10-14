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

  async create(input: { location?: string }) {
    const location = input.location?.trim();

    if (!location) {
      throw new UnprocessableEntityException('Local é obrigatório');
    }

    const qrCode = await this.prismaService.qr_codes.create({
      data: {
        id: randomUUID(),
        location,
        created_at: new Date(),
      },
    });

    return toQrCode(qrCode);
  }

  async list() {
    const qrCodes = await this.prismaService.qr_codes.findMany({
      orderBy: { created_at: 'desc' },
    });

    return qrCodes.map(toQrCode);
  }

  async findActiveById(id: string) {
    if (!UUID.test(id)) throw new NotFoundException('QR code não encontrado');

    const qrCode = await this.prismaService.qr_codes.findUnique({
      where: { id },
    });

    if (!qrCode?.status) {
      throw new NotFoundException('QR code não encontrado');
    }

    return qrCode;
  }

  async updateStatus(input: { id?: string; status?: boolean }) {
    if (!input.id || typeof input.status !== 'boolean') {
      throw new UnprocessableEntityException(
        'QR code e status são obrigatórios',
      );
    }

    const current = await this.prismaService.qr_codes.findUnique({
      where: { id: input.id },
    });
    if (!current) throw new NotFoundException('QR code não encontrado');

    const qrCode = await this.prismaService.qr_codes.update({
      where: { id: current.id },
      data: { status: input.status },
    });

    return toQrCode(qrCode);
  }

  async update(input: { id?: string; location?: string }) {
    const location = input.location?.trim();
    if (!input.id || !location) {
      throw new UnprocessableEntityException('QR code e local são obrigatórios');
    }

    const current = await this.prismaService.qr_codes.findUnique({
      where: { id: input.id },
    });
    if (!current) throw new NotFoundException('QR code não encontrado');

    const qrCode = await this.prismaService.qr_codes.update({
      where: { id: current.id },
      data: { location },
    });

    return toQrCode(qrCode);
  }

  async remove(input: { id?: string }) {
    if (!input.id) {
      throw new UnprocessableEntityException('QR code é obrigatório');
    }

    const current = await this.prismaService.qr_codes.findUnique({
      where: { id: input.id },
    });
    if (!current) throw new NotFoundException('QR code não encontrado');

    const punches = await this.prismaService.time_records.count({
      where: { qr_code_id: current.id },
    });
    if (punches > 0) {
      throw new ConflictException(
        'Não é possível excluir um QR code que já foi usado em registros de ponto',
      );
    }

    await this.prismaService.qr_codes.delete({ where: { id: current.id } });
    return { id: current.id };
  }
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function toQrCode(qrCode: {
  id: string;
  location: string;
  status: boolean;
  created_at: Date;
}) {
  return {
    id: qrCode.id,
    location: qrCode.location,
    status: qrCode.status,
    createdAt: qrCode.created_at,
  };
}
