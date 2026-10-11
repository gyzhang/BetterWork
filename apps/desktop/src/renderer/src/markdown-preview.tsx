import { useMemo } from 'react';
import type { Components } from 'react-markdown';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import remarkGfm from 'remark-gfm';

import { EChartsBlock } from './echarts-block';

// `Components[T]` 含 `undefined`（每个标签都是可选的）；拆出非空别名，好在
// `exactOptionalPropertyTypes` 下把这些渲染器组装回 `Components` 而不引入显式 undefined。
type CodeComponent = NonNullable<Components['code']>;
type PreComponent = NonNullable<Components['pre']>;
type TableComponent = NonNullable<Components['table']>;

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

/**
 * 判断一个 `<pre>` 里包的是不是 ```` ```echarts ```` 围栏（hast：pre > code.language-echarts）。
 * 命中时交给 `EChartsBlock` 全权渲染，不套默认 `<pre>` 外壳——外壳的 `white-space: pre`
 * 会毁掉回退时 `InlineError` 的排版（ADR-0048 决策 5）。
 */
function isEChartsPre(node: unknown): boolean {
  if (typeof node !== 'object' || node === null) return false;
  const children = (node as { children?: unknown[] }).children;
  if (!Array.isArray(children)) return false;
  const first: unknown = children[0];
  if (typeof first !== 'object' || first === null) return false;
  const properties = (first as { properties?: unknown }).properties;
  if (typeof properties !== 'object' || properties === null) return false;
  const className = (properties as { className?: unknown }).className;
  return Array.isArray(className) && (className as unknown[]).includes('language-echarts');
}

const PreBlock: PreComponent = ({ node, children, ...rest }) => {
  if (isEChartsPre(node)) return <>{children}</>;
  return <pre {...rest}>{children}</pre>;
};

/**
 * 代码块渲染器工厂。`chartsFinal` 由宿主传入：流式期为 `false`，echarts 围栏解析失败只回退
 * 成代码块、不报错；终态为 `true` 才把失败讲给用户（ADR-0048 决策 5）。
 */
const makeCodeBlock = (chartsFinal: boolean): CodeComponent => {
  const CodeBlock: CodeComponent = (props) => {
    const { className, children, ...rest } = props as {
      className?: string;
      children: React.ReactNode;
      [key: string]: unknown;
    };
    const match = /language-(\w+)/.exec(className ?? '');
    const language = match?.[1];

    if (language === 'echarts') {
      return <EChartsBlock code={extractCode(children).replace(/\n$/, '')} final={chartsFinal} />;
    }

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
  return CodeBlock;
};

const documentTable: TableComponent = ({ children }) => (
  <div className="markdown-table" role="region" aria-label="表格，可横向滚动" tabIndex={0}>
    <table>{children}</table>
  </div>
);

const messageTable: TableComponent = ({ children }) => (
  <div
    className="markdown-table message-table"
    role="region"
    aria-label="表格，可横向滚动"
    tabIndex={0}
  >
    <table>{children}</table>
  </div>
);

export function MarkdownPreview({
  content,
  variant = 'document',
  chartsFinal = true,
  componentOverrides,
}: {
  content: string;
  variant?: 'document' | 'message' | 'guide';
  /**
   * 正文是否已终态。缺省 `true`（成果文档、指南等静态正文）；对话流式期由 `MessageBlock`
   * 传 `false`，让未闭合的 echarts 围栏只回退不报错。
   */
  chartsFinal?: boolean;
  componentOverrides?: Components;
}): React.JSX.Element {
  const components = useMemo(() => {
    const resolved: Components = {
      code: makeCodeBlock(chartsFinal),
      pre: PreBlock,
      table: variant === 'message' ? messageTable : documentTable,
    };
    return resolved;
  }, [variant, chartsFinal]);
  return (
    <article className="markdown-preview" data-variant={variant}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{ ...components, ...componentOverrides }}
      >
        {content}
      </ReactMarkdown>
    </article>
  );
}
