/**
 * Battle simulation, following Hearthstone: Battlegrounds conventions:
 *  - the side with more units attacks first (coin flip if equal), sides alternate;
 *  - each side's units attack left-to-right; targets are random, Taunt first;
 *  - Bubble absorbs one hit; Doomstrike kills on damage (one use), Poisonous always does; Reborn returns at 1 Health;
 *  - Double Attack attacks twice; deaths resolve left-to-right, attacking side first.
 */
import { addKw, cloneUnit, def, effStats, has, isTribe, mult, ownerBonus, pick, rand, removeKw, sample, tribeOf, CONFIG } from './core';
import { EFFECTS, hasBattlecry, battlecryTimes, type CCtx } from './effects';
import { gainNew, combatDamage, drawFromPool, BASE_DAMAGE, DAMAGE_PER_UNIT, onBattlecryTriggered } from './game';
import { heroHooks, heroSoc, trinketCount } from './heroes';
import { withFx } from './fx';
import type { Body, CombatFrame, CombatFrameUnit, CombatFx, CombatResult, GameState, Keyword, Player, Tribe, Unit } from './types';

export interface CUnit extends Body {
  id: number;
  side: 0 | 1;
  src: number | null;
  avenge: number;
  /** damage taken this battle (Remember works out what a unit gained from it) */
  taken?: number;
  killedBy?: CUnit;
  startAtk: number;
  startHp: number;
  startKw: Keyword[];
  processed?: boolean;
}

export interface Side {
  idx: 0 | 1;
  units: CUnit[];
  owner: Player; // a throwaway copy for ghosts
  persistent: boolean;
  tier: number;
  died: CUnit[];
  secrets: boolean[];
  ptr: number;
  afterFns: (() => void)[];
  /** Avenge counters for hero powers (Clover, Trevor L) */
  heroAvenge: Record<string, number>;
}

const MAX_STEPS = 400;

export class Combat {
  g: GameState;
  sides: [Side, Side];
  frames: CombatFrame[] = [];
  nextId = 1;
  attacking: 0 | 1 = 0;
  steps = 0;
  depth = 0;

  constructor(g: GameState, a: { p: Player; board: Unit[]; tier: number; persistent: boolean },
    b: { p: Player; board: Unit[]; tier: number; persistent: boolean }) {
    this.g = g;
    this.sides = [this.makeSide(0, a), this.makeSide(1, b)];
  }

  private makeSide(idx: 0 | 1, s: { p: Player; board: Unit[]; tier: number; persistent: boolean }): Side {
    const side: Side = {
      idx, units: [], owner: s.p, persistent: s.persistent, tier: s.tier,
      died: [], secrets: [], ptr: 0, afterFns: [], heroAvenge: {},
    };
    s.board.forEach((u, i) => {
      const st = effStats(s.p, u, 'board', i);
      side.units.push(this.makeCU(idx, u.cardId, u.golden, st.atk, st.hp, st.kw, u.uid, { ...u.mem }));
    });
    return side;
  }

  private makeCU(side: 0 | 1, cardId: string, golden: boolean, atk: number, hp: number, kw: Keyword[], src: number | null, mem: Record<string, number> = {}): CUnit {
    return {
      id: this.nextId++, side, cardId, golden, atk, hp, kw: [...kw], mem, src, avenge: 0,
      startAtk: atk, startHp: hp, startKw: [...kw],
    };
  }

  enemy(s: Side): Side {
    return this.sides[1 - s.idx];
  }

  ctx(u: CUnit, pos = -1): CCtx {
    const side = this.sides[u.side];
    return { g: this.g, c: this, side, self: u, m: mult(u), p: side.owner, pos };
  }

  // ---------- frames ----------
  /** Effects waiting to be attached to the next frame. */
  fx: CombatFx[] = [];
  /** true while an attacker and defender trade blows (that damage is shown by the lunge, not projectiles) */
  inExchange = false;
  /** a hero power / trinket of this side is acting */
  heroSide: 0 | 1 | undefined;

  /** Health each unit has gained so far (its Health plus damage taken), for Turtlepult (+2 Health whenever another unit gains some) */
  private seenHp = new Map<number, number>();
  private peebSync() {
    for (const s of this.sides) {
      const peebs = s.units.filter((u) => u.cardId === 'peebnup_bubber' && u.hp > 0 && !u.processed);
      const delta = new Map<number, number>();
      let total = 0;
      for (const u of s.units) {
        const v = u.hp + (u.taken ?? 0);
        const was = this.seenHp.get(u.id);
        if (was !== undefined && v > was && u.hp > 0) { delta.set(u.id, v - was); total += v - was; }
        this.seenHp.set(u.id, v);
      }
      if (total <= 0) continue;
      // +2 (Golden +4) for each other unit that gained Health in this event; what it gets from this doesn't count again
      for (const pb of peebs) {
        const others = [...delta.keys()].filter((id) => id !== pb.id).length;
        if (others > 0) pb.hp += 2 * others * mult(pb);
        this.seenHp.set(pb.id, pb.hp + (pb.taken ?? 0));
      }
    }
  }

  snap(kind: CombatFrame['kind'], extra: Partial<CombatFrame> = {}) {
    this.peebSync();
    const f = (s: Side): CombatFrameUnit[] =>
      s.units.filter((u) => !u.processed).map((u) => ({
        id: u.id, cardId: u.cardId, golden: u.golden, atk: u.atk, hp: Math.max(0, u.hp), kw: [...u.kw], ...(EFFECTS[u.cardId]?.avenge ? { avenge: u.avenge } : {}), ...(u.mem.rattle ? { rattle: 1 } : {}), ...(u.mem.sellBonus ? { sellBonus: u.mem.sellBonus } : {}), ...(u.hp <= 0 ? { dead: true, ...(u.hp < 0 ? { over: -u.hp } : {}) } : {}),
      }));
    const frame: CombatFrame = { kind, sides: [f(this.sides[0]), f(this.sides[1])], ...extra };
    // a note made while a hero power / trinket of one side runs belongs at that side's hero
    if (kind === 'trigger' && frame.note && frame.source === undefined && frame.noteSide === undefined && this.heroSide !== undefined) frame.noteSide = this.heroSide;
    const mine = !this.g.simulateAll && this.sides.find((s) => s.persistent && s.owner.human);
    if (mine) frame.hand = mine.owner.hand.map((u) => ({ uid: u.uid, cardId: u.cardId, golden: u.golden, atk: u.atk, hp: u.hp, kw: [...u.kw] }));
    if (this.fx.length) {
      frame.fx = this.fx;
      this.fx = [];
    }
    this.frames.push(frame);
  }

  /** a Gem played during battle landed on these units (see effects playGemOn) */
  gemFx(to: number[], from: number | undefined, side: Side) {
    const fromSide = this.sides.indexOf(side) as 0 | 1;
    for (const id of to) this.addFx({ k: 'gem', to: id, from, fromSide });
  }

  private addFx(fx: CombatFx) {
    this.fx.push(fx);
  }

  // ---------- helpers used by effects ----------
  randomEnemy(s: Side): CUnit | undefined {
    return pick(this.g, this.enemy(s).units.filter((u) => u.hp > 0));
  }

  adjacent(u: CUnit): CUnit[] {
    const s = this.sides[u.side];
    const i = s.units.indexOf(u);
    return [s.units[i - 1], s.units[i + 1]].filter((x): x is CUnit => !!x && x.hp > 0);
  }

  after(s: Side, fn: () => void) {
    s.afterFns.push(fn);
  }

  /** Remember: the unit behind this combat unit keeps the stats and keywords it gained in this battle (Golden: doubled) */
  keepGains(cu: CUnit, m: number) {
    const s = this.sides[cu.side];
    const u = s.owner.board.find((x) => x.uid === cu.src);
    if (!u) return;
    const a = Math.max(0, cu.atk - cu.startAtk);
    const h = Math.max(0, cu.hp + (cu.taken ?? 0) - cu.startHp);
    u.atk += a * m;
    u.hp += h * m;
    // any keyword it gained at some point in the battle (a Bubble gained and then broken still counts)
    const seen = new Set<Keyword>(cu.kw);
    for (const f of this.frames) for (const x of f.sides[cu.side]) if (x.id === cu.id) x.kw.forEach((k) => seen.add(k));
    for (const k of seen) if (!cu.startKw.includes(k) && !u.kw.includes(k)) u.kw.push(k);
    if (a || h) s.owner.log.push(`Remember: ${def(u.cardId).name} kept +${a * m}/+${h * m}.`);
  }

  /** Apply a permanent change to the persistent unit behind a combat unit, and an optional stat change in combat. */
  perm(cu: CUnit, fn: (u: Unit) => void, atk = 0, hp = 0) {
    cu.atk += atk;
    cu.hp += hp;
    const s = this.sides[cu.side];
    if (!s.persistent || cu.src === null) return;
    const u = s.owner.board.find((x) => x.uid === cu.src);
    if (u) fn(u);
  }

  /**
   * A summon that doesn't fit in the army: The Tree Man gives all your units +2/+4 (Golden +4/+8).
   * Once per event: a summon effect that runs out of room for several units counts once.
   */
  private noRoomAt = [-1, -1];
  noRoom(s: Side): null {
    const trees = s.units.filter((u) => u.cardId === 'tree_man' && u.hp > 0);
    if (!trees.length || this.noRoomAt[s.idx] === this.frames.length) return null;
    this.noRoomAt[s.idx] = this.frames.length;
    for (const t of trees) for (const u of s.units) if (u.hp > 0) { u.atk += 2 * mult(t); u.hp += 4 * mult(t); }
    this.snap('trigger', { note: `The Tree Man: No room! All units +${2 * mult(trees[0])}/+${4 * mult(trees[0])}` });
    return null;
  }

  spawn(s: Side, cardId: string, golden: boolean, pos: number): CUnit | null {
    if (s.units.filter((u) => u.hp > 0).length >= CONFIG.boardSize) return this.noRoom(s);
    const d = def(cardId);
    const m = golden ? 2 : 1;
    if (cardId === 'owl') {
      // Owls have +1/+2 for each Owl summoned this game: this one counts, and the Owls already fighting grow too
      s.owner.owlsSummoned = (s.owner.owlsSummoned ?? 0) + 1;
      for (const o of s.units) if (o.cardId === 'owl' && o.hp > 0) { o.atk += mult(o); o.hp += 2 * mult(o); }
    }
    // a fresh unit gets the same "all your X units have…" bonuses as the ones you brought in
    const bonus = ownerBonus(s.owner, { cardId, golden } as Body);
    const cu = this.makeCU(s.idx, cardId, golden, d.atk * m + bonus.atk, d.hp * m + bonus.hp, d.keywords, null);
    s.units.splice(Math.max(0, Math.min(pos, s.units.length)), 0, cu);
    this.addFx({ k: 'summon', to: cu.id });
    this.onSummoned(s, cu);
    return cu;
  }

  /** Summon several copies one at a time: each gets its own frame, so they appear one after another. */
  spawnMany(s: Side, cardId: string, golden: boolean, n: number, pos: number) {
    for (let i = 0; i < n; i++) {
      if (this.spawn(s, cardId, golden, pos + i) === null) break;
      this.snap('trigger', i === 0 ? { note: `Summon ${def(cardId).name}` } : {});
    }
  }

  spawnCopy(s: Side, d: CUnit, pos: number): CUnit | null {
    if (s.units.filter((u) => u.hp > 0).length >= CONFIG.boardSize) return this.noRoom(s);
    const cu = this.makeCU(s.idx, d.cardId, d.golden, d.startAtk, d.startHp, d.startKw, null, { ...d.mem });
    s.units.splice(Math.max(0, Math.min(pos, s.units.length)), 0, cu);
    this.addFx({ k: 'summon', to: cu.id });
    this.onSummoned(s, cu);
    this.snap('trigger', { note: `Summon ${def(d.cardId).name}` });
    return cu;
  }

  /** Bring a card from hand into battle as a temporary copy. */
  /** summon a copy of a unit from hand (scale: its stats are multiplied, e.g. Golden Green Ninja doubles them) */
  spawnUnit(s: Side, u: Unit, pos: number, scale = 1): CUnit | null {
    if (s.units.filter((x) => x.hp > 0).length >= CONFIG.boardSize) return this.noRoom(s);
    const st = effStats(s.owner, u, 'hand');
    const cu = this.makeCU(s.idx, u.cardId, u.golden, st.atk * scale, st.hp * scale, st.kw, null, { ...u.mem });
    s.units.splice(Math.max(0, Math.min(pos, s.units.length)), 0, cu);
    this.addFx({ k: 'summon', to: cu.id });
    this.onSummoned(s, cu);
    this.snap('trigger', { note: `Summon ${def(u.cardId).name}` });
    return cu;
  }

  /** a unit was summoned during battle: hero powers, then friendly units that care (Alabaster) */
  private onSummoned(s: Side, cu: CUnit) {
    heroHooks.onSummon(this, s, cu);
    for (const w of [...s.units]) if (w !== cu && w.hp > 0) EFFECTS[w.cardId]?.onSummonFriendly?.(this.ctx(w), cu);
  }

  kill(t: CUnit, source?: CUnit) {
    if (t.hp <= 0) return;
    t.taken = (t.taken ?? 0) + t.hp;
    t.hp = 0;
    if (source && !t.killedBy) t.killedBy = source;
    this.addFx({ k: 'kill', to: t.id, from: source?.id });
  }

  /** `spill`: this is Pyro's excess damage, which doesn't spill again (it used to chain through a whole army) */
  damage(t: CUnit | undefined, amount: number, source?: CUnit, spill = false, attacking = false) {
    if (!t || t.hp <= 0 || amount <= 0) return;
    if (spill) this.addFx({ k: 'splash', to: t.id });
    else if (!this.inExchange) this.addFx({ k: 'hit', to: t.id, from: source?.id, fromSide: source ? undefined : this.heroSide });
    if (has(t, 'divineShield')) {
      removeKw(t, 'divineShield');
      this.addFx({ k: 'shield', to: t.id });
      for (const s of this.sides) for (const w of [...s.units]) {
        if (w.hp > 0) EFFECTS[w.cardId]?.onShieldLost?.(this.ctx(w), t);
      }
      return;
    }
    const before = t.hp;
    t.hp -= amount;
    t.taken = (t.taken ?? 0) + amount;
    if (source && (has(source, 'venomous') || has(source, 'poisonous')) && t.hp > 0) {
      t.taken = (t.taken ?? 0) + t.hp;
      t.hp = 0;
      if (!has(source, 'poisonous')) removeKw(source, 'venomous'); // Poisonous is never used up
      this.addFx({ k: 'venom', to: t.id });
    }
    if (t.hp <= 0 && source && !t.killedBy) {
      t.killedBy = source;
      const k = EFFECTS[source.cardId]?.onKill;
      if (k) { k(this.ctx(source), t); if (!this.inExchange) this.snap('trigger', { source: source.id, note: `${def(source.cardId).name}` }); }
    }
    if (t.hp > 0) EFFECTS[t.cardId]?.onDamaged?.(this.ctx(t));
    // Pyro only spills when it's the one attacking (not when it's hit back while defending)
    if (t.hp <= 0 && !spill && attacking && source?.cardId === 'pyro' && source.hp > 0) {
      const excess = amount - before;
      if (excess > 0) {
        const adj = this.adjacent(t);
        const targets = source.golden ? adj : sample(this.g, adj, 1);
        for (const a of targets) this.damage(a, excess, source, true);
      }
    }
  }

  triggerBattlecry(s: Side, u: CUnit) {
    const e = EFFECTS[u.cardId];
    if (!e?.battlecry) return;
    const times = battlecryTimes(s.owner, u) + trinketCount(s.owner, 'crown_of_echoes') + heroHooks.battlecryExtra(s.owner);
    for (let i = 0; i < times; i++) {
      e.battlecry({ g: this.g, p: s.owner, self: u, m: mult(u), board: s.units.filter((x) => x.hp > 0), combat: this, side: s });
      if (s.persistent) onBattlecryTriggered(this.g, s.owner);
    }
    this.snap('trigger', { source: u.id, note: `${def(u.cardId).name}: Arrive` });
  }

  // ---------- deaths ----------
  resolveDeaths() {
    for (let guard = 0; guard < 50; guard++) {
      const order = [this.sides[this.attacking], this.sides[1 - this.attacking]];
      const batch: { u: CUnit; s: Side; pos: number }[] = [];
      for (const s of order) {
        for (const u of [...s.units]) {
          if (u.hp > 0 || u.processed) continue;
          u.processed = true;
          const pos = s.units.indexOf(u);
          s.units.splice(pos, 1);
          batch.push({ u, s, pos });
        }
      }
      if (!batch.length) return;
      this.snap('death');
      for (const { u, s, pos } of batch) {
        s.died.push(u);
        // Avenge counters on friendly units
        for (const f of [...s.units]) {
          const e = EFFECTS[f.cardId];
          if (!e?.avenge || f.hp <= 0) continue;
          f.avenge++;
          const need = e.avenge[f.golden ? 1 : 0];
          if (f.avenge >= need) {
            f.avenge = 0;
            e.avengeFn?.(this.ctx(f));
            this.snap('trigger', { source: f.id, note: `${def(f.cardId).name}: Avenge` });
          }
        }
        // hero powers that count friendly deaths
        heroHooks.onFriendlyDeath(this, s);
        // watchers on both sides
        for (const side of this.sides) for (const w of [...side.units]) {
          if (w.hp > 0) EFFECTS[w.cardId]?.onDeathAny?.(this.ctx(w), u);
        }
        // Pumpkins (Andromeda Robin) take the Deathrattle of any other unit that dies, for this battle only
        if (u.cardId !== 'pumpkin' && EFFECTS[u.cardId]?.deathrattle) {
          const key = `dr_${u.cardId}`;
          const m = mult(u);
          for (const side of this.sides) for (const pk of side.units) {
            if (pk.cardId !== 'pumpkin' || pk.hp <= 0 || (pk.mem[key] ?? 0) >= m) continue;
            pk.mem[key] = m;
            this.snap('trigger', { source: pk.id, note: `Pumpkin gained ${def(u.cardId).name}'s Deathrattle` });
          }
        }
        // deathrattles (Tom Judith)
        const dr = EFFECTS[u.cardId]?.deathrattle;
        const pumpkinEmpty = u.cardId === 'pumpkin' && !Object.keys(u.mem).some((k) => k.startsWith('dr_'));
        let times = 1;
        for (const f of s.units) if (f.cardId === 'tom_judith' && f.hp > 0) times = Math.max(times, f.golden ? 3 : 2);
        times += trinketCount(s.owner, 'gravebell');
        // Rattler (trinket): "Deathrattle: Summon a random Tier 1 unit", given at Start of Combat
        if (u.mem.rattle) {
          let at = Math.min(pos, s.units.length);
          for (let i = 0; i < times * u.mem.rattle; i++) {
            const id = drawFromPool(this.g, (cid) => def(cid).tier === 1, false);
            if (!id || !this.spawn(s, id, false, at)) break;
            at++;
            this.snap('trigger', { note: `Rattler: Summon ${def(id).name}` });
          }
          if (s.persistent) s.owner.deathrattlesGame = (s.owner.deathrattlesGame ?? 0) + times;
          for (const w of s.units) if (w.cardId === 'warmech' && w.hp > 0) { w.atk += 4 * mult(w) * times; w.hp += 2 * mult(w) * times; }
        }
        if (dr && !pumpkinEmpty) {
          for (let i = 0; i < times; i++) dr(this.ctx(u, Math.min(pos, s.units.length)));
          // WARMECH: +4/+2 (Golden +8/+4) per Deathrattle triggered this game, growing as they happen
          if (s.persistent) s.owner.deathrattlesGame = (s.owner.deathrattlesGame ?? 0) + times;
          for (const w of s.units) if (w.cardId === 'warmech' && w.hp > 0) { w.atk += 4 * mult(w) * times; w.hp += 2 * mult(w) * times; }
          this.snap('trigger', { source: u.id, note: `${def(u.cardId).name}: Deathrattle` });
        }
        // reborn
        if (has(u, 'reborn')) {
          const d = def(u.cardId);
          const m = u.golden ? 2 : 1;
          if (s.units.filter((x) => x.hp > 0).length < CONFIG.boardSize) {
            // Horseman comes back with its full stats (as it started the battle); others with 1 Health
            const full = u.cardId === 'horseman';
            const r = this.makeCU(s.idx, u.cardId, u.golden, full ? u.startAtk : d.atk * m + ownerBonus(s.owner, u).atk, full ? u.startHp : 1,
              d.keywords.filter((k) => k !== 'reborn'), u.src, { ...u.mem, rattle: 0 });
            s.units.splice(Math.min(pos, s.units.length), 0, r);
            this.addFx({ k: 'reborn', to: r.id });
            for (const side of this.sides) for (const w of [...side.units]) {
              if (w.hp > 0) EFFECTS[w.cardId]?.onRebornAny?.(this.ctx(w), r);
            }
            this.snap('trigger', { source: r.id, note: `${d.name}: Reborn` });
          }
        }
      }
      // Secret: when your last unit dies, spawn a Forest Abomination (id white_ninja)
      for (const s of this.sides) {
        if (!s.units.some((u) => u.hp > 0) && s.secrets.length) {
          const golden = s.secrets.shift()!;
          this.spawn(s, 'white_ninja', golden, 0);
          this.snap('trigger', { note: 'Secret: Forest Abomination' });
        }
      }
      this.snap('resolve');
    }
  }

  // ---------- attacking ----------
  chooseTarget(attacker: CUnit): CUnit | undefined {
    const foes = this.enemy(this.sides[attacker.side]).units.filter((u) => u.hp > 0);
    if (!foes.length) return undefined;
    const taunts = foes.filter((u) => has(u, 'taunt'));
    return pick(this.g, taunts.length ? taunts : foes);
  }

  attackNow(a: CUnit, forced?: CUnit) {
    if (this.depth > 6 || a.hp <= 0) return;
    this.depth++;
    this.attackOnce(a, forced);
    this.depth--;
  }

  /**
   * Eve Williams' Doom Bauble: while this side has room, each loaded unit is summoned and attacks a random enemy
   * at once (Taunt doesn't protect). It's a temporary copy: once fired it's used up and goes back to the pool.
   */
  fireBaubles(s: Side) {
    const ammo = s.owner.bauble;
    if (!s.persistent || !ammo?.length) return;
    const live = (x: Side) => x.units.filter((u) => u.hp > 0);
    while (ammo.length && live(s).length < CONFIG.boardSize && live(this.enemy(s)).length) {
      const u = ammo.shift()!;
      const cu = this.spawnUnit(s, u, s.units.length);
      if (!cu) { ammo.unshift(u); return; }
      if (!def(u.cardId).token && this.g.pool[u.cardId] !== undefined) this.g.pool[u.cardId] += u.golden ? 3 : 1;
      this.snap('trigger', { source: cu.id, note: `Doom Bauble: FIRE ${def(u.cardId).name}!` });
      this.attackNow(cu, pick(this.g, live(this.enemy(s))));
      this.resolveDeaths();
    }
  }

  private attackOnce(a: CUnit, forced?: CUnit) {
    if (++this.steps > MAX_STEPS) return;
    let t = forced && forced.hp > 0 ? forced : this.chooseTarget(a);
    if (!t) return;
    const side = this.sides[a.side];
    const e = EFFECTS[a.cardId];
    // Tank and Sickle: the Rally only hits the units next to the target, so it lands with the attack itself
    const splash = !!(e?.rally && e.splash);
    this.snap('attack', { attacker: a.id, target: t.id, ...(splash ? { splash: this.adjacent(t).map((u) => u.id) } : {}) });
    if (splash) {
      this.inExchange = true;
      e!.rally!(this.ctx(a), t);
      this.inExchange = false;
      for (const w of [...side.units]) if (w.hp > 0) EFFECTS[w.cardId]?.onRallyFriendly?.(this.ctx(w), a);
    }
    // Rally
    if (e?.rally && !splash) {
      e.rally(this.ctx(a), t);
      for (const w of [...side.units]) if (w.hp > 0) EFFECTS[w.cardId]?.onRallyFriendly?.(this.ctx(w), a);
      this.snap('trigger', { source: a.id, note: `${def(a.cardId).name}: Rally` });
      this.resolveDeaths();
      if (a.hp <= 0) return;
      if (t.hp <= 0) {
        t = this.chooseTarget(a);
        if (!t) return;
      }
    }
    const idx = side.units.indexOf(a);
    let invuln = 0;
    for (const u of side.units) if (u.cardId === 'vulnerability' && u.hp > 0) invuln = Math.max(invuln, u.golden ? 2 : 1);
    const atkA = a.atk;
    const atkT = t.atk;
    const tAtk = t.atk;
    const tMaxHp = Math.max(t.hp, t.startHp);
    this.inExchange = true;
    this.damage(t, atkA, a, false, true);
    if (idx >= invuln) this.damage(a, atkT, t);
    this.inExchange = false;
    this.snap('hit', { attacker: a.id, target: t.id });
    // "when this attacks and kills a unit" (Adder)
    if (t.hp <= 0) {
      const k = EFFECTS[a.cardId]?.onAttackKill;
      if (k) {
        k(this.ctx(a), t, tAtk, tMaxHp);
        this.snap('trigger', { source: a.id, note: `${def(a.cardId).name}` });
      }
    }
    this.resolveDeaths();
  }

  // ---------- main loop ----------
  run(): 0 | 1 | -1 {
    const [A, B] = this.sides;
    // Remember: the Azure units next to it when the battle starts keep what they gain in it
    const remembered: { cu: CUnit; m: number }[] = [];
    for (const s of this.sides) {
      if (!s.persistent) continue;
      s.units.forEach((u, i) => {
        if (u.cardId !== 'remember') return;
        for (const n of [s.units[i - 1], s.units[i + 1]]) if (n && isTribe(n, 'azure') && !remembered.some((r) => r.cu === n)) remembered.push({ cu: n, m: u.golden ? 2 : 1 });
      });
    }
    this.snap('start');
    const aCount = A.units.length;
    const bCount = B.units.length;
    this.attacking = aCount > bCount ? 0 : bCount > aCount ? 1 : rand(this.g) < 0.5 ? 0 : 1;
    // Start of Combat: hero powers and trinkets first, then units
    for (const s of [this.sides[this.attacking], this.sides[1 - this.attacking]]) {
      this.heroSide = s.idx;
      heroSoc(this, s);
      this.heroSide = undefined;
    }
    this.snap('trigger', { note: 'Start of Combat' });
    this.resolveDeaths();
    // Green Ninja: from your hand, it joins the battle if there's room (a temporary copy; the card stays in hand)
    for (const s of [this.sides[this.attacking], this.sides[1 - this.attacking]]) {
      if (!s.persistent) continue;
      for (const u of s.owner.hand) {
        if (u.cardId !== 'orange_ninja') continue;
        if (s.units.filter((x) => x.hp > 0).length >= CONFIG.boardSize) break; // no room: it just stays home (not a summon)
        if (!this.spawnUnit(s, u, s.units.length, u.golden ? 2 : 1)) break; // Golden: the copy has double stats
      }
    }
    for (const s of [this.sides[this.attacking], this.sides[1 - this.attacking]]) {
      for (const u of [...s.units]) {
        const soc = EFFECTS[u.cardId]?.soc;
        if (soc && u.hp > 0) {
          soc(this.ctx(u));
          this.snap('trigger', { source: u.id, note: `${def(u.cardId).name}: Start of Combat` });
          this.resolveDeaths();
        }
      }
    }
    while (this.steps < MAX_STEPS) {
      for (const s of [this.sides[this.attacking], this.sides[1 - this.attacking]]) this.fireBaubles(s);
      const live = (s: Side) => s.units.filter((u) => u.hp > 0);
      if (!live(A).length || !live(B).length) break;
      // units with 0 Attack don't attack, except ones with a Rally (Left Twinbot), so their Rally can happen
      const attacks = (u: CUnit) => u.hp > 0 && (u.atk > 0 || !!EFFECTS[u.cardId]?.rally);
      const canAttack = (s: Side) => s.units.some(attacks);
      if (!canAttack(A) && !canAttack(B)) break;
      const s = this.sides[this.attacking];
      if (!canAttack(s)) {
        this.attacking = (1 - this.attacking) as 0 | 1;
        continue;
      }
      // find next attacker from pointer
      let attacker: CUnit | undefined;
      for (let k = 0; k < s.units.length; k++) {
        const u = s.units[(s.ptr + k) % s.units.length];
        if (attacks(u)) {
          attacker = u;
          break;
        }
      }
      if (!attacker) break;
      const startIdx = s.units.indexOf(attacker);
      const swings = has(attacker, 'windfury') ? 2 : 1;
      for (let i = 0; i < swings && attacker.hp > 0; i++) {
        if (!live(this.enemy(s)).length) break;
        this.attackOnce(attacker);
      }
      s.ptr = attacker.hp > 0 ? s.units.indexOf(attacker) + 1 : startIdx;
      if (s.ptr >= s.units.length) s.ptr = 0;
      this.attacking = (1 - this.attacking) as 0 | 1;
    }
    const aLive = A.units.filter((u) => u.hp > 0).length;
    const bLive = B.units.filter((u) => u.hp > 0).length;
    const winner = aLive && !bLive ? 0 : bLive && !aLive ? 1 : -1;
    for (const { cu, m } of remembered) this.keepGains(cu, m);
    this.snap('end');
    return winner;
  }
}

function ghostPlayer(p: Player): Player {
  // a detached copy so ghost effects can't change the real (dead) player
  return JSON.parse(JSON.stringify({ ...p, ghost: undefined, log: [] }));
}

export function runCombat(g: GameState, a: Player, b: Player, bIsGhost: boolean): CombatResult {
  const bBoard = bIsGhost ? b.ghost!.board : b.board;
  const bTier = bIsGhost ? b.ghost!.tier : b.tier;
  const c = new Combat(g,
    { p: a, board: a.board, tier: a.tier, persistent: true },
    { p: bIsGhost ? ghostPlayer(b) : b, board: bBoard, tier: bTier, persistent: !bIsGhost });
  // anything the battle permanently gave you (cards, growth) is shown when you're back in the shop
  const you = [a, b].find((x) => x.human);
  const winner = you ? withFx(g, you, { name: 'Battle' }, 'From the battle', () => c.run()) : c.run();
  let damage = 0;
  let dmgParts: CombatResult['dmgParts'];
  if (winner !== -1) {
    const ws = c.sides[winner];
    const survivors = ws.units.filter((u) => u.hp > 0);
    const bonusFrom: number[] = [];
    damage = combatDamage(ws.tier, survivors.length, bonusFrom.length);
    dmgParts = { tier: BASE_DAMAGE, perUnit: DAMAGE_PER_UNIT, units: survivors.map((u) => u.id), bonus: bonusFrom }; // tier: the base damage, stars on the winner's hero
  }
  // both armies still standing when time runs out: both players take damage (otherwise two huge armies could
  // draw forever and the game would never end)
  let stalemate: CombatResult['stalemate'];
  if (winner === -1) {
    const left = c.sides.map((s) => s.units.filter((u) => u.hp > 0).length);
    if (left[0] && left[1]) stalemate = [combatDamage(c.sides[1].tier, left[1]), combatDamage(c.sides[0].tier, left[0])];
  }
  // end of combat: Root
  for (const s of c.sides) {
    if (!s.persistent) continue;
    for (const u of s.units) {
      if (u.hp > 0 && u.cardId === 'root') {
        const src = s.owner.board.find((x) => x.uid === u.src);
        withFx(g, s.owner, { unit: src, name: 'Root' }, 'After the battle', () => {
          for (let i = 0; i < mult(u); i++) {
            const id = pickTribe(g, s.owner, 'brambor');
            if (id) gainNew(g, s.owner, id);
          }
        });
      }
    }
    for (const fn of s.afterFns) withFx(g, s.owner, { name: 'Battle' }, 'After the battle', fn);
  }
  // remember boards for Remember / scouting
  a.lastFightBoard = a.board.map(cloneUnit);
  if (!bIsGhost) b.lastFightBoard = b.board.map(cloneUnit);
  a.lastOpponent = bIsGhost ? null : b.id;
  a.lastOpponentBoard = bBoard.map(cloneUnit);
  if (!bIsGhost) {
    b.lastOpponent = a.id;
    b.lastOpponentBoard = a.board.map(cloneUnit);
  }
  return {
    a: a.id, b: bIsGhost ? -1 : b.id, ghostOf: bIsGhost ? b.id : undefined,
    winner, damage, dmgParts, stalemate, frames: a.human || (!bIsGhost && b.human) ? c.frames : [],
  };
}

function pickTribe(g: GameState, p: Player, tribe: string) {
  const ids = Object.keys(g.pool).filter((id) => g.pool[id] > 0 && isTribe(id, tribe as Tribe) && def(id).tier <= p.tier);
  const id = pick(g, ids);
  if (id) g.pool[id]--;
  return id;
}

export { tribeOf, hasBattlecry, addKw };
