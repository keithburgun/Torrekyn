import { describe, it, expect, vi } from 'vitest';
import { newGame, human, selectHero } from '../src/engine/game';
import { PERSONAS, personaElo, personaProfile, profileForSkill } from '../src/engine/personas';

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined });

describe('personas and rating', () => {
  it('15 personas with unique names; rivals get personas', () => {
    expect(PERSONAS.length).toBe(15);
    expect(new Set(PERSONAS.map((p) => p.name)).size).toBe(15);
    const g = newGame(3);
    selectHero(g, human(g).heroOffer![0]);
    const rivals = g.players.slice(1);
    expect(rivals.every((p) => p.persona && p.bot)).toBe(true);
    expect(new Set(rivals.map((p) => p.persona)).size).toBe(5);
  });

  it('the Expert persona is 2000 and the weakest is the lowest', () => {
    const elos = PERSONAS.map(personaElo);
    expect(elos[0]).toBe(2000);
    expect(Math.min(...elos)).toBe(personaElo(PERSONAS[PERSONAS.length - 1]));
  });

  it('skill 1 is the Expert profile, skill 0 has every habit off and makes mistakes', () => {
    expect(Object.values(profileForSkill(1).f!).filter(Boolean).length).toBeGreaterThan(5);
    const b = profileForSkill(0);
    expect(b.noise).toBeGreaterThan(2);
    expect(b.f!.arrange).toBe(false);
    expect(personaProfile(PERSONAS[7]).tribe).toBe('kindred');
  });

  it('rating moves by placement and lobby strength', async () => {
    const { ratingChange } = await import('../src/ui/rating');
    const g = newGame(4);
    selectHero(g, human(g).heroOffer![0]);
    g.phase = 'over';
    // win: everyone else knocked out
    g.players.forEach((p, i) => { p.alive = i === 0; p.placement = i + 1; });
    const win = ratingChange(g, { rating: 1500, games: 20, peak: 1500, history: [] });
    expect(win.delta).toBeGreaterThan(20);
    // knocked out first: everyone else still alive
    g.players.forEach((p, i) => { p.alive = i !== 0; p.placement = i === 0 ? 6 : 0; });
    const last = ratingChange(g, { rating: 1500, games: 20, peak: 1500, history: [] });
    expect(last.delta).toBeLessThan(0);
    expect(Math.abs(last.delta)).toBeLessThan(win.delta); // a 1500 player is expected to lose to these bots
    // provisional games move twice as fast
    const prov = ratingChange(g, { rating: 1500, games: 0, peak: 1500, history: [] });
    expect(Math.abs(prov.delta - last.delta * 2)).toBeLessThanOrEqual(1);
  });
});
