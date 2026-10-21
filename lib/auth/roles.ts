import type { UserRole } from '@prisma/client'

// Client-safe (tanpa next/headers / jose) — boleh diimpor Client Component.
// Satu sumber untuk hierarki role; lib/auth/session.ts me-re-export dari sini.
export const ADMIN_ROLES: UserRole[]       = ['admin', 'manager', 'superadmin']
export const MANAGER_ROLES: UserRole[]     = ['manager', 'superadmin']
export const SUPERADMIN_ROLES: UserRole[]  = ['superadmin']
