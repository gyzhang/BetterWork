import { useState } from 'react';

export interface ConversationAddresses {
  assistant: string;
  user: string;
}

const STORAGE_KEY = 'betterwork-conversation-addresses';

export const defaultConversationAddresses: ConversationAddresses = {
  assistant: '罗伯特',
  user: '张三',
};

function readConversationAddresses(): ConversationAddresses {
  if (typeof window === 'undefined') return defaultConversationAddresses;

  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) return defaultConversationAddresses;

  try {
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== 'object' || parsed === null) return defaultConversationAddresses;

    const candidate = parsed as Record<string, unknown>;
    const assistant = candidate.assistant;
    const user = candidate.user;
    if (typeof assistant !== 'string' || typeof user !== 'string')
      return defaultConversationAddresses;

    return { assistant, user };
  } catch {
    return defaultConversationAddresses;
  }
}

export interface ConversationAddressesState {
  addresses: ConversationAddresses;
  update: (next: ConversationAddresses) => void;
}

export function useConversationAddresses(): ConversationAddressesState {
  const [addresses, setAddresses] = useState(readConversationAddresses);

  const update = (next: ConversationAddresses): void => {
    setAddresses(next);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  return { addresses, update };
}
