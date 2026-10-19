import { dateOnly } from './day.js';

export const allowanceInclude = {
  users: { select: { id: true, suap_enrollment: true, name: true } },
  reviewer: { select: { name: true } },
  groups: { select: { id: true, name: true } },
  allowance_documents: { select: { id: true, file_name: true } },
} as const;

export function safeFileName(original: string, mimeType: string) {
  const base = original.split(/[/\\]/).pop()?.replace(/[^\w.\- ()áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]/g, '') || 'documento';
  const trimmed = base.slice(0, 180);
  const extension = mimeType === 'application/pdf' ? '.pdf' : mimeType === 'image/png' ? '.png' : mimeType === 'image/webp' ? '.webp' : '.jpg';
  return trimmed.toLowerCase().endsWith(extension) ? trimmed : `${trimmed}${extension}`;
}

export function toAllowance(row: {
  id: string;
  minutes: number;
  reason: string;
  status: 'PENDENTE' | 'APROVADO' | 'RECUSADO';
  day: Date;
  reviewed_at: Date | null;
  users: { id: string; suap_enrollment: string; name: string | null };
  reviewer: { name: string | null } | null;
  groups: { id: string; name: string };
  allowance_documents: { id: string; file_name: string }[];
}) {
  return {
    id: row.id,
    userId: row.users.id,
    suapEnrollment: row.users.suap_enrollment,
    name: row.users.name,
    groupId: row.groups.id,
    groupName: row.groups.name,
    day: dateOnly(row.day),
    minutes: row.minutes,
    reason: row.reason,
    status: row.status,
    documents: row.allowance_documents.map((document) => ({
      id: document.id,
      fileName: document.file_name,
    })),
    reviewerName: row.reviewer?.name ?? null,
    reviewedAt: row.reviewed_at,
  };
}
