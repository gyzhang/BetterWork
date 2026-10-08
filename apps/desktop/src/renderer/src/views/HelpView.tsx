import { createElement, useMemo } from 'react';
import type { Components } from 'react-markdown';

import { Button } from '../components/Button';
import { IconButton } from '../components/IconButton';
import { PageHeader } from '../components/layout/PageHeader';
import { ScrollRegion } from '../components/layout/ScrollRegion';
import { Modal } from '../components/Modal';
import { PopoverMenu } from '../components/PopoverMenu';
import { useUserGuide } from '../hooks/use-user-guide';
import { CloseIcon } from '../icons';
import { guideTarget } from '../lib/user-guide';
import { MarkdownPreview } from '../markdown-preview';

export function HelpPage(): React.JSX.Element {
  const {
    showingExample,
    directoryOpen,
    setDirectoryOpen,
    directoryRef,
    documentRef,
    content,
    headings,
    directory,
    navigate,
    openExample,
    openManual,
    screenshot,
    setScreenshot,
    closeScreenshot,
  } = useUserGuide();
  const componentOverrides = useMemo<Components>(() => {
    const heading: Components['h2'] = ({ node, children, ...props }) =>
      createElement(
        node?.tagName ?? 'h2',
        {
          ...props,
          id: headings.find((item) => item.line === node?.position?.start.line)?.id,
          tabIndex: -1,
        },
        children,
      );
    return {
      h1: heading,
      h2: heading,
      h3: heading,
      h4: heading,
      h5: heading,
      h6: heading,
      a: ({ href, children }) => {
        const target = guideTarget(href);
        if (target.kind !== 'heading' && target.kind !== 'example') return <span>{children}</span>;
        return (
          <a
            href={href}
            onClick={(event) => {
              event.preventDefault();
              if (target.kind === 'example') openExample();
              else navigate(target.id);
            }}
          >
            {children}
          </a>
        );
      },
      img: ({ src, alt }) => {
        const target = guideTarget(src);
        if (target.kind !== 'image') return <span>{alt}</span>;
        const title = alt || '手册截图';
        return (
          <a
            href={target.url}
            aria-label={`放大截图：${title}`}
            onClick={(event) => {
              event.preventDefault();
              event.currentTarget.focus();
              setScreenshot({ url: target.url, title });
            }}
          >
            <img src={target.url} alt={title} loading="lazy" />
          </a>
        );
      },
    };
  }, [headings, navigate, openExample, setScreenshot]);
  return (
    <section className="help-page">
      <PageHeader
        eyebrow="帮助"
        title={showingExample ? '演示材料' : '操作手册'}
        leading={
          showingExample ? (
            <Button variant="quiet" size="sm" onClick={openManual}>
              返回手册
            </Button>
          ) : undefined
        }
        actions={
          <Button
            variant="secondary"
            size="lg"
            ref={directoryRef}
            aria-haspopup="menu"
            aria-expanded={directoryOpen}
            onClick={() => setDirectoryOpen((open) => !open)}
          >
            目录
          </Button>
        }
      />
      <PopoverMenu
        open={directoryOpen}
        anchorRef={directoryRef}
        items={directory.map((heading) => ({ id: heading.id, label: heading.title }))}
        label="操作手册目录"
        align="end"
        onDismiss={() => setDirectoryOpen(false)}
        onSelect={navigate}
      />
      <ScrollRegion ariaLabel="操作手册正文">
        <div className="page-body">
          <div ref={documentRef}>
            <MarkdownPreview
              content={content}
              variant="guide"
              componentOverrides={componentOverrides}
            />
          </div>
        </div>
      </ScrollRegion>
      {screenshot && (
        <Modal variant="viewer" label={screenshot.title} onClose={closeScreenshot}>
          <div className="help-screenshot-toolbar">
            <IconButton label="关闭截图" size="row" icon={CloseIcon} onClick={closeScreenshot} />
          </div>
          <img className="help-screenshot" src={screenshot.url} alt={screenshot.title} />
        </Modal>
      )}
    </section>
  );
}
