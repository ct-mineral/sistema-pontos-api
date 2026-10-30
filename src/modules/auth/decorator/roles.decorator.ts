import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '../constants/roles.constants.js';

export const ROLES_KEY = 'roles';
export const ALLOW_VIEWER_KEY = 'allowViewer';

export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
export const AllowViewer = () => SetMetadata(ALLOW_VIEWER_KEY, true);
