import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

@Injectable()
export class GroupsService {
  constructor(private readonly prismaService: PrismaService) {}

  async create(input: { name?: string; dailyWorkloadMinutes?: number }) {
    const name = input.name?.trim();
    if (!name || !isPositiveInteger(input.dailyWorkloadMinutes)) {
      throw new UnprocessableEntityException(
        'Nome e carga diária são obrigatórios',
      );
    }

    const now = new Date();
    const group = await this.prismaService.groups.create({
      data: {
        id: randomUUID(),
        name,
        daily_workload_minutes: input.dailyWorkloadMinutes,
        created_at: now,
        updated_at: now,
      },
    });

    return toGroup(group, 0);
  }

  async list() {
    const groups = await this.prismaService.groups.findMany({
      include: { _count: { select: { users_groups: true } } },
      orderBy: { created_at: 'desc' },
    });

    return groups.map((group) => toGroup(group, group._count.users_groups));
  }

  async assign(input: { suapEnrollment?: string; groupId?: string }) {
    const suapEnrollment = input.suapEnrollment?.trim();
    if (!suapEnrollment || !input.groupId) {
      throw new UnprocessableEntityException(
        'Matrícula e grupo são obrigatórios',
      );
    }

    const user = await this.prismaService.users.findUnique({
      where: { suap_enrollment: suapEnrollment },
    });
    if (!user?.status) throw new NotFoundException('Usuário não encontrado');

    const group = await this.prismaService.groups.findUnique({
      where: { id: input.groupId },
    });
    if (!group?.status) throw new NotFoundException('Grupo não encontrado');

    const membership = await this.prismaService.users_groups.findFirst({
      where: { user_id: user.id },
    });
    if (membership) {
      throw new ConflictException('Usuário já vinculado a um grupo');
    }

    const link = await this.prismaService.users_groups.create({
      data: {
        id: randomUUID(),
        user_id: user.id,
        group_id: group.id,
        created_at: new Date(),
      },
    });

    return {
      id: link.id,
      userId: link.user_id,
      groupId: link.group_id,
      createdAt: link.created_at,
    };
  }

  async findMembership(userId: string) {
    const membership = await this.prismaService.users_groups.findFirst({
      where: { user_id: userId, groups: { status: true } },
      include: { groups: true },
    });

    return membership?.groups ?? null;
  }

  async reassign(input: { suapEnrollment?: string; groupId?: string }) {
    const suapEnrollment = input.suapEnrollment?.trim();
    if (!suapEnrollment || !input.groupId) {
      throw new UnprocessableEntityException(
        'Matrícula e grupo são obrigatórios',
      );
    }

    const user = await this.prismaService.users.findUnique({
      where: { suap_enrollment: suapEnrollment },
    });
    if (!user?.status) throw new NotFoundException('Usuário não encontrado');

    const group = await this.prismaService.groups.findUnique({
      where: { id: input.groupId },
    });
    if (!group?.status) throw new NotFoundException('Grupo não encontrado');

    const membership = await this.prismaService.users_groups.findFirst({
      where: { user_id: user.id },
    });
    if (!membership) throw new NotFoundException('Usuário sem grupo');
    if (membership.group_id === group.id) {
      throw new ConflictException('Usuário já está nesse grupo');
    }

    const link = await this.prismaService.users_groups.update({
      where: { id: membership.id },
      data: { group_id: group.id },
    });

    return {
      id: link.id,
      userId: link.user_id,
      groupId: link.group_id,
      createdAt: link.created_at,
    };
  }
}

function toGroup(
  group: {
    id: string;
    name: string;
    daily_workload_minutes: number;
    status: boolean;
    created_at: Date;
    updated_at: Date;
  },
  members: number,
) {
  return {
    id: group.id,
    name: group.name,
    dailyWorkloadMinutes: group.daily_workload_minutes,
    status: group.status,
    members,
    createdAt: group.created_at,
    updatedAt: group.updated_at,
  };
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}
