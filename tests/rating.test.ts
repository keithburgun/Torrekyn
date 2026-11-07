import { describe, it, expect, vi } from 'vitest';
import { newGame, human, selectHero } from '../src/engine/game';
import { PERSONAS, personaElo, personaProfile, profileForSkill } from '../src/engine/personas';

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined });

describe('personas and rating', () => {
  it('16 personas with unique names; rivals get personas', () => {
    expect(PERSONAS.length).toBe(16);
    expect(new Set(PERSONAS.map((p) => p.name)).size).toBe(16);
    const g = newGame(3);
    selectHero(g, human(g).heroOffer![0]);
    const rivals = g.players.slice(1);
    expect(rivals.every((p) => p.persona && p.bot)).toBe(true);
    expect(new Set(rivals.map((p) => p.persona)).size).toBe(5);
  });

  it('the Expert persona is 1500 and the weakest is the lowest', () => {
    const elos = PERSONAS.map(personaElo);
    expect(elos[0]).toBe(1500);
    expect(Math.min(...elos)).toBe(personaElo(PERSONAS[PERSONAS.length - 1]));
  });

  it('skill 1 is the Expert profile, skill 0 has every habit off and makes mistakes', () => {
    expect(Object.values(profileForSkill(1).f!).filter(Boolean).length).toBeGreaterThan(5);
    const b = profileForSkill(0);
    expect(b.noise).toBeGreaterThan(2);
    expect(b.f!.arrange).toBe(false);
    expect(personaProfile(PERSONAS[11]).tribe).toBe('kindred');
  });

  it('rating moves by placement and lobby strength', async () => {
    const { ratingChange } = await import('../src/ui/rating');
    const g = newGame(4);
    selectHero(g, human(g).heroOffer![0]);
    g.phase = 'over';
    // win: everyone else knocked out
    g.players.forEach((p, i) => { p.alive = i === 0; p.placement = i + 1; });
    const win = ratingChange(g, { rating: 1000, games: 20, peak: 1000, history: [] });
    expect(win.delta).toBeGreaterThan(20);
    // knocked out first: everyone else still alive
    g.players.forEach((p, i) => { p.alive = i !== 0; p.placement = i === 0 ? 6 : 0; });
    const last = ratingChange(g, { rating: 1000, games: 20, peak: 1000, history: [] });
    expect(last.delta).toBeLessThan(0);
    expect(Math.abs(last.delta)).toBeLessThan(win.delta); // a 1000 player is expected to lose to these bots
    // provisional games move twice as fast
    const prov = ratingChange(g, { rating: 1000, games: 0, peak: 1000, history: [] });
    expect(Math.abs(prov.delta - last.delta * 2)).toBeLessThanOrEqual(1);
  });
});

describe('matchmaking', () => {
  it('rivals cluster near the player rating', async () => {
    const { matchPersonas, personaElo } = await import('../src/engine/personas');
    let r = 1;
    const rnd = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
    const avg = (rating: number) => {
      let s = 0;
      for (let i = 0; i < 200; i++) s += matchPersonas(rating, 5, rnd).reduce((a, p) => a + personaElo(p), 0) / 5;
      return s / 200;
    };
    expect(avg(1000)).toBeLessThan(1150);
    expect(avg(1500)).toBeGreaterThan(1300);
  });
});
