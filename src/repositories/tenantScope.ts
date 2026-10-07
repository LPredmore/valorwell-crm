export function requireOperatingTenant(
  tenantId: string | null | undefined,
): string {
  const normalized = tenantId?.trim();
  if (!normalized) {
    throw new Error('Current CRM operating tenant is required');
  }
  return normalized;
}

export function assertEntityTenant(
  selectedTenantId: string,
  entityTenantId: string,
  entityLabel: string,
): void {
  if (entityTenantId !== selectedTenantId) {
    throw new Error(`${entityLabel} does not belong to the current CRM operating tenant`);
  }
}
