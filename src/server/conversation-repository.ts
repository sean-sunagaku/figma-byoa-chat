import { randomUUID } from 'node:crypto';
import type { ChatMessage } from './client-registry';

export interface ConversationRepository {
  getOrCreate(conversationId?: string): Promise<{ id: string; history: ChatMessage[] }>;
  append(conversationId: string, ...messages: ChatMessage[]): Promise<void>;
  trim(conversationId: string, max: number): Promise<void>;
  touch(conversationId: string): Promise<void>;
  purgeExpired(ttlMs: number): Promise<number>;
}

export class UnknownConversationError extends Error {
  constructor(conversationId: string) {
    super(`Unknown conversation: ${conversationId}`);
    this.name = 'UnknownConversationError';
  }
}

type ConversationEntry = {
  history: ChatMessage[];
  updatedAt: number;
};

export class InMemoryConversationRepository implements ConversationRepository {
  private readonly store = new Map<string, ConversationEntry>();

  async getOrCreate(conversationId?: string): Promise<{ id: string; history: ChatMessage[] }> {
    const now = Date.now();
    let id = conversationId?.trim();

    if (!id) {
      id = randomUUID();
    }

    let entry = this.store.get(id);

    if (!entry) {
      entry = { history: [], updatedAt: now };
      this.store.set(id, entry);
    } else {
      entry.updatedAt = now;
    }

    return { id, history: entry.history.map((message) => ({ ...message })) };
  }

  async append(conversationId: string, ...messages: ChatMessage[]): Promise<void> {
    const entry = this.store.get(conversationId);
    if (!entry) {
      throw new UnknownConversationError(conversationId);
    }

    if (messages.length === 0) {
      entry.updatedAt = Date.now();
      return;
    }

    entry.history = [
      ...entry.history,
      ...messages.map((message) => ({ ...message })),
    ];
    entry.updatedAt = Date.now();
  }

  async trim(conversationId: string, max: number): Promise<void> {
    const entry = this.store.get(conversationId);
    if (!entry) {
      throw new UnknownConversationError(conversationId);
    }

    const limit = Math.max(0, max);
    if (entry.history.length > limit) {
      entry.history = entry.history.slice(-limit);
    }
    entry.updatedAt = Date.now();
  }

  async touch(conversationId: string): Promise<void> {
    const entry = this.store.get(conversationId);
    if (!entry) {
      throw new UnknownConversationError(conversationId);
    }

    entry.updatedAt = Date.now();
  }

  async purgeExpired(ttlMs: number): Promise<number> {
    if (ttlMs <= 0) {
      return 0;
    }

    const now = Date.now();
    let deleted = 0;

    const entries = Array.from(this.store.entries());
    const latestEntry = entries.reduce<{ id: string; updatedAt: number } | null>((acc, [id, entry]) => {
      if (!acc || entry.updatedAt > acc.updatedAt) {
        return { id, updatedAt: entry.updatedAt };
      }
      return acc;
    }, null);
    const retainedLatestId = latestEntry?.id ?? null;

    for (const [id, entry] of entries) {
      if (id === retainedLatestId) {
        continue;
      }
      if (now - entry.updatedAt > ttlMs) {
        this.store.delete(id);
        deleted += 1;
      }
    }

    return deleted;
  }
}
