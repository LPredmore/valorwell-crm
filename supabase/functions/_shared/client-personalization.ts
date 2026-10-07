export type ClientSalutationSource = {
  pat_name_preferred?: string | null;
  pat_name_f?: string | null;
};

function normalizedName(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Canonical client salutation for client-facing communications.
 *
 * Prefer the client's chosen name, then legal first name, then a neutral
 * greeting. Keep this helper server-side so campaign and direct-email
 * delivery cannot drift independently.
 */
export function resolveClientSalutation(client: ClientSalutationSource): string {
  return normalizedName(client.pat_name_preferred)
    ?? normalizedName(client.pat_name_f)
    ?? "there";
}

export function clientGreetingVariables(
  client: ClientSalutationSource,
): { first_name: string; preferred_name: string } {
  const greeting = resolveClientSalutation(client);
  return {
    first_name: greeting,
    preferred_name: greeting,
  };
}
