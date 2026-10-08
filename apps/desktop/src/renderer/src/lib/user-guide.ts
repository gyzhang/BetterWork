export interface GuideHeading {
  id: string;
  title: string;
  level: number;
  line: number;
}

/** 标题位置与 Markdown 渲染器的源行对应，围栏里的示例不进入目录。 */
export function guideHeadings(content: string): GuideHeading[] {
  const headings: GuideHeading[] = [];
  const used = new Map<string, number>();
  let fence: { character: string; length: number } | undefined;
  for (const [index, line] of content.split('\n').entries()) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/u.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = { character: marker[0] ?? '', length: marker.length };
      else if (marker[0] === fence.character && marker.length >= fence.length) fence = undefined;
      continue;
    }
    if (fence) continue;
    const match = /^\s{0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/u.exec(line);
    if (!match?.[1] || !match[2]) continue;
    const title = match[2].replace(/\[([^\]]+)\]\([^)]+\)/gu, '$1').replace(/[*`]/gu, '');
    const slug = title
      .normalize('NFC')
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}_\-\s]/gu, '')
      .replace(/\s/gu, '-');
    const base = slug || `section-${index + 1}`;
    const ordinal = used.get(base) ?? 0;
    used.set(base, ordinal + 1);
    headings.push({
      id: ordinal ? `${base}-${ordinal}` : base,
      title,
      level: match[1].length,
      line: index + 1,
    });
  }
  return headings;
}

export type GuideTarget =
  | { kind: 'heading'; id: string }
  | { kind: 'example' }
  | { kind: 'image'; url: string }
  | { kind: 'unavailable' };

/** 仅使用随包的指南资源，不把正文链接变成任意文件或网络访问。 */
export function guideTarget(source: string | undefined): GuideTarget {
  if (source?.startsWith('#')) {
    try {
      return { kind: 'heading', id: decodeURIComponent(source.slice(1)) };
    } catch {
      return { kind: 'unavailable' };
    }
  }
  if (source === 'examples/collaboration-notes.md') return { kind: 'example' };
  if (source && /^images\/[a-zA-Z0-9._-]+\.png$/u.test(source)) {
    return { kind: 'image', url: `./${source}` };
  }
  return { kind: 'unavailable' };
}
