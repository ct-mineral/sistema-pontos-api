import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

@Injectable()
export class UsersService {
  constructor(private readonly prismaService: PrismaService) {}

  async updateStatus(input: { suapEnrollment?: string; status?: boolean }) {
    const suapEnrollment = input.suapEnrollment?.trim();
    if (!suapEnrollment || typeof input.status !== 'boolean') {
      throw new UnprocessableEntityException(
        'Matrícula e status são obrigatórios',
      );
    }

    const current = await this.prismaService.users.findUnique({
      where: { suap_enrollment: suapEnrollment },
    });
    if (!current) throw new NotFoundException('Usuário não encontrado');

    const user = await this.prismaService.users.update({
      where: { id: current.id },
      data: { status: input.status, updated_at: new Date() },
    });

    return {
      id: user.id,
      suapEnrollment: user.suap_enrollment,
      role: user.role,
      status: user.status,
    };
  }
}
