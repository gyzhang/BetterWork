import '../../apps/desktop/src/renderer/src/styles.css';
import './ui-render-fixture.css';

import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { applyAppearance, colorSchemes } from '../../apps/desktop/src/renderer/src/appearance';
import { Badge } from '../../apps/desktop/src/renderer/src/components/Badge';
import { Button } from '../../apps/desktop/src/renderer/src/components/Button';
import { Card } from '../../apps/desktop/src/renderer/src/components/Card';
import { Disclosure } from '../../apps/desktop/src/renderer/src/components/Disclosure';
import { EmptyNotice } from '../../apps/desktop/src/renderer/src/components/EmptyState';
import { Field } from '../../apps/desktop/src/renderer/src/components/Field';
import { FieldSelect } from '../../apps/desktop/src/renderer/src/components/FieldSelect';
import { InlineError } from '../../apps/desktop/src/renderer/src/components/InlineError';
import { PageHeader } from '../../apps/desktop/src/renderer/src/components/layout/PageHeader';
import { PageToolbar } from '../../apps/desktop/src/renderer/src/components/layout/PageToolbar';
import { ScrollRegion } from '../../apps/desktop/src/renderer/src/components/layout/ScrollRegion';
import { ViewContainer } from '../../apps/desktop/src/renderer/src/components/layout/ViewContainer';
import { Modal } from '../../apps/desktop/src/renderer/src/components/Modal';
import { PopoverMenu } from '../../apps/desktop/src/renderer/src/components/PopoverMenu';
import { TextField } from '../../apps/desktop/src/renderer/src/components/TextField';

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`缺测试元素 ${selector}`);
  return element;
}

function check(condition: boolean, reason: string): void {
  if (!condition) throw new Error(reason);
}

function layoutChecks(): object {
  check(document.documentElement.scrollWidth <= innerWidth, '页面出现横向溢出');
  const header = requireElement<HTMLElement>('.page-header');
  check(Math.abs(header.getBoundingClientRect().height - 70) < 1, '页头离开 70px 基线');
  const body = requireElement<HTMLElement>('.page-body').getBoundingClientRect();
  check(body.width <= 860 && body.left >= 23, '正文版心宽度或留白漂移');
  const card = requireElement<HTMLElement>('.card');
  const cardStyle = getComputedStyle(card);
  check(cardStyle.padding === '12px 16px' && cardStyle.borderRadius === '10px', '卡片外壳档位漂移');
  const controlHeights = {} as Record<string, number>;
  for (const size of ['sm', 'md', 'lg']) {
    const field = requireElement<HTMLElement>(`#fixture-input-${size}`);
    const button = requireElement<HTMLElement>(`#fixture-button-${size}`);
    const select = requireElement<HTMLElement>(`#fixture-select-${size}`);
    const height = button.getBoundingClientRect().height;
    check(
      Math.abs(field.getBoundingClientRect().height - height) <= 1 &&
        Math.abs(select.getBoundingClientRect().height - height) <= 1,
      `${size} 输入/选择/按钮不等高：${field.getBoundingClientRect().height}/${select.getBoundingClientRect().height}/${height}`,
    );
    controlHeights[size] = height;
  }
  for (const element of document.querySelectorAll<HTMLElement>('p, label'))
    check(Number.parseFloat(getComputedStyle(element).fontSize) >= 12, '产品文本小于 12px');
  const canvas = getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim();
  check(canvas.length > 0, '主题没有画布 Token');
  return {
    viewport: [innerWidth, innerHeight],
    bodyWidth: body.width,
    canvas,
    cardPadding: cardStyle.padding,
    controlHeights,
  };
}

function overlayChecks(kind: 'modal' | 'menu'): object {
  const panel = requireElement<HTMLElement>(
    kind === 'modal' ? '[aria-modal="true"]' : '[role="menu"]',
  );
  const rect = panel.getBoundingClientRect();
  check(
    rect.left >= 0 &&
      rect.right <= innerWidth + 1 &&
      rect.top >= 0 &&
      rect.bottom <= innerHeight + 1,
    `${kind} 超出视口`,
  );
  if (kind === 'modal') {
    check(requireElement<HTMLElement>('main').hasAttribute('inert'), '模态没有使主页面 inert');
    check(panel.contains(document.activeElement), '模态初始焦点不在面板内');
  } else check(panel.contains(document.activeElement), '菜单初始焦点不在菜单内');
  return { kind, width: rect.width, height: rect.height };
}

function focusChecks(): object {
  const active = document.activeElement;
  check(
    active instanceof HTMLElement && active.matches(':focus-visible'),
    '真实键盘聚焦没有可见焦点状态',
  );
  if (!(active instanceof HTMLElement)) throw new Error('缺焦点目标');
  const style = getComputedStyle(active);
  const width = Number.parseFloat(style.outlineWidth);
  const inward = -Number.parseFloat(style.outlineOffset);
  check(width >= 2 && inward >= width + 1, '焦点环未完整落在盒内并保留分隔缝');
  return { outline: style.outlineWidth, offset: style.outlineOffset };
}

declare global {
  interface Window {
    uiRenderChecks?: {
      layout: typeof layoutChecks;
      overlay: typeof overlayChecks;
      focus: typeof focusChecks;
    };
  }
}

function FixturePage(): React.JSX.Element {
  const [modal, setModal] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuAnchor = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const query = new URLSearchParams(location.search);
    const mode = query.get('mode') === 'dark' ? 'dark' : 'light';
    const scheme = colorSchemes.find((item) => item.id === query.get('scheme'))?.id ?? 'jade';
    applyAppearance({ mode, scheme });
    window.uiRenderChecks = { layout: layoutChecks, overlay: overlayChecks, focus: focusChecks };
    document.documentElement.dataset.fixtureReady = 'true';
  }, []);
  return (
    <>
      <main className="fixture-main">
        <section className="experts-page">
          <PageHeader
            eyebrow="组件回归"
            title="可复用页面的真实渲染"
            actions={
              <>
                <Button size="lg" id="fixture-modal" onClick={() => setModal(true)}>
                  打开表单
                </Button>
                <Button
                  size="lg"
                  id="fixture-menu"
                  ref={menuAnchor}
                  aria-haspopup="menu"
                  aria-expanded={menu}
                  onClick={() => setMenu(true)}
                >
                  更多
                </Button>
              </>
            }
          />
          <ScrollRegion ariaLabel="测试页面正文">
            <div className="page-body">
              <PageToolbar ariaLabel="筛选">
                <Field label="搜索资料" controlId="fixture-query">
                  <TextField
                    id="fixture-query"
                    size="md"
                    placeholder="长标题、中英文内容与错误状态"
                  />
                </Field>
              </PageToolbar>
              {(['sm', 'md', 'lg'] as const).map((size) => (
                <div key={size} className="fixture-controls">
                  <TextField size={size} id={`fixture-input-${size}`} aria-label={`${size} 输入`} />
                  <FieldSelect
                    size={size}
                    id={`fixture-select-${size}`}
                    ariaLabel={`${size} 选择`}
                    options={[{ id: 'a', label: '资料' }]}
                    value="a"
                    onChange={() => undefined}
                  />
                  <Button size={size} id={`fixture-button-${size}`}>
                    操作
                  </Button>
                </div>
              ))}
              <InlineError message="当前操作未完成，请修改条件后重试。" />
              <ViewContainer mode="grid">
                <Card
                  title={'长标题 LongReference'.repeat(8)}
                  description={'较长的说明应当截断而且不挤破卡片。'.repeat(12)}
                  footer={
                    <Button id="fixture-md-button" size="md">
                      查看详情
                    </Button>
                  }
                >
                  <Badge tone="success">可用</Badge>
                </Card>
                <Card
                  title="共享卡片"
                  description="短说明也应保持三行描述区。"
                  footer={
                    <Button size="md" variant="outline">
                      编辑
                    </Button>
                  }
                >
                  <Badge tone="warning">待准备</Badge>
                </Card>
              </ViewContainer>
              <Disclosure label="高级配置">
                <Field label="名称" controlId="fixture-name">
                  <TextField id="fixture-name" size="md" />
                </Field>
              </Disclosure>
              <EmptyNotice title="暂无其他资料" detail="空态应沿用共享组件。" />
            </div>
          </ScrollRegion>
        </section>
      </main>
      <PopoverMenu
        open={menu}
        anchorRef={menuAnchor}
        label="测试菜单"
        items={Array.from({ length: 16 }, (_, index) => ({
          id: String(index),
          label: `查看资料 ${index + 1}`,
        }))}
        onSelect={() => setMenu(false)}
        onDismiss={() => setMenu(false)}
      />
      {modal && (
        <Modal variant="dialog" label="测试长表单" onClose={() => setModal(false)}>
          <Field label="名称" controlId="fixture-modal-name">
            <TextField id="fixture-modal-name" size="md" />
          </Field>
          <InlineError message="请补充名称。" />
          <Button size="md" id="fixture-modal-close" onClick={() => setModal(false)}>
            关闭
          </Button>
        </Modal>
      )}
    </>
  );
}

const host = document.getElementById('root');
if (!host) throw new Error('缺测试根节点');
createRoot(host).render(<FixturePage />);
