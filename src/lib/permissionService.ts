export type Role = 'owner' | 'admin' | 'manager' | 'counter' | 'viewer';

export type Permission =
  | 'products.read'
  | 'products.write'
  | 'inventory.read'
  | 'inventory.write'
  | 'financial.read'
  | 'full.read'
  | 'full.write'
  | 'labels.use'
  | 'reports.export'
  | 'users.manage'
  | 'erp.manage'
  | 'security.view'
  | 'audit.view'
  | 'settings.manage';

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: [
    'products.read','products.write',
    'inventory.read','inventory.write',
    'financial.read',
    'full.read','full.write',
    'labels.use',
    'reports.export',
    'users.manage',
    'erp.manage',
    'security.view',
    'audit.view',
    'settings.manage',
  ],
  admin: [
    'products.read','products.write',
    'inventory.read','inventory.write',
    'financial.read',
    'full.read','full.write',
    'labels.use',
    'reports.export',
    'users.manage',
    'erp.manage',
    'security.view',
    'audit.view',
  ],
  manager: [
    'products.read',
    'inventory.read','inventory.write',
    'financial.read',
    'full.read','full.write',
    'labels.use',
    'reports.export',
  ],
  counter: [
    'products.read',
    'inventory.read','inventory.write',
    'full.read','full.write',
    'labels.use',
  ],
  viewer: [
    'products.read',
    'inventory.read',
    'full.read',
  ],
};

export function hasPermission(role: Role | string | undefined, permission: Permission): boolean {
  if (!role) return false;
  const perms = ROLE_PERMISSIONS[role as Role];
  if (!perms) return false;
  return perms.includes(permission);
}

export function getRoleLabel(role: Role | string): string {
  const labels: Record<string, string> = {
    owner: 'Proprietário',
    admin: 'Administrador',
    manager: 'Gerente',
    counter: 'Conferente',
    viewer: 'Visualizador',
  };
  return labels[role] ?? role;
}

export function getRoleBadgeColor(role: Role | string): string {
  const colors: Record<string, string> = {
    owner:   'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    admin:   'bg-blue-500/15 text-blue-400 border-blue-500/30',
    manager: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
    counter: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    viewer:  'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
  };
  return colors[role] ?? 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30';
}

export function canManageUsers(role: Role | string | undefined): boolean {
  return hasPermission(role, 'users.manage');
}

export function canWrite(role: Role | string | undefined): boolean {
  return hasPermission(role, 'inventory.write');
}
