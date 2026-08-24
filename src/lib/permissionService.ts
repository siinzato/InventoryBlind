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
  | 'counting.approve'
  | 'tasks.manage';

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
    'tasks.manage',
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
    'tasks.manage',
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
    'tasks.manage',
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

/** Quem pode criar, editar, ativar e executar automações.
 *
 *  Mesma lista que as policies de escrita de `automations` exigem (migration 051) e
 *  que a Edge Function verifica na execução manual. Existe para a UI não oferecer um
 *  controle que o banco recusaria — não é a barreira, e removê-la não mudaria quem
 *  consegue de fato alterar uma automação.
 *
 *  Não passa por `hasPermission` porque não há permissão 'automations.*' no mapa, e
 *  inventar uma aqui sugeriria uma checagem no servidor que não a lê. Ler
 *  `counting.approve` seria pior: uma automação pode enviar webhook e alterar
 *  responsável, o que não é aprovar contagem. */
export function canManageAutomations(role: Role | string | undefined): boolean {
  return role === 'owner' || role === 'admin' || role === 'manager';
}

/** Who may operate an integration — configure a connection, paste a credential,
 *  trigger a sync, send approved adjustments to the ERP.
 *
 *  The list is duplicated in SYNC_ROLES (src/lib/integrations/authorization.ts),
 *  which is what the Edge Functions actually enforce. This copy exists only so the
 *  UI does not offer buttons that would come back 403 — it is not the barrier, and
 *  removing it would change nothing about who can actually write to an ERP. Kept as
 *  an explicit list rather than routed through hasPermission because there is no
 *  'integrations.*' permission in the map, and inventing one here would imply a
 *  server-side check that does not read it. */
export function canSyncIntegrations(role: Role | string | undefined): boolean {
  return role === 'owner' || role === 'admin' || role === 'manager';
}

export function canWrite(role: Role | string | undefined): boolean {
  return hasPermission(role, 'inventory.write');
}
