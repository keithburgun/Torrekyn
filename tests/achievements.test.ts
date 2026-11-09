import { describe, it, expect, vi } from 'vitest';

describe('achievements', () => {
  it('there are 100 plus two for each hero beyond the original 12, with unique ids', async () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined });
    const { ACHIEVEMENTS } = await import('../src/ui/achievements');
    const { HEROES } = await import('../src/engine/heroes');
    const n = 101 + 2 * (HEROES.length - 12); // 101: Summit (Tier 6) was added
    expect(ACHIEVEMENTS.length).toBe(n);
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(n);
  });
});
