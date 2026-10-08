import type { Components } from 'react-markdown';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import remarkGfm from 'remark-gfm';

const getTheme = (): typeof oneLight => {
  const root = document.documentElement;
  return root.getAttribute('data-theme') === 'dark' ? oneDark : oneLight;
};

const extractCode = (children: React.ReactNode): string => {
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) {
    return children.map((child) => (typeof child === 'string' ? child : '')).join('');
  }
  return '';
};

const CodeBlock: Components['code'] = (props) => {
  const { className, children, ...rest } = props as {
    className?: string;
    children: React.ReactNode;
    [key: string]: unknown;
  };
  const match = /language-(\w+)/.exec(className ?? '');
  const language = match?.[1];

  if (!language) {
    return (
      <code className={className} {...rest}>
        {children}
      </code>
    );
  }

  const code = extractCode(children).replace(/\n$/, '');

  return (
    <SyntaxHighlighter
      language={language}
      style={getTheme()}
      customStyle={{ background: 'transparent', padding: 0, margin: 0 }}
      codeTagProps={{ style: { font: 'inherit' } }}
      PreTag="div"
    >
      {code}
    </SyntaxHighlighter>
  );
};

const components: Components = {
  code: CodeBlock,
  table: ({ children }) => (
    <div className="markdown-table" role="region" aria-label="表格，可横向滚动" tabIndex={0}>
      <table>{children}</table>
    </div>
  ),
};

const messageComponents: Components = {
  ...components,
  table: ({ children }) => (
    <div
      className="markdown-table message-table"
      role="region"
      aria-label="表格，可横向滚动"
      tabIndex={0}
    >
      <table>{children}</table>
    </div>
  ),
};

export function MarkdownPreview({
  content,
  variant = 'document',
  componentOverrides,
}: {
  content: string;
  variant?: 'document' | 'message' | 'guide';
  componentOverrides?: Components;
}): React.JSX.Element {
  return (
    <article className="markdown-preview" data-variant={variant}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          ...(variant === 'message' ? messageComponents : components),
          ...componentOverrides,
        }}
      >
        {content}
      </ReactMarkdown>
    </article>
  );
}
