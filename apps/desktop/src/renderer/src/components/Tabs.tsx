import {
  Children,
  createContext,
  isValidElement,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  useContext,
  useId,
} from 'react';

import type { ControlSize } from './Button';

interface TabsContextValue {
  id: string;
  value: string;
  tabStopValue: string;
  onChange: (value: string) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

export interface TabsProps<K extends string> {
  value: K;
  onChange: (value: K) => void;
  children: ReactNode;
}

/** Controlled state and stable IDs shared by a tab list and its matching panels. */
export function Tabs<K extends string>({
  value,
  onChange,
  children,
}: TabsProps<K>): React.JSX.Element {
  const id = useId();
  const context: TabsContextValue = {
    id,
    value,
    tabStopValue: value,
    onChange: (nextValue) => onChange(nextValue as K),
  };

  return <TabsContext.Provider value={context}>{children}</TabsContext.Provider>;
}

export interface TabListProps {
  label: string;
  size: ControlSize;
  fill?: boolean;
  className?: string;
  children: ReactNode;
}

/** Tablist semantics, roving focus, automatic activation, and horizontal key handling. */
export function TabList({
  label,
  size,
  fill,
  className,
  children,
}: TabListProps): React.JSX.Element {
  const tabs = useTabsContext();
  const enabledTabs = getTabElements(children).filter((tab) => !tab.props.disabled);
  const selectedTab = enabledTabs.find((tab) => tab.props.value === tabs.value);
  const tabStopValue = selectedTab?.props.value ?? enabledTabs.at(0)?.props.value ?? tabs.value;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const tabElements = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'),
    );
    if (tabElements.length === 0) return;

    const focusedIndex = tabElements.findIndex((tab) => tab === document.activeElement);
    const selectedIndex = tabElements.findIndex(
      (tab) => tab.getAttribute('aria-selected') === 'true',
    );
    const currentIndex = focusedIndex >= 0 ? focusedIndex : selectedIndex >= 0 ? selectedIndex : 0;
    let nextIndex: number | undefined;

    switch (event.key) {
      case 'ArrowRight':
        nextIndex = (currentIndex + 1) % tabElements.length;
        break;
      case 'ArrowLeft':
        nextIndex = (currentIndex - 1 + tabElements.length) % tabElements.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = tabElements.length - 1;
        break;
      default:
        break;
    }

    if (nextIndex === undefined) return;
    event.preventDefault();
    const nextTab = tabElements[nextIndex];
    const nextValue = enabledTabs[nextIndex]?.props.value;
    if (!nextTab || nextValue === undefined) return;
    if (nextValue !== tabs.value) tabs.onChange(nextValue);
    nextTab.focus();
  };

  return (
    <TabsContext.Provider value={{ ...tabs, tabStopValue }}>
      <div
        className={`tabs${className ? ` ${className}` : ''}`}
        role="tablist"
        aria-label={label}
        aria-orientation="horizontal"
        data-size={size}
        {...(fill ? { 'data-fill': 'true' } : {})}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </TabsContext.Provider>
  );
}

export interface TabProps<K extends string = string> {
  value: K;
  disabled?: boolean;
  children: ReactNode;
}

/** A single selectable tab in a TabList. */
export function Tab<K extends string>({
  value,
  disabled,
  children,
}: TabProps<K>): React.JSX.Element {
  const tabs = useTabsContext();
  const selected = value === tabs.value;

  return (
    <button
      id={tabId(tabs.id, value)}
      type="button"
      role="tab"
      aria-selected={selected}
      aria-controls={panelId(tabs.id, value)}
      tabIndex={!disabled && tabs.tabStopValue === value ? 0 : -1}
      disabled={disabled}
      onClick={() => {
        if (!disabled && !selected) tabs.onChange(value);
      }}
    >
      {children}
    </button>
  );
}

export interface TabPanelProps {
  value: string;
  className?: string;
  children: ReactNode;
}

/** A matching content panel; inactive panels stay linked but do not mount their contents. */
export function TabPanel({ value, className, children }: TabPanelProps): React.JSX.Element {
  const tabs = useTabsContext();
  const selected = tabs.value === value;

  return (
    <div
      className={`tab-panel${className ? ` ${className}` : ''}`}
      id={panelId(tabs.id, value)}
      role="tabpanel"
      aria-labelledby={tabId(tabs.id, value)}
      hidden={!selected}
      tabIndex={0}
    >
      {selected ? children : null}
    </div>
  );
}

function useTabsContext(): TabsContextValue {
  const context = useContext(TabsContext);
  if (context === null) throw new Error('Tab components must be nested inside Tabs.');
  return context;
}

function isTabElement(child: ReactNode): child is ReactElement<TabProps> {
  return isValidElement<TabProps>(child) && child.type === Tab;
}

function getTabElements(children: ReactNode): ReactElement<TabProps>[] {
  return Children.toArray(children).filter(isTabElement);
}

function tabId(id: string, value: string): string {
  return `${id}-tab-${encodeURIComponent(value)}`;
}

function panelId(id: string, value: string): string {
  return `${id}-panel-${encodeURIComponent(value)}`;
}

export interface TabItem<K extends string> {
  id: K;
  label: ReactNode;
}

export interface SegmentedControlProps<K extends string> {
  items: readonly TabItem<K>[];
  value: K;
  onChange: (id: K) => void;
  /** 分组的可及名称（`aria-label`）。 */
  label: string;
  /** 必填：与同排控件共用 `--control-height-*` 档位（docs/10 §9.10「动作排」）。 */
  size: ControlSize;
  className?: string;
}

/**
 * 切换按钮组：`role=group` + `aria-pressed`，每个按钮都参与 Tab 顺序。
 *
 * 与页签的区别在于它切换的是「同一片内容的呈现方式」，不是互斥的面板；
 * 技能页的卡片／列表就是这一类。收在这里是为了让这个模式有名字，
 * 不再每次由页面自己拼一组带 `aria-pressed` 的按钮。
 */
export function SegmentedControl<K extends string>({
  items,
  value,
  onChange,
  label,
  size,
  className,
}: SegmentedControlProps<K>): React.JSX.Element {
  return (
    <div
      className={`segmented-control${className ? ` ${className}` : ''}`}
      role="group"
      aria-label={label}
      data-size={size}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-pressed={item.id === value}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
