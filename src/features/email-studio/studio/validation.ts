import {
  createEmailValidationResult,
  mergeEmailValidationResults,
  validateEmailContentDraft,
  type EmailContentDraft,
  type EmailContentMode,
  type EmailContentScope,
  type EmailEditorDocument,
  type EmailEditorNode,
  type EmailValidationIssue,
  type EmailValidationResult,
} from '../contracts';
import {
  EMAIL_STUDIO_BLOCK_KINDS,
  isEmailStudioBlockAllowed,
  type EmailStudioBlockKind,
} from './config';

export function isSafeEmailUrl(value: string, options: { image?: boolean } = {}): boolean {
  const candidate = value.trim();
  if (!candidate) return true;

  try {
    const parsed = new URL(candidate);
    const allowedProtocols = options.image ? ['https:', 'http:'] : ['https:', 'http:', 'mailto:'];
    return allowedProtocols.includes(parsed.protocol) && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

export function validateEmailStudioEditorDocument(
  document: EmailEditorDocument,
  mode: EmailContentMode,
  scope: EmailContentScope,
): EmailValidationResult {
  const issues: EmailValidationIssue[] = [];
  let complianceFooterCount = 0;

  visitNodes(document, (node, path) => {
    validateLinkMarks(node, path, issues);

    if (node.type === 'image') {
      const src = stringAttribute(node, 'src');
      const alt = stringAttribute(node, 'alt');
      if (src && !isSafeEmailUrl(src, { image: true })) {
        issues.push(error('unsafe_image_url', 'Images must use an HTTP or HTTPS URL.', `${path}.attrs.src`));
      }
      if (src && !alt.trim()) {
        issues.push(error('missing_image_alt_text', 'Email images require meaningful alt text.', `${path}.attrs.alt`));
      }
      return;
    }

    if (node.type !== 'emailStudioBlock') return;

    const kind = stringAttribute(node, 'kind') as EmailStudioBlockKind;
    if (!EMAIL_STUDIO_BLOCK_KINDS.includes(kind)) {
      issues.push(error('unknown_studio_block', `Unknown Email Studio block “${kind || 'missing'}”.`, `${path}.attrs.kind`));
      return;
    }

    if (!isEmailStudioBlockAllowed(kind, mode)) {
      issues.push(error(
        'block_not_allowed_in_mode',
        `${kind} blocks are not allowed in ${mode} email mode.`,
        `${path}.attrs.kind`,
      ));
    }

    if (kind === 'compliance-footer') complianceFooterCount += 1;

    const href = stringAttribute(node, 'href');
    const imageUrl = stringAttribute(node, 'imageUrl');
    const altText = stringAttribute(node, 'altText');

    if (href && !isSafeEmailUrl(href)) {
      issues.push(error('unsafe_block_url', 'Block links must use HTTP, HTTPS, or mailto.', `${path}.attrs.href`));
    }
    if (imageUrl && !isSafeEmailUrl(imageUrl, { image: true })) {
      issues.push(error('unsafe_image_url', 'Block images must use an HTTP or HTTPS URL.', `${path}.attrs.imageUrl`));
    }
    if (imageUrl && !altText.trim()) {
      issues.push(error('missing_image_alt_text', 'Block images require meaningful alt text.', `${path}.attrs.altText`));
    }
  });

  if (mode === 'newsletter' && complianceFooterCount === 0) {
    issues.push(error(
      'missing_compliance_footer',
      'Newsletter mode requires a compliance footer before export.',
      'editorDocument',
    ));
  } else if (scope === 'relationship' && mode === 'campaign' && complianceFooterCount === 0) {
    issues.push(error(
      'missing_compliance_footer',
      'Relationship campaign email requires a compliance footer before export.',
      'editorDocument',
    ));
  } else if (scope === 'client' && mode === 'campaign' && complianceFooterCount === 0) {
    issues.push(warning(
      'recommended_compliance_footer',
      'Consider adding a compliance footer when this campaign is promotional.',
      'editorDocument',
    ));
  }

  if (complianceFooterCount > 1) {
    issues.push(warning(
      'duplicate_compliance_footer',
      'Only one compliance footer is normally needed.',
      'editorDocument',
    ));
  }

  return createEmailValidationResult(dedupeIssues(issues));
}

export function validateEmailStudioDraft(
  draft: EmailContentDraft,
  scope: EmailContentScope,
): EmailValidationResult {
  return mergeEmailValidationResults(
    validateEmailContentDraft(draft, scope),
    validateEmailStudioEditorDocument(draft.editorDocument, draft.mode, scope),
  );
}

function validateLinkMarks(node: EmailEditorNode, path: string, issues: EmailValidationIssue[]) {
  node.marks?.forEach((mark, index) => {
    if (mark.type !== 'link') return;
    const href = typeof mark.attrs?.href === 'string' ? mark.attrs.href : '';
    if (href && !isSafeEmailUrl(href)) {
      issues.push(error('unsafe_link_url', 'Links must use HTTP, HTTPS, or mailto.', `${path}.marks.${index}.attrs.href`));
    }
  });
}

function visitNodes(
  node: EmailEditorNode,
  visitor: (node: EmailEditorNode, path: string) => void,
  path = 'editorDocument',
) {
  visitor(node, path);
  node.content?.forEach((child, index) => visitNodes(child, visitor, `${path}.content.${index}`));
}

function stringAttribute(node: EmailEditorNode, key: string): string {
  const value = node.attrs?.[key];
  return typeof value === 'string' ? value : '';
}

function error(code: string, message: string, path: string): EmailValidationIssue {
  return { code, message, path, severity: 'error' };
}

function warning(code: string, message: string, path: string): EmailValidationIssue {
  return { code, message, path, severity: 'warning' };
}

function dedupeIssues(issues: EmailValidationIssue[]): EmailValidationIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.code}:${issue.path || ''}:${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
