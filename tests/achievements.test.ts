import { describe, it, expect, vi } from 'vitest';

describe('achievements', () => {
  it('there are exactly 100 with unique ids', async () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined });
    const { ACHIEVEMENTS } = await import('../src/ui/achievements');
    expect(ACHIEVEMENTS.length).toBe(100);
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(100);
  });
});
