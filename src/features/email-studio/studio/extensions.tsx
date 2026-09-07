import { EmailNode } from '@react-email/editor/core';
import {
  EMAIL_STUDIO_LAYOUT,
  getEmailStudioTheme,
  type EmailStudioBlockKind,
} from './config';

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

export type EmailStudioBlockPresentation = {
  backgroundColor: string;
  textColor: string;
  titleColor: string;
  borderColor: string;
  borderLeftColor?: string;
  textAlign: 'left' | 'center';
  titleSize: number;
  bodySize: number;
  padding: string;
  borderRadius: number;
  linkKind: 'button' | 'text';
  linkBackgroundColor: string;
  linkColor: string;
  footer: boolean;
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

export function getEmailStudioBlockPresentation(
  kind: EmailStudioBlockKind,
  themeKey: string,
): EmailStudioBlockPresentation {
  const theme = getEmailStudioTheme(themeKey);
  const base: EmailStudioBlockPresentation = {
    backgroundColor: theme.surfaceColor,
    textColor: theme.textColor,
    titleColor: theme.textColor,
    borderColor: theme.borderColor,
    textAlign: 'left',
    titleSize: 20,
    bodySize: 15,
    padding: '22px 24px',
    borderRadius: EMAIL_STUDIO_LAYOUT.cardRadius,
    linkKind: 'text',
    linkBackgroundColor: 'transparent',
    linkColor: theme.accentColor,
    footer: false,
  };

  if (kind === 'hero') {
    return {
      ...base,
      backgroundColor: theme.accentColor,
      textColor: theme.accentTextColor,
      titleColor: theme.accentTextColor,
      borderColor: theme.accentColor,
      textAlign: 'center',
      titleSize: 30,
      bodySize: 16,
      padding: '34px 30px',
      borderRadius: 14,
    };
  }

  if (kind === 'callout') {
    return {
      ...base,
      backgroundColor: theme.subtleSurfaceColor,
      borderLeftColor: theme.secondaryAccentColor,
    };
  }

  if (kind === 'quote') {
    return {
      ...base,
      backgroundColor: theme.highlightColor,
      borderLeftColor: theme.secondaryAccentColor,
      titleSize: 17,
    };
  }

  if (kind === 'stats') {
    return {
      ...base,
      backgroundColor: theme.textColor,
      textColor: theme.accentTextColor,
      titleColor: theme.accentTextColor,
      borderColor: theme.textColor,
      textAlign: 'center',
      titleSize: 22,
      bodySize: 17,
    };
  }

  if (kind === 'bty' || kind === 'ocs-resource') {
    return {
      ...base,
      backgroundColor: theme.highlightColor,
    };
  }

  if (kind === 'cta') {
    return {
      ...base,
      backgroundColor: theme.subtleSurfaceColor,
      textAlign: 'center',
      linkKind: 'button',
      linkBackgroundColor: theme.buttonColor,
      linkColor: theme.buttonTextColor,
    };
  }

  if (kind === 'social-footer' || kind === 'compliance-footer') {
    return {
      ...base,
      backgroundColor: theme.backgroundColor,
      textColor: theme.mutedTextColor,
      titleColor: theme.textColor,
      borderColor: theme.backgroundColor,
      titleSize: 15,
      bodySize: 12,
      padding: kind === 'compliance-footer' ? '12px 18px' : '18px 20px',
      borderRadius: 0,
      footer: true,
    };
  }

  return base;
}

function linkLabel(kind: EmailStudioBlockKind): string {
  if (kind === 'video') return 'Watch video';
  if (kind === 'bty') return 'Explore Beyond The Yellow';
  if (kind === 'social-footer') return 'Visit ValorWell';
  if (kind === 'cta') return 'Get started';
  return 'Open resource';
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
    const presentation = getEmailStudioBlockPresentation(attrs.kind, attrs.themeKey);
    const summary = [attrs.title, attrs.body].filter(Boolean).join(' — ') || 'Divider';
    const borderLeft = presentation.borderLeftColor
      ? `border-left:4px solid ${presentation.borderLeftColor}`
      : '';
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
          'box-sizing:border-box',
          `width:100%`,
          `max-width:${EMAIL_STUDIO_LAYOUT.contentWidth}px`,
          `margin:${EMAIL_STUDIO_LAYOUT.sectionGap}px auto`,
          `padding:${presentation.padding}`,
          `border:1px solid ${presentation.borderColor}`,
          borderLeft,
          `border-radius:${presentation.borderRadius}px`,
          `background:${presentation.backgroundColor}`,
          `color:${presentation.textColor}`,
          `font-family:${theme.fontFamily}`,
          `text-align:${presentation.textAlign}`,
        ].filter(Boolean).join(';'),
      },
      summary,
    ];
  },

  renderToReactEmail({ node }) {
    const attrs = blockAttributes(node);
    const theme = getEmailStudioTheme(attrs.themeKey);
    const presentation = getEmailStudioBlockPresentation(attrs.kind, attrs.themeKey);

    if (attrs.kind === 'divider') {
      return (
        <hr
          style={{
            width: '100%',
            maxWidth: `${EMAIL_STUDIO_LAYOUT.contentWidth}px`,
            border: 0,
            borderTop: `1px solid ${theme.borderColor}`,
            margin: '26px auto',
          }}
        />
      );
    }

    const isHero = attrs.kind === 'hero';

    return (
      <section
        style={{
          boxSizing: 'border-box',
          width: '100%',
          maxWidth: `${EMAIL_STUDIO_LAYOUT.contentWidth}px`,
          margin: presentation.footer ? '12px auto 0' : `${EMAIL_STUDIO_LAYOUT.sectionGap}px auto`,
          padding: presentation.padding,
          border: `1px solid ${presentation.borderColor}`,
          borderLeft: presentation.borderLeftColor ? `4px solid ${presentation.borderLeftColor}` : undefined,
          borderRadius: `${presentation.borderRadius}px`,
          backgroundColor: presentation.backgroundColor,
          color: presentation.textColor,
          textAlign: presentation.textAlign,
          fontFamily: theme.fontFamily,
          fontSize: `${presentation.bodySize}px`,
          lineHeight: '1.6',
        }}
      >
        {isHero ? (
          <p
            style={{
              margin: '0 0 10px',
              color: theme.secondaryAccentColor,
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '1.8px',
              textTransform: 'uppercase',
            }}
          >
            {theme.label}
          </p>
        ) : null}
        {attrs.imageUrl ? (
          <img
            src={attrs.imageUrl}
            alt={attrs.altText}
            width="552"
            style={{
              display: 'block',
              width: '100%',
              maxWidth: '552px',
              height: 'auto',
              borderRadius: `${EMAIL_STUDIO_LAYOUT.imageRadius}px`,
              margin: isHero ? '0 auto 20px' : '0 0 18px',
            }}
          />
        ) : null}
        {attrs.title ? (
          <h2
            style={{
              margin: '0 0 10px',
              color: presentation.titleColor,
              fontSize: `${presentation.titleSize}px`,
              lineHeight: '1.25',
              letterSpacing: isHero ? '-0.4px' : '0',
            }}
          >
            {attrs.title}
          </h2>
        ) : null}
        {attrs.body ? (
          <p
            style={{
              margin: 0,
              color: presentation.textColor,
              whiteSpace: 'pre-wrap',
            }}
          >
            {attrs.body}
          </p>
        ) : null}
        {attrs.href ? (
          <p style={{ margin: '18px 0 0' }}>
            <a
              href={attrs.href}
              target="_blank"
              rel="noreferrer"
              style={{
                display: 'inline-block',
                padding: presentation.linkKind === 'button' ? '12px 20px' : '0',
                borderRadius: presentation.linkKind === 'button' ? '7px' : '0',
                backgroundColor: presentation.linkBackgroundColor,
                color: presentation.linkColor,
                fontWeight: 700,
                textDecoration: presentation.linkKind === 'button' ? 'none' : 'underline',
              }}
            >
              {linkLabel(attrs.kind)}
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
