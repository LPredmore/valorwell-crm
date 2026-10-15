export const crmAuthRedirects = Object.freeze([
  'https://crm.valorwell.org/auth',
  'https://crm.valorwell.org/auth?flow=invite',
  'https://crm.valorwell.org/auth?flow=recovery',
]);

/** Plan an additive redirect change. Never return Site URL or template writes. */
export function planCrmAuthRedirects(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)
    || !Object.hasOwn(config, 'uri_allow_list')
    || (config.uri_allow_list !== null && typeof config.uri_allow_list !== 'string')) {
    throw new Error('Unrecognized Auth configuration; no changes prepared.');
  }
  const original = config.uri_allow_list ?? '';
  const existing = original.split(',').map(value => value.trim()).filter(Boolean);
  const missing = crmAuthRedirects.filter(value => !existing.includes(value));
  // Keep the existing string verbatim, including wildcard and other-portal entries.
  const combined = missing.length ? [original, ...missing].filter(Boolean).join(',') : original;
  return { missing, patch: missing.length ? { uri_allow_list: combined } : null };
}

export function templateRoutingEvidence(content) {
  if (typeof content !== 'string' || !content.trim()) return { state: 'unknown' };
  return {
    state: 'inspection_required',
    usesConfirmationUrl: /{{\s*\.ConfirmationURL\s*}}/.test(content),
    containsClientPortal: /client\.valorwell\.org/i.test(content),
    containsStaffPortal: /emr\.valorwell\.org/i.test(content),
  };
}
