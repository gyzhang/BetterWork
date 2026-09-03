import ReactMarkdown from 'react-markdown';

export function MarkdownPreview({ content }: { content: string }): React.JSX.Element {
  return <article className="markdown-preview"><ReactMarkdown>{content}</ReactMarkdown></article>;
}
