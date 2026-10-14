import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { minutesBetween, parseClock } from '../../common/clock.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

@Injectable()
export class GroupsService {
  constructor(private readonly prismaService: PrismaService) {}

  async create(input: { name?: string; startTime?: string; endTime?: string }) {
    const schedule = readSchedule(input);
    const now = new Date();
    const group = await this.prismaService.groups.create({
      data: {
        id: randomUUID(),
        name: schedule.name,
        daily_workload_minutes: schedule.dailyWorkloadMinutes,
        start_time: schedule.start.text,
        end_time: schedule.end.text,
        created_at: now,
        updated_at: now,
      },
    });

    return toGroup(group, []);
  }

  async update(input: {
    id?: string;
    name?: string;
    startTime?: string;
    endTime?: string;
  }) {
    if (!input.id) {
      throw new UnprocessableEntityException('Grupo é obrigatório');
    }
    const schedule = readSchedule(input);
    const current = await this.prismaService.groups.findUnique({
      where: { id: input.id },
    });
    if (!current) throw new NotFoundException('Grupo não encontrado');

    const group = await this.prismaService.groups.update({
      where: { id: current.id },
      data: {
        name: schedule.name,
        daily_workload_minutes: schedule.dailyWorkloadMinutes,
        start_time: schedule.start.text,
        end_time: schedule.end.text,
        updated_at: new Date(),
      },
    });

    return toGroup(group, []);
  }

  async updateStatus(input: { id?: string; status?: boolean }) {
    if (!input.id || typeof input.status !== 'boolean') {
      throw new UnprocessableEntityException('Grupo e status são obrigatórios');
    }

    const current = await this.prismaService.groups.findUnique({
      where: { id: input.id },
    });
    if (!current) throw new NotFoundException('Grupo não encontrado');

    const group = await this.prismaService.groups.update({
      where: { id: current.id },
      data: { status: input.status, updated_at: new Date() },
    });

    return toGroup(group, []);
  }

  async remove(input: { id?: string }) {
    if (!input.id) {
      throw new UnprocessableEntityException('Grupo é obrigatório');
    }

    const current = await this.prismaService.groups.findUnique({
      where: { id: input.id },
    });
    if (!current) throw new NotFoundException('Grupo não encontrado');

    const [punches, adjustments] = await Promise.all([
      this.prismaService.time_records.count({ where: { group_id: current.id } }),
      this.prismaService.workload_adjustments.count({
        where: { group_id: current.id },
      }),
    ]);
    if (punches > 0 || adjustments > 0) {
      throw new ConflictException(
        'Não é possível excluir um grupo que já tem ponto ou ajuste de carga',
      );
    }

    await this.prismaService.$transaction([
      this.prismaService.users_groups.deleteMany({
        where: { group_id: current.id },
      }),
      this.prismaService.groups.delete({ where: { id: current.id } }),
    ]);

    return { id: current.id };
  }

  async list() {
    const groups = await this.prismaService.groups.findMany({
      include: {
        users_groups: {
          include: {
            users: {
              select: { suap_enrollment: true, name: true, role: true },
            },
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });

    return groups.map((group) => toGroup(group, toPeople(group.users_groups)));
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
      where: { user_id: user.id, group_id: group.id },
    });
    if (membership) {
      throw new ConflictException('Usuário já está nesse grupo');
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

  async findActive(userId: string) {
    const memberships = await this.prismaService.users_groups.findMany({
      where: { user_id: userId, groups: { status: true } },
      include: { groups: true },
      orderBy: { groups: { name: 'asc' } },
    });

    return memberships.map((membership) => membership.groups);
  }

  async unassign(input: { suapEnrollment?: string; groupId?: string }) {
    const suapEnrollment = input.suapEnrollment?.trim();
    if (!suapEnrollment || !input.groupId) {
      throw new UnprocessableEntityException(
        'Matrícula e grupo são obrigatórios',
      );
    }

    const user = await this.prismaService.users.findUnique({
      where: { suap_enrollment: suapEnrollment },
    });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    const membership = await this.prismaService.users_groups.findFirst({
      where: { user_id: user.id, group_id: input.groupId },
    });
    if (!membership) throw new NotFoundException('Usuário não está nesse grupo');

    await this.prismaService.users_groups.delete({ where: { id: membership.id } });
    return { id: membership.id, userId: user.id, groupId: input.groupId };
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

function readSchedule(input: {
  name?: string;
  startTime?: string;
  endTime?: string;
}) {
  const name = input.name?.trim();
  const start = parseClock(input.startTime);
  const end = parseClock(input.endTime);
  if (!name || !start || !end) {
    throw new UnprocessableEntityException(
      'Nome, horário de entrada e horário de saída são obrigatórios',
    );
  }

  const dailyWorkloadMinutes = minutesBetween(start, end);
  if (dailyWorkloadMinutes === null) {
    throw new UnprocessableEntityException(
      'A saída precisa ser depois da entrada',
    );
  }

  return { name, start, end, dailyWorkloadMinutes };
}

type GroupPerson = {
  suapEnrollment: string;
  name: string | null;
  role: 'ALUNO' | 'PRESTADOR' | 'SERVIDOR' | null;
};

function toPeople(
  links: {
    users: { suap_enrollment: string; name: string | null; role: GroupPerson['role'] };
  }[],
): GroupPerson[] {
  return links
    .map((link) => ({
      suapEnrollment: link.users.suap_enrollment,
      name: link.users.name,
      role: link.users.role,
    }))
    .sort((left, right) => {
      if (!left.name && right.name) return 1;
      if (left.name && !right.name) return -1;
      const byName = (left.name ?? '').localeCompare(right.name ?? '', 'pt-BR');
      if (byName !== 0) return byName;
      return left.suapEnrollment.localeCompare(right.suapEnrollment, 'pt-BR');
    });
}

function toGroup(
  group: {
    id: string;
    name: string;
    daily_workload_minutes: number;
    start_time: string | null;
    end_time: string | null;
    status: boolean;
    created_at: Date;
    updated_at: Date;
  },
  people: GroupPerson[],
) {
  return {
    id: group.id,
    name: group.name,
    dailyWorkloadMinutes: group.daily_workload_minutes,
    startTime: group.start_time,
    endTime: group.end_time,
    status: group.status,
    members: people.length,
    people,
    createdAt: group.created_at,
    updatedAt: group.updated_at,
  };
}
