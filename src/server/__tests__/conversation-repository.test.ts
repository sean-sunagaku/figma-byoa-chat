import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  InMemoryConversationRepository,
  UnknownConversationError,
} from '../conversation-repository';
import type { ChatMessage } from '../client-registry';

// InMemoryConversationRepository の状態管理テスト。
// Spec refs: TEST_PLAN InMemoryConversationRepository.*, DESIGN 4.3 会話履歴

const sampleMessages: ChatMessage[] = [
  { role: 'user', content: '質問1' },
  { role: 'assistant', content: '回答1' },
  { role: 'user', content: '質問2' },
];

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2024-01-01T00:00:00Z'));
});

afterEach(() => {
  jest.useRealTimers();
});

describe('InMemoryConversationRepository', () => {
  it('conversationId 未指定時は新規 ID と空履歴を返す', async () => {
    const repo = new InMemoryConversationRepository();

    const { id, history } = await repo.getOrCreate();

    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
    expect(history).toEqual([]);
  });

  it('既存 ID 指定時は保存済み履歴を返す', async () => {
    const repo = new InMemoryConversationRepository();
    const first = await repo.getOrCreate();

    await repo.append(first.id, sampleMessages[0], sampleMessages[1]);

    const again = await repo.getOrCreate(first.id);

    expect(again.id).toBe(first.id);
    expect(again.history).toEqual([sampleMessages[0], sampleMessages[1]]);
  });

  it('append 後に trim で最大履歴数を超過分だけ削除する', async () => {
    const repo = new InMemoryConversationRepository();
    const { id } = await repo.getOrCreate();

    await repo.append(id, ...sampleMessages);
    await repo.trim(id, 2);

    const { history } = await repo.getOrCreate(id);
    expect(history).toEqual(sampleMessages.slice(-2));
  });

  it('Unknown ID への append は UnknownConversationError を投げる', async () => {
    const repo = new InMemoryConversationRepository();

    await expect(repo.append('missing-id', sampleMessages[0])).rejects.toThrow(UnknownConversationError);
  });

  it('purgeExpired は期限切れ会話のみ削除し件数を返す', async () => {
    const repo = new InMemoryConversationRepository();

    const fresh = await repo.getOrCreate();

    jest.advanceTimersByTime(1_000);
    const stale = await repo.getOrCreate();

    jest.advanceTimersByTime(10 * 60 * 1_000);

    const deleted = await repo.purgeExpired(5 * 60 * 1_000);

    expect(deleted).toBe(1);
    await expect(repo.getOrCreate(fresh.id)).resolves.toBeDefined();
    await expect(repo.getOrCreate(stale.id)).resolves.toEqual({ id: stale.id, history: [] });
  });

  it('touch は履歴を変えずに updatedAt を更新する', async () => {
    const repo = new InMemoryConversationRepository();
    const { id } = await repo.getOrCreate();

    await repo.append(id, sampleMessages[0]);

    jest.advanceTimersByTime(5_000);
    await repo.touch(id);

    jest.advanceTimersByTime(10 * 60 * 1_000);

    const deleted = await repo.purgeExpired(10 * 60 * 1_000);
    expect(deleted).toBe(0);
  });
});
