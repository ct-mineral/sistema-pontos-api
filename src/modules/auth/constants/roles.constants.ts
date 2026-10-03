export const ROLE_BY_SUAP_TYPE = {
  Aluno: 'ALUNO',
  'Prestador de Serviço': 'PRESTADOR',
  Servidor: 'SERVIDOR',
} as const;

export type UserRole =
  (typeof ROLE_BY_SUAP_TYPE)[keyof typeof ROLE_BY_SUAP_TYPE];

export type AuthenticatedUser = {
  id: string;
  suapEnrollment: string;
  name: string | null;
  photo: string | null;
  role: UserRole;
};
