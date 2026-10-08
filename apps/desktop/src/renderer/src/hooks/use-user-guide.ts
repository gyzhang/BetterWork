import type { Dispatch, RefObject, SetStateAction } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import example from '../../../../../../docs/guide/examples/collaboration-notes.md?raw';
import manual from '../../../../../../docs/guide/README.md?raw';
import type { GuideHeading } from '../lib/user-guide';
import { guideHeadings } from '../lib/user-guide';

interface GuideScreenshot {
  url: string;
  title: string;
}

interface UserGuideState {
  showingExample: boolean;
  directoryOpen: boolean;
  setDirectoryOpen: Dispatch<SetStateAction<boolean>>;
  directoryRef: RefObject<HTMLButtonElement | null>;
  documentRef: RefObject<HTMLDivElement | null>;
  content: string;
  headings: GuideHeading[];
  directory: GuideHeading[];
  navigate: (id: string) => void;
  openExample: () => void;
  openManual: () => void;
  screenshot: GuideScreenshot | undefined;
  setScreenshot: Dispatch<SetStateAction<GuideScreenshot | undefined>>;
  closeScreenshot: () => void;
}

export function useUserGuide(): UserGuideState {
  const [showingExample, setShowingExample] = useState(false);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [screenshot, setScreenshot] = useState<GuideScreenshot>();
  const [navigation, setNavigation] = useState<{ id: string }>();
  const directoryRef = useRef<HTMLButtonElement>(null);
  const documentRef = useRef<HTMLDivElement>(null);
  const content = showingExample ? example : manual;
  const headings = useMemo(() => guideHeadings(content), [content]);
  const directory = useMemo(() => headings.filter((heading) => heading.level === 2), [headings]);
  const navigate = useCallback((id: string): void => {
    setNavigation({ id });
    setDirectoryOpen(false);
  }, []);
  const openExample = useCallback((): void => {
    setDirectoryOpen(false);
    setNavigation(undefined);
    setShowingExample(true);
  }, []);
  const openManual = useCallback((): void => {
    setDirectoryOpen(false);
    setNavigation(undefined);
    setShowingExample(false);
  }, []);
  const closeScreenshot = useCallback((): void => setScreenshot(undefined), []);
  useEffect(() => {
    const id = navigation?.id ?? headings[0]?.id;
    const target = Array.from(
      documentRef.current?.querySelectorAll<HTMLElement>('[id]') ?? [],
    ).find((element) => element.id === id);
    if (!target) return;
    target.scrollIntoView({ block: 'start' });
    target.focus({ preventScroll: true });
  }, [headings, navigation]);
  return {
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
  };
}
