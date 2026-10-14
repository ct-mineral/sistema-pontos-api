import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { UserRole } from '../auth/constants/roles.constants.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

@Injectable()
export class UsersService {
  constructor(private readonly prismaService: PrismaService) {}

  async authorize(input: { suapEnrollment?: string }) {
    const suapEnrollment = input.suapEnrollment?.trim();
    if (!suapEnrollment) {
      throw new UnprocessableEntityException('Matrícula é obrigatória');
    }

    const current = await this.prismaService.users.findUnique({
      where: { suap_enrollment: suapEnrollment },
    });
    if (current) throw new ConflictException('Matrícula já cadastrada');

    const now = new Date();
    const user = await this.prismaService.users.create({
      data: {
        id: randomUUID(),
        suap_enrollment: suapEnrollment,
        status: true,
        created_at: now,
        updated_at: now,
      },
    });

    return toUser(user);
  }

  async list() {
    const users = await this.prismaService.users.findMany({
      orderBy: { created_at: 'desc' },
    });
    return users.map(toUser);
  }

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

    return toUser(user);
  }

  async update(input: { id?: string; suapEnrollment?: string }) {
    const suapEnrollment = input.suapEnrollment?.trim();
    if (!input.id || !suapEnrollment) {
      throw new UnprocessableEntityException('Matrícula é obrigatória');
    }

    const current = await this.prismaService.users.findUnique({
      where: { id: input.id },
    });
    if (!current) throw new NotFoundException('Usuário não encontrado');

    const taken = await this.prismaService.users.findUnique({
      where: { suap_enrollment: suapEnrollment },
    });
    if (taken && taken.id !== current.id) {
      throw new ConflictException('Matrícula já cadastrada');
    }

    const user = await this.prismaService.users.update({
      where: { id: current.id },
      data: { suap_enrollment: suapEnrollment, updated_at: new Date() },
    });

    return toUser(user);
  }

  async remove(input: { id?: string }, actorId: string) {
    if (!input.id) {
      throw new UnprocessableEntityException('Matrícula é obrigatória');
    }
    if (input.id === actorId) {
      throw new ConflictException('Não é possível excluir a própria matrícula');
    }

    const current = await this.prismaService.users.findUnique({
      where: { id: input.id },
    });
    if (!current) throw new NotFoundException('Usuário não encontrado');

    const punches = await this.prismaService.time_records.count({
      where: { user_id: current.id },
    });
    if (punches > 0) {
      throw new ConflictException(
        'Não é possível excluir uma matrícula que já registrou ponto',
      );
    }

    await this.prismaService.$transaction([
      this.prismaService.users_groups.deleteMany({
        where: { user_id: current.id },
      }),
      this.prismaService.workload_adjustments.deleteMany({
        where: { user_id: current.id },
      }),
      this.prismaService.users.delete({ where: { id: current.id } }),
    ]);

    return { id: current.id };
  }
}

function toUser(user: {
  id: string;
  suap_enrollment: string;
  name: string | null;
  role: UserRole | null;
  status: boolean;
}) {
  return {
    id: user.id,
    suapEnrollment: user.suap_enrollment,
    name: user.name,
    role: user.role,
    status: user.status,
  };
}
