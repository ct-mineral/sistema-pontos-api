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
export class WorkloadAdjustmentsService {
  constructor(private readonly prismaService: PrismaService) {}

  async create(input: {
    suapEnrollment?: string;
    groupId?: string;
    startTime?: string;
    endTime?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const suapEnrollment = input.suapEnrollment?.trim();
    const groupId = input.groupId?.trim();
    const start = parseClock(input.startTime);
    const end = parseClock(input.endTime);
    const startDate = parseDate(input.startDate);
    const endDate = input.endDate ? parseDate(input.endDate) : null;

    if (
      !suapEnrollment ||
      !groupId ||
      !start ||
      !end ||
      !startDate ||
      (input.endDate && !endDate)
    ) {
      throw new UnprocessableEntityException('Dados do ajuste são inválidos');
    }

    const dailyWorkloadMinutes = minutesBetween(start, end);
    if (dailyWorkloadMinutes === null) {
      throw new UnprocessableEntityException(
        'A saída precisa ser depois da entrada',
      );
    }

    if (endDate && endDate < startDate) {
      throw new UnprocessableEntityException(
        'A data final precisa ser igual ou posterior à inicial',
      );
    }

    const user = await this.prismaService.users.findUnique({
      where: { suap_enrollment: suapEnrollment },
    });
    if (!user?.status) throw new NotFoundException('Usuário não encontrado');

    const group = await this.prismaService.groups.findUnique({
      where: { id: groupId },
    });
    if (!group?.status) throw new NotFoundException('Grupo não encontrado');

    const membership = await this.prismaService.users_groups.findFirst({
      where: { user_id: user.id, group_id: group.id },
    });
    if (!membership) {
      throw new UnprocessableEntityException('Usuário não está nesse grupo');
    }

    const overlap = await this.prismaService.workload_adjustments.findFirst({
      where: {
        user_id: user.id,
        group_id: group.id,
        AND: [
          { OR: [{ end_date: null }, { end_date: { gte: startDate } }] },
          endDate ? { start_date: { lte: endDate } } : {},
        ],
      },
    });
    if (overlap) {
      throw new ConflictException('Já existe ajuste nesse período');
    }

    const adjustment = await this.prismaService.workload_adjustments.create({
      data: {
        id: randomUUID(),
        user_id: user.id,
        daily_workload_minutes: dailyWorkloadMinutes,
        start_time: start.text,
        end_time: end.text,
        group_id: group.id,
        start_date: startDate,
        end_date: endDate,
        created_at: new Date(),
      },
      include: {
        users: { select: { suap_enrollment: true } },
        groups: { select: { id: true, name: true } },
      },
    });

    return toAdjustment(adjustment);
  }

  async list(suapEnrollment?: string) {
    const enrollment = suapEnrollment?.trim();
    const adjustments = await this.prismaService.workload_adjustments.findMany({
      where: enrollment
        ? { users: { suap_enrollment: enrollment } }
        : undefined,
      include: {
        users: { select: { suap_enrollment: true } },
        groups: { select: { id: true, name: true } },
      },
      orderBy: { start_date: 'desc' },
    });

    return adjustments.map(toAdjustment);
  }

  findCoveringAll(userId: string, day: Date) {
    return this.prismaService.workload_adjustments.findMany({
      where: {
        user_id: userId,
        start_date: { lte: day },
        OR: [{ end_date: null }, { end_date: { gte: day } }],
      },
      orderBy: { start_date: 'desc' },
    });
  }
}

function toAdjustment(adjustment: {
  id: string;
  daily_workload_minutes: number;
  start_time: string | null;
  end_time: string | null;
  start_date: Date;
  end_date: Date | null;
  created_at: Date;
  users: { suap_enrollment: string };
  groups: { id: string; name: string } | null;
}) {
  return {
    id: adjustment.id,
    suapEnrollment: adjustment.users.suap_enrollment,
    groupId: adjustment.groups?.id ?? null,
    groupName: adjustment.groups?.name ?? null,
    dailyWorkloadMinutes: adjustment.daily_workload_minutes,
    startTime: adjustment.start_time,
    endTime: adjustment.end_time,
    startDate: adjustment.start_date,
    endDate: adjustment.end_date,
    createdAt: adjustment.created_at,
  };
}

function parseDate(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;

  return valid ? date : null;
}
