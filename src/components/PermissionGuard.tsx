import React from 'react';
import { useAuth } from '../lib/auth';
import { hasPermission } from '../lib/permissionService';
import type { Permission } from '../lib/permissionService';
import AccessDeniedPage from './AccessDeniedPage';

interface PermissionGuardProps {
  permission: Permission;
  onBack?: () => void;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export default function PermissionGuard({ permission, onBack, children, fallback }: PermissionGuardProps) {
  const { profile } = useAuth();

  if (!hasPermission(profile?.role, permission)) {
    if (fallback) return <>{fallback}</>;
    return <AccessDeniedPage onBack={onBack ?? (() => window.history.back())} />;
  }

  return <>{children}</>;
}
