import {
  EMAIL_CONTENT_MODES,
  EMAIL_EDITOR_SCHEMA_VERSION,
  createEmailValidationResult,
  isEmailEditorDocument,
  type EmailContentDraft,
  type EmailEditorDocument,
  type EmailEditorNode,
  type EmailValidationIssue,
  type EmailValidationResult,
} from './document';
import {
  extractEmailTemplateVariableKeys,
  resolveEmailVariableKey,
  type EmailContentScope,
} from './variables';

export function validateEmailEditorDocumentVariables(
  document: EmailEditorDocument,
  scope: EmailContentScope,
): EmailValidationResult {
  const issues: EmailValidationIssue[] = [];

  visitNodes(document, (node, path) => {
    if (node.type !== 'emailVariable') return;
    const key = typeof node.attrs?.key === 'string' ? node.attrs.key : '';
    if (!key) {
      issues.push({
        code: 'missing_variable_key',
        message: 'Structured email variable nodes require a variable key.',
        severity: 'error',
        path,
      });
      return;
    }

    const resolution = resolveEmailVariableKey(key, scope);
    if (resolution.status === 'unknown') {
      issues.push({
        code: 'unknown_variable',
        message: `Unknown email variable {{${key}}}.`,
        severity: 'error',
        path,
        variableKey: key,
      });
    } else if (resolution.status === 'disallowed') {
      issues.push({
        code: 'disallowed_variable_scope',
        message: `Email variable {{${key}}} is not available in ${scope} content.`,
        severity: 'error',
        path,
        variableKey: key,
      });
    } else if (resolution.aliasUsed && resolution.canonicalKey) {
      issues.push({
        code: 'legacy_variable_alias',
        message: `Legacy variable {{${key}}} should be replaced with {{${resolution.canonicalKey}}}.`,
        severity: 'warning',
        path,
        variableKey: key,
      });
    }
  });

  return createEmailValidationResult(issues);
}

export function validateEmailContentDraft(
  draft: EmailContentDraft,
  scope: EmailContentScope,
): EmailValidationResult {
  const issues: EmailValidationIssue[] = [];

  if (draft.schemaVersion !== EMAIL_EDITOR_SCHEMA_VERSION) {
    issues.push({
      code: 'unsupported_schema_version',
      message: `Email editor schema version ${draft.schemaVersion} is not supported.`,
      severity: 'error',
      path: 'schemaVersion',
    });
  }

  if (!EMAIL_CONTENT_MODES.includes(draft.mode)) {
    issues.push({
      code: 'invalid_content_mode',
      message: 'Email content mode is invalid.',
      severity: 'error',
      path: 'mode',
    });
  }

  if (!isEmailEditorDocument(draft.editorDocument)) {
    issues.push({
      code: 'invalid_editor_document',
      message: 'Email editor JSON must be a TipTap document.',
      severity: 'error',
      path: 'editorDocument',
    });
  } else {
    issues.push(...validateEmailEditorDocumentVariables(draft.editorDocument, scope).issues);
  }

  if (!draft.renderedHtml.trim()) {
    issues.push({
      code: 'missing_rendered_html',
      message: 'Rendered email HTML is required.',
      severity: 'error',
      path: 'renderedHtml',
    });
  }

  if (!draft.renderedText.trim()) {
    issues.push({
      code: 'missing_rendered_text',
      message: 'Rendered plain-text email content is required.',
      severity: 'error',
      path: 'renderedText',
    });
  }

  if (!draft.themeKey.trim()) {
    issues.push({
      code: 'missing_theme_key',
      message: 'An email theme key is required.',
      severity: 'error',
      path: 'themeKey',
    });
  }

  if (draft.preheader && draft.preheader.length > 200) {
    issues.push({
      code: 'long_preheader',
      message: 'Email preview text should be 200 characters or fewer.',
      severity: 'warning',
      path: 'preheader',
    });
  }

  issues.push(...validateRenderedTokens(draft.renderedHtml, scope, 'renderedHtml'));
  issues.push(...validateRenderedTokens(draft.renderedText, scope, 'renderedText'));

  return createEmailValidationResult(dedupeIssues(issues));
}

export function mergeEmailValidationResults(...results: EmailValidationResult[]): EmailValidationResult {
  return createEmailValidationResult(dedupeIssues(results.flatMap((result) => result.issues)));
}

function validateRenderedTokens(value: string, scope: EmailContentScope, path: string): EmailValidationIssue[] {
  const issues: EmailValidationIssue[] = [];
  for (const key of extractEmailTemplateVariableKeys(value)) {
    const resolution = resolveEmailVariableKey(key, scope);
    if (resolution.status === 'unknown') {
      issues.push({
        code: 'unknown_variable',
        message: `Unknown email variable {{${key}}}.`,
        severity: 'error',
        path,
        variableKey: key,
      });
    } else if (resolution.status === 'disallowed') {
      issues.push({
        code: 'disallowed_variable_scope',
        message: `Email variable {{${key}}} is not available in ${scope} content.`,
        severity: 'error',
        path,
        variableKey: key,
      });
    } else if (resolution.aliasUsed && resolution.canonicalKey) {
      issues.push({
        code: 'legacy_variable_alias',
        message: `Legacy variable {{${key}}} should be replaced with {{${resolution.canonicalKey}}}.`,
        severity: 'warning',
        path,
        variableKey: key,
      });
    }
  }
  return issues;
}

function visitNodes(
  node: EmailEditorNode,
  visitor: (node: EmailEditorNode, path: string) => void,
  path = 'editorDocument',
) {
  visitor(node, path);
  node.content?.forEach((child, index) => visitNodes(child, visitor, `${path}.content.${index}`));
}

function dedupeIssues(issues: EmailValidationIssue[]): EmailValidationIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.code}:${issue.path ?? ''}:${issue.variableKey ?? ''}:${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
