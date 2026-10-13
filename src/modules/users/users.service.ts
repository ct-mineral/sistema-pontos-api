import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { UserRole } from '../auth/constants/roles.constants.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

const USER_ROLES: readonly UserRole[] = ['ALUNO', 'PRESTADOR', 'SERVIDOR'];

@Injectable()
export class UsersService {
  constructor(private readonly prismaService: PrismaService) {}

  async authorize(input: { suapEnrollment?: string; role?: string }) {
    const suapEnrollment = input.suapEnrollment?.trim();
    const role = input.role?.trim();
    if (!suapEnrollment || !isUserRole(role)) {
      throw new UnprocessableEntityException(
        'Matrícula e papel são obrigatórios',
      );
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
        role,
        status: true,
        created_at: now,
        updated_at: now,
      },
    });

    return toUser(user);
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
}

function isUserRole(role: string | undefined): role is UserRole {
  return USER_ROLES.some((item) => item === role);
}

function toUser(user: {
  id: string;
  suap_enrollment: string;
  role: UserRole;
  status: boolean;
}) {
  return {
    id: user.id,
    suapEnrollment: user.suap_enrollment,
    role: user.role,
    status: user.status,
  };
}
