export type Role = 'owner' | 'admin' | 'manager' | 'lead' | 'counter' | 'viewer';

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
  | 'settings.manage'
  | 'academy.manage'
  | 'counting.count'
  | 'counting.approve';

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
    'academy.manage',
    'counting.count','counting.approve',
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
    'academy.manage',
    'counting.count','counting.approve',
  ],
  manager: [
    'products.read',
    'inventory.read','inventory.write',
    'financial.read',
    'full.read','full.write',
    'labels.use',
    'reports.export',
    'academy.manage',
    'counting.count','counting.approve',
  ],
  lead: [
    'products.read',
    'inventory.read','inventory.write',
    'financial.read',
    'full.read','full.write',
    'labels.use',
    'reports.export',
    'academy.manage',
    'counting.count',
  ],
  counter: [
    'products.read',
    'inventory.read','inventory.write',
    'full.read','full.write',
    'labels.use',
    'counting.count',
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
    lead: 'Líder',
    counter: 'Conferente',
    viewer: 'Visualizador',
  };
  return labels[role] ?? role;
}

/** Role badge treatment.
 *
 *  A role is neutral metadata, not a condition needing attention, so it does not
 *  get a loud colour. Previously each of the six roles had its own high-chroma
 *  hue (emerald/blue/violet/teal/amber/zinc) — a palette used for variety rather
 *  than meaning, which also put `violet` outside the project's colour set and
 *  relied on `text-*-400` shades that only read correctly in dark mode.
 *
 *  Now: the two privileged roles carry a quiet accent tint (accent = "this one
 *  can change things"), everything else is neutral surface + muted text. All
 *  values are theme tokens, so both themes are correct by construction. */
export function getRoleBadgeColor(role: Role | string): string {
  const PRIVILEGED = 'bg-accent/10 text-accent border-accent/25';
  const NEUTRAL = 'bg-surface-3 text-fg-muted border-edge';

  const colors: Record<string, string> = {
    owner:   PRIVILEGED,
    admin:   PRIVILEGED,
    manager: NEUTRAL,
    lead:    NEUTRAL,
    counter: NEUTRAL,
    viewer:  NEUTRAL,
  };
  return colors[role] ?? NEUTRAL;
}

export function canManageUsers(role: Role | string | undefined): boolean {
  return hasPermission(role, 'users.manage');
}

export function canWrite(role: Role | string | undefined): boolean {
  return hasPermission(role, 'inventory.write');
}
