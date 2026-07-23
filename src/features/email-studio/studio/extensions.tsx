import { EmailNode } from '@react-email/editor/core';
import { getEmailStudioTheme, type EmailStudioBlockKind } from './config';

export type EmailStudioBlockAttributes = {
  kind: EmailStudioBlockKind;
  title: string;
  body: string;
  href: string;
  imageUrl: string;
  altText: string;
  themeKey: string;
  locked: boolean;
};

function blockAttributes(node: { attrs?: Record<string, unknown> }): EmailStudioBlockAttributes {
  const attrs = node.attrs ?? {};
  return {
    kind: String(attrs.kind || 'text') as EmailStudioBlockKind,
    title: String(attrs.title || ''),
    body: String(attrs.body || ''),
    href: String(attrs.href || ''),
    imageUrl: String(attrs.imageUrl || ''),
    altText: String(attrs.altText || ''),
    themeKey: String(attrs.themeKey || 'valorwell'),
    locked: Boolean(attrs.locked),
  };
}

export const EmailStudioBlock = EmailNode.create({
  name: 'emailStudioBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      kind: { default: 'text' },
      title: { default: '' },
      body: { default: '' },
      href: { default: '' },
      imageUrl: { default: '' },
      altText: { default: '' },
      themeKey: { default: 'valorwell' },
      locked: { default: false },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'section[data-email-studio-block]',
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) return false;
          return {
            kind: element.dataset.emailStudioBlock || 'text',
            title: element.dataset.title || '',
            body: element.dataset.body || '',
            href: element.dataset.href || '',
            imageUrl: element.dataset.imageUrl || '',
            altText: element.dataset.altText || '',
            themeKey: element.dataset.themeKey || 'valorwell',
            locked: element.dataset.locked === 'true',
          };
        },
      },
    ];
  },

  renderHTML({ node }) {
    const attrs = blockAttributes(node);
    const theme = getEmailStudioTheme(attrs.themeKey);
    const summary = [attrs.title, attrs.body].filter(Boolean).join(' — ') || 'Divider';
    return [
      'section',
      {
        'data-email-studio-block': attrs.kind,
        'data-title': attrs.title,
        'data-body': attrs.body,
        'data-href': attrs.href,
        'data-image-url': attrs.imageUrl,
        'data-alt-text': attrs.altText,
        'data-theme-key': attrs.themeKey,
        'data-locked': String(attrs.locked),
        contenteditable: 'false',
        style: [
          'display:block',
          'margin:16px 0',
          'padding:16px 18px',
          `border:1px solid ${theme.accentColor}33`,
          `border-left:4px solid ${theme.accentColor}`,
          'border-radius:8px',
          `background:${theme.backgroundColor}`,
          `color:${theme.textColor}`,
          'font-family:Arial,sans-serif',
        ].join(';'),
      },
      summary,
    ];
  },

  renderToReactEmail({ node }) {
    const attrs = blockAttributes(node);
    const theme = getEmailStudioTheme(attrs.themeKey);

    if (attrs.kind === 'divider') {
      return <hr style={{ border: 0, borderTop: `1px solid ${theme.accentColor}55`, margin: '24px 0' }} />;
    }

    const isQuote = attrs.kind === 'quote';
    const isFooter = attrs.kind === 'social-footer' || attrs.kind === 'compliance-footer';
    const isHero = attrs.kind === 'hero';

    return (
      <section
        style={{
          margin: isFooter ? '24px 0 0' : '18px 0',
          padding: isHero ? '28px 24px' : '18px 20px',
          border: `1px solid ${theme.accentColor}22`,
          borderLeft: isQuote || attrs.kind === 'callout' ? `4px solid ${theme.accentColor}` : undefined,
          borderRadius: isFooter ? '0' : '8px',
          backgroundColor: isFooter ? theme.surfaceColor : theme.backgroundColor,
          color: theme.textColor,
          textAlign: isHero ? 'center' : 'left',
          fontFamily: 'Arial, sans-serif',
          fontSize: isFooter ? '12px' : '15px',
          lineHeight: '1.55',
        }}
      >
        {attrs.imageUrl ? (
          <img
            src={attrs.imageUrl}
            alt={attrs.altText}
            width="560"
            style={{ width: '100%', maxWidth: '560px', height: 'auto', borderRadius: '7px', marginBottom: '16px' }}
          />
        ) : null}
        {attrs.title ? (
          <h2 style={{ margin: '0 0 10px', color: theme.textColor, fontSize: isHero ? '28px' : '20px', lineHeight: '1.25' }}>
            {attrs.title}
          </h2>
        ) : null}
        {attrs.body ? <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{attrs.body}</p> : null}
        {attrs.href ? (
          <p style={{ margin: '16px 0 0' }}>
            <a
              href={attrs.href}
              target="_blank"
              rel="noreferrer"
              style={{
                display: 'inline-block',
                padding: attrs.kind === 'cta' ? '10px 16px' : '0',
                borderRadius: attrs.kind === 'cta' ? '6px' : '0',
                backgroundColor: attrs.kind === 'cta' ? theme.accentColor : 'transparent',
                color: attrs.kind === 'cta' ? '#ffffff' : theme.accentColor,
                fontWeight: 700,
                textDecoration: attrs.kind === 'cta' ? 'none' : 'underline',
              }}
            >
              {attrs.kind === 'video' ? 'Watch video' : attrs.kind === 'cta' ? attrs.title || 'Continue' : 'Open resource'}
            </a>
          </p>
        ) : null}
      </section>
    );
  },
});

export const EmailStudioVariable = EmailNode.create({
  name: 'emailVariable',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      key: { default: 'first_name' },
      label: { default: 'First name' },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-email-variable]',
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) return false;
          return {
            key: element.dataset.emailVariable || 'first_name',
            label: element.dataset.emailVariableLabel || 'First name',
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const key = String(HTMLAttributes.key || 'first_name');
    const label = String(HTMLAttributes.label || key);
    return [
      'span',
      {
        'data-email-variable': key,
        'data-email-variable-label': label,
        contenteditable: 'false',
        style: 'display:inline-block;padding:1px 6px;border-radius:999px;background:#e8f0eb;color:#214c36;font-weight:600;',
      },
      `{{${key}}}`,
    ];
  },

  renderToReactEmail({ node, style }) {
    const key = String(node.attrs?.key || 'first_name');
    return <span style={style}>{`{{${key}}}`}</span>;
  },
});
