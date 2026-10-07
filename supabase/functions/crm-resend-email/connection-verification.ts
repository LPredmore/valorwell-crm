export type ResendDomainRecord = {
  name?: string | null;
  status?: string | null;
};

export type ResendConnectionVerificationInput = {
  fromEmail: string | null | undefined;
  marketingFromEmail: string | null | undefined;
  inboundEmail: string | null | undefined;
  domains: readonly ResendDomainRecord[];
};

export type ResendConnectionVerification = {
  fromEmail: string;
  marketingFromEmail: string | null;
  inboundEmail: string;
  verifiedDomains: string[];
  inboundMode: 'resend_managed' | 'custom_domain';
};

const RESEND_MANAGED_INBOUND_SUFFIX = '.resend.app';

export function verifyResendConnectionSettings(
  input: ResendConnectionVerificationInput,
): ResendConnectionVerification {
  const fromEmail = requireEmail(input.fromEmail, 'sender');
  const marketingFromEmail = optionalEmail(input.marketingFromEmail, 'marketing sender');
  const inboundEmail = requireEmail(input.inboundEmail, 'inbound receiving');

  const senderDomains = unique([
    emailDomain(fromEmail),
    marketingFromEmail ? emailDomain(marketingFromEmail) : null,
  ]);

  for (const domain of senderDomains) {
    requireVerifiedDomain(domain, input.domains);
  }

  const inboundDomain = emailDomain(inboundEmail);
  const inboundIsResendManaged = inboundDomain.endsWith(RESEND_MANAGED_INBOUND_SUFFIX);
  if (!inboundIsResendManaged) {
    requireVerifiedDomain(inboundDomain, input.domains);
  }

  return {
    fromEmail,
    marketingFromEmail,
    inboundEmail,
    verifiedDomains: unique([
      ...senderDomains,
      inboundIsResendManaged ? null : inboundDomain,
    ]),
    inboundMode: inboundIsResendManaged ? 'resend_managed' : 'custom_domain',
  };
}

function requireVerifiedDomain(
  domain: string,
  domains: readonly ResendDomainRecord[],
): void {
  const found = domains.find((row) => normalizeDomain(row.name) === domain);
  if (!found) throw new Error(`The ${domain} domain was not found in Resend`);
  if (found.status !== 'verified') {
    throw new Error(`The ${domain} domain is ${found.status ?? 'not verified'} in Resend`);
  }
}

function requireEmail(value: string | null | undefined, label: string): string {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!isEmail(normalized)) throw new Error(`A valid ${label} email address is required`);
  return normalized;
}

function optionalEmail(value: string | null | undefined, label: string): string | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return null;
  if (!isEmail(normalized)) throw new Error(`A valid ${label} email address is required`);
  return normalized;
}

function emailDomain(email: string): string {
  return email.split('@')[1] ?? '';
}

function normalizeDomain(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase();
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function unique(values: Array<string | null>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}
