import { EmailNode } from '@react-email/editor/core';

const CALLOUT_STYLE =
  'padding: 16px 18px; background: #f4f7f5; border-left: 4px solid #315b45; border-radius: 6px; margin: 16px 0; color: #173326;';

export const ValorWellCallout = EmailNode.create({
  name: 'valorWellCallout',
  group: 'block',
  content: 'inline*',

  parseHTML() {
    return [{ tag: 'div[data-valorwell-callout]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      {
        ...HTMLAttributes,
        'data-valorwell-callout': '',
        style: CALLOUT_STYLE,
      },
      0,
    ];
  },

  renderToReactEmail({ children, style }) {
    return (
      <div
        style={{
          ...style,
          padding: '16px 18px',
          backgroundColor: '#f4f7f5',
          borderLeft: '4px solid #315b45',
          borderRadius: '6px',
          margin: '16px 0',
          color: '#173326',
        }}
      >
        {children}
      </div>
    );
  },
});

export const EmailVariable = EmailNode.create({
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
        style:
          'display: inline-block; padding: 1px 6px; border-radius: 999px; background: #e8f0eb; color: #214c36; font-weight: 600;',
      },
      `{{${key}}}`,
    ];
  },

  renderToReactEmail({ node, style }) {
    const key = String(node.attrs.key || 'first_name');
    return <span style={style}>{`{{${key}}}`}</span>;
  },
});
