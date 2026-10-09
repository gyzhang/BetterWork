import { useCallback, useEffect, useState } from 'react';

const MEMORY_PREVIEW_DEBOUNCE_MS = 300;

export interface ComposerPromptState {
  prompt: string;
  changePrompt: (value: string) => void;
}

export interface UseComposerPromptOptions {
  readPromptDraft: () => string;
  onPromptChange: (value: string) => void;
  onPromptSettled: (value: string) => void;
}

export function useComposerPrompt({
  readPromptDraft,
  onPromptChange,
  onPromptSettled,
}: UseComposerPromptOptions): ComposerPromptState {
  const [prompt, setPrompt] = useState('');

  useEffect(() => {
    const draft = readPromptDraft();
    setPrompt(draft);
  }, [readPromptDraft]);

  useEffect(() => {
    if (prompt.length === 0) return;
    const timeout = window.setTimeout(() => onPromptSettled(prompt), MEMORY_PREVIEW_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [onPromptSettled, prompt]);

  const changePrompt = useCallback(
    (value: string): void => {
      setPrompt(value);
      onPromptChange(value);
    },
    [onPromptChange],
  );

  return { prompt, changePrompt };
}
