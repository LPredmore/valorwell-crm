export type NewsletterTemplate = {
  subject: string | null;
  html: string | null;
  text: string | null;
  preheader: string | null;
};

export type NewsletterRenderValues = {
  newsletter_greeting_name: string;
  sender_name: string;
  unsubscribe_url: string;
  postal_address: string;
};

export type RenderedNewsletterDelivery = {
  subject: string;
  html: string;
  text: string;
  preheader: string | null;
  unsubscribeLink: string;
};

type OutputFormat = "html" | "text";

const TOKEN_PATTERN = /{{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*}}/g;

const CANONICAL_VARIABLES = new Set([
  "newsletter_greeting_name",
  "sender_name",
  "unsubscribe_url",
  "postal_address",
]);

const LEGACY_ALIASES: Readonly<Record<string, keyof NewsletterRenderValues>> = {
  greeting_name: "newsletter_greeting_name",
  recipient_name: "newsletter_greeting_name",
  first_name: "newsletter_greeting_name",
  preferred_name: "newsletter_greeting_name",
  unsubscribe_link: "unsubscribe_url",
  valorwell_postal_address: "postal_address",
};

const KNOWN_DISALLOWED_VARIABLES = new Set([
  "last_name",
  "therapist_name",
  "contact_first_name",
  "contact_display_name",
  "organization_name",
  "organization_type",
  "real_action_summary",
  "cause_area",
  "opportunity_context",
  "approved_source_sentence",
  "staff_first_name",
  "staff_last_name",
  "staff_display_name",
  "staff_role",
]);

export function validateNewsletterTemplateContract(template: NewsletterTemplate): void {
  const unknown = new Set<string>();
  const disallowed = new Set<string>();

  for (const value of [
    template.subject ?? "",
    template.html ?? "",
    template.text ?? "",
    template.preheader ?? "",
  ]) {
    for (const match of value.matchAll(TOKEN_PATTERN)) {
      const requested = match[1].toLowerCase();
      const canonical = LEGACY_ALIASES[requested] ?? requested;
      if (CANONICAL_VARIABLES.has(canonical)) continue;
      if (KNOWN_DISALLOWED_VARIABLES.has(requested)) disallowed.add(requested);
      else unknown.add(requested);
    }
  }

  if (disallowed.size > 0) {
    throw new Error(
      `DISALLOWED_NEWSLETTER_VARIABLE:${Array.from(disallowed).sort().join(",")}`,
    );
  }
  if (unknown.size > 0) {
    throw new Error(
      `UNKNOWN_NEWSLETTER_VARIABLE:${Array.from(unknown).sort().join(",")}`,
    );
  }
}

export function renderNewsletterDelivery(input: {
  template: NewsletterTemplate;
  greetingName: string | null | undefined;
  senderName: string | null | undefined;
  unsubscribeUrl: string;
  postalAddress: string | null | undefined;
}): RenderedNewsletterDelivery {
  validateNewsletterTemplateContract(input.template);

  const values: NewsletterRenderValues = {
    newsletter_greeting_name: normalized(input.greetingName) ?? "Friend",
    sender_name: normalized(input.senderName) ?? "ValorWell",
    unsubscribe_url: required(input.unsubscribeUrl, "unsubscribe_url"),
    postal_address: normalized(input.postalAddress) ?? "",
  };

  const subject = renderTemplate(input.template.subject ?? "", values, "text");
  if (!subject.trim()) throw new Error("NEWSLETTER_SUBJECT_REQUIRED");

  const preheaderSource = normalized(input.template.preheader);
  const preheader = preheaderSource
    ? renderTemplate(preheaderSource, values, "text")
    : null;

  let html = renderTemplate(input.template.html ?? "", values, "html");
  if (!html.trim()) throw new Error("NEWSLETTER_HTML_REQUIRED");

  const hasUnsubscribeMarkup = /unsubscribe/i.test(html);
  if (!hasUnsubscribeMarkup) {
    const footerLines = [
      values.postal_address
        ? `<p style="margin:0 0 8px">${escapeHtml(values.postal_address)}</p>`
        : "",
      `<p style="margin:0"><a href="${escapeHtml(values.unsubscribe_url)}">Unsubscribe from this newsletter</a></p>`,
    ].filter(Boolean).join("");
    html += `<hr><div style="font-size:12px;color:#6b7280">${footerLines}</div>`;
  }

  html = prependHiddenPreheader(html, preheader);

  let text = renderTemplate(input.template.text ?? "", values, "text");
  if (!text.trim()) text = stripHtml(html);
  if (!/unsubscribe/i.test(text)) {
    text += `\n\n${values.postal_address ? `${values.postal_address}\n` : ""}Unsubscribe from this newsletter: ${values.unsubscribe_url}`;
  }

  return {
    subject,
    html,
    text,
    preheader,
    unsubscribeLink: values.unsubscribe_url,
  };
}

export function renderTemplate(
  template: string,
  values: NewsletterRenderValues,
  outputFormat: OutputFormat,
): string {
  return template.replace(TOKEN_PATTERN, (_token, rawKey: string) => {
    const requested = rawKey.toLowerCase();
    const canonical = (LEGACY_ALIASES[requested] ?? requested) as keyof NewsletterRenderValues;
    const value = values[canonical];
    if (value === undefined) {
      throw new Error(`UNKNOWN_NEWSLETTER_VARIABLE:${requested}`);
    }
    return outputFormat === "html" ? escapeHtml(value) : value;
  });
}

export function prependHiddenPreheader(html: string, preheader: string | null): string {
  if (!preheader?.trim()) return html;
  return `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${escapeHtml(preheader)}</div>${html}`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalized(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function required(value: string, key: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`MISSING_NEWSLETTER_VARIABLE:${key}`);
  return trimmed;
}
