/**
 * Battle simulation, following Hearthstone: Battlegrounds conventions:
 *  - the side with more units attacks first (coin flip if equal), sides alternate;
 *  - each side's units attack left-to-right; targets are random, Taunt first; Stealth can't be targeted;
 *  - Divine Shield absorbs one hit; Venomous kills on damage (one use); Reborn returns at 1 Health;
 *  - Windfury attacks twice; deaths resolve left-to-right, attacking side first.
 */
import { addKw, cloneUnit, def, effStats, has, mult, pick, rand, removeKw, sample, tribeAtkFor, tribeOf, CONFIG } from './core';
import { EFFECTS, hasBattlecry, battlecryTimes, type CCtx } from './effects';
import { gainNew, combatDamage, onBattlecryTriggered } from './game';
import { heroHooks, heroSoc } from './heroes';
import { withFx } from './fx';
import type { Body, CombatFrame, CombatFrameUnit, CombatFx, CombatResult, GameState, Keyword, Player, Slot, Unit } from './types';

export interface CUnit extends Body {
  id: number;
  side: 0 | 1;
  src: number | null;
  slot: number;
  avenge: number;
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
  slots: Slot[];
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

  constructor(g: GameState, a: { p: Player; board: Unit[]; slots: Slot[]; tier: number; persistent: boolean },
    b: { p: Player; board: Unit[]; slots: Slot[]; tier: number; persistent: boolean }) {
    this.g = g;
    this.sides = [this.makeSide(0, a), this.makeSide(1, b)];
  }

  private makeSide(idx: 0 | 1, s: { p: Player; board: Unit[]; slots: Slot[]; tier: number; persistent: boolean }): Side {
    const side: Side = {
      idx, units: [], owner: s.p, persistent: s.persistent, slots: s.slots, tier: s.tier,
      died: [], secrets: [], ptr: 0, afterFns: [], heroAvenge: {},
    };
    s.board.forEach((u, i) => {
      // for ghosts use a player-like view with the ghost's slots
      const view = { ...s.p, slots: s.slots } as Player;
      const st = effStats(view, u, 'board', i);
      side.units.push(this.makeCU(idx, u.cardId, u.golden, st.atk, st.hp, st.kw, u.uid, i, { ...u.mem }));
    });
    return side;
  }

  private makeCU(side: 0 | 1, cardId: string, golden: boolean, atk: number, hp: number, kw: Keyword[], src: number | null, slot: number, mem: Record<string, number> = {}): CUnit {
    return {
      id: this.nextId++, side, cardId, golden, atk, hp, kw: [...kw], mem, src, slot, avenge: 0,
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

  snap(kind: CombatFrame['kind'], extra: Partial<CombatFrame> = {}) {
    const f = (s: Side): CombatFrameUnit[] =>
      s.units.filter((u) => !u.processed).map((u) => ({
        id: u.id, cardId: u.cardId, golden: u.golden, atk: u.atk, hp: Math.max(0, u.hp), kw: [...u.kw], ...(u.hp <= 0 ? { dead: true, ...(u.hp < 0 ? { over: -u.hp } : {}) } : {}),
      }));
    const frame: CombatFrame = { kind, sides: [f(this.sides[0]), f(this.sides[1])], ...extra };
    if (this.fx.length) {
      frame.fx = this.fx;
      this.fx = [];
    }
    this.frames.push(frame);
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

  /** Apply a permanent change to the persistent unit behind a combat unit, and an optional stat change in combat. */
  perm(cu: CUnit, fn: (u: Unit) => void, atk = 0, hp = 0) {
    cu.atk += atk;
    cu.hp += hp;
    const s = this.sides[cu.side];
    if (!s.persistent || cu.src === null) return;
    const u = s.owner.board.find((x) => x.uid === cu.src);
    if (u) fn(u);
  }

  spawn(s: Side, cardId: string, golden: boolean, pos: number): CUnit | null {
    if (s.units.filter((u) => u.hp > 0).length >= CONFIG.boardSize) return null;
    const d = def(cardId);
    const m = golden ? 2 : 1;
    const cu = this.makeCU(s.idx, cardId, golden, d.atk * m, d.hp * m, d.keywords, null, -1);
    cu.atk += tribeAtkFor(s.owner, cardId);
    s.units.splice(Math.max(0, Math.min(pos, s.units.length)), 0, cu);
    this.addFx({ k: 'summon', to: cu.id });
    heroHooks.onSummon(this, s, cu);
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
    if (s.units.filter((u) => u.hp > 0).length >= CONFIG.boardSize) return null;
    const cu = this.makeCU(s.idx, d.cardId, d.golden, d.startAtk, d.startHp, d.startKw, null, -1, { ...d.mem });
    s.units.splice(Math.max(0, Math.min(pos, s.units.length)), 0, cu);
    this.addFx({ k: 'summon', to: cu.id });
    heroHooks.onSummon(this, s, cu);
    this.snap('trigger', { note: `Summon ${def(d.cardId).name}` });
    return cu;
  }

  /** Bring a card from hand into battle as a temporary copy. */
  spawnUnit(s: Side, u: Unit, pos: number): CUnit | null {
    if (s.units.filter((x) => x.hp > 0).length >= CONFIG.boardSize) return null;
    const st = effStats(s.owner, u, 'hand');
    const cu = this.makeCU(s.idx, u.cardId, u.golden, st.atk, st.hp, st.kw, null, -1, { ...u.mem });
    s.units.splice(Math.max(0, Math.min(pos, s.units.length)), 0, cu);
    this.addFx({ k: 'summon', to: cu.id });
    heroHooks.onSummon(this, s, cu);
    this.snap('trigger', { note: `Summon ${def(u.cardId).name}` });
    return cu;
  }

  kill(t: CUnit, source?: CUnit) {
    if (t.hp <= 0) return;
    t.hp = 0;
    if (source && !t.killedBy) t.killedBy = source;
    this.addFx({ k: 'kill', to: t.id, from: source?.id });
  }

  damage(t: CUnit | undefined, amount: number, source?: CUnit) {
    if (!t || t.hp <= 0 || amount <= 0) return;
    if (!this.inExchange) this.addFx({ k: 'hit', to: t.id, from: source?.id, fromSide: source ? undefined : this.heroSide });
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
    if (source && has(source, 'venomous') && t.hp > 0) {
      t.hp = 0;
      removeKw(source, 'venomous');
      this.addFx({ k: 'venom', to: t.id });
    }
    if (t.hp <= 0 && source && !t.killedBy) t.killedBy = source;
    if (t.hp > 0) EFFECTS[t.cardId]?.onDamaged?.(this.ctx(t));
    if (t.hp <= 0 && source?.cardId === 'pyro' && source.hp > 0) {
      const excess = amount - before;
      if (excess > 0) {
        const adj = this.adjacent(t);
        const targets = source.golden ? adj : sample(this.g, adj, 1);
        for (const a of targets) this.damage(a, excess, source);
      }
    }
  }

  triggerBattlecry(s: Side, u: CUnit) {
    const e = EFFECTS[u.cardId];
    if (!e?.battlecry) return;
    const times = battlecryTimes(s.owner, u) * (s.owner.trinkets?.includes('crown_of_echoes') ? 2 : 1);
    for (let i = 0; i < times; i++) {
      e.battlecry({ g: this.g, p: s.owner, self: u, m: mult(u), board: s.units.filter((x) => x.hp > 0), combat: this, side: s });
      if (s.persistent) onBattlecryTriggered(this.g, s.owner);
    }
    this.snap('trigger', { source: u.id, note: `${def(u.cardId).name}: Battlecry` });
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
        // Pumpkins (Andromeda Robin) permanently take the Deathrattle of any other unit that dies
        if (u.cardId !== 'pumpkin' && EFFECTS[u.cardId]?.deathrattle) {
          const key = `dr_${u.cardId}`;
          const m = mult(u);
          for (const side of this.sides) for (const pk of side.units) {
            if (pk.cardId !== 'pumpkin' || pk.hp <= 0 || (pk.mem[key] ?? 0) >= m) continue;
            pk.mem[key] = m;
            this.perm(pk, (pu) => { pu.mem[key] = m; });
            this.snap('trigger', { source: pk.id, note: `Pumpkin gained ${def(u.cardId).name}'s Deathrattle` });
          }
        }
        // deathrattles (Tom Judith)
        const dr = EFFECTS[u.cardId]?.deathrattle;
        const pumpkinEmpty = u.cardId === 'pumpkin' && !Object.keys(u.mem).some((k) => k.startsWith('dr_'));
        if (dr && !pumpkinEmpty) {
          let times = 1;
          for (const f of s.units) if (f.cardId === 'tom_judith' && f.hp > 0) times = Math.max(times, f.golden ? 3 : 2);
          if (s.owner.trinkets?.includes('gravebell')) times++;
          for (let i = 0; i < times; i++) dr(this.ctx(u, Math.min(pos, s.units.length)));
          this.snap('trigger', { note: `${def(u.cardId).name}: Deathrattle` });
        }
        // reborn
        if (has(u, 'reborn')) {
          const d = def(u.cardId);
          const m = u.golden ? 2 : 1;
          if (s.units.filter((x) => x.hp > 0).length < CONFIG.boardSize) {
            const r = this.makeCU(s.idx, u.cardId, u.golden, d.atk * m + tribeAtkFor(s.owner, u.cardId), 1,
              d.keywords.filter((k) => k !== 'reborn'), u.src, u.slot, { ...u.mem });
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
    let visible = foes.filter((u) => !has(u, 'stealth'));
    if (!visible.length) {
      for (const u of foes) removeKw(u, 'stealth');
      visible = foes;
    }
    const taunts = visible.filter((u) => has(u, 'taunt'));
    return pick(this.g, taunts.length ? taunts : visible);
  }

  attackNow(a: CUnit) {
    if (this.depth > 6 || a.hp <= 0) return;
    this.depth++;
    this.attackOnce(a);
    this.depth--;
  }

  private attackOnce(a: CUnit) {
    if (++this.steps > MAX_STEPS) return;
    let t = this.chooseTarget(a);
    if (!t) return;
    const side = this.sides[a.side];
    removeKw(a, 'stealth');
    this.snap('attack', { attacker: a.id, target: t.id });
    // Rally
    const e = EFFECTS[a.cardId];
    if (e?.rally) {
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
    this.inExchange = true;
    this.damage(t, atkA, a);
    if (idx >= invuln) this.damage(a, atkT, t);
    this.inExchange = false;
    this.snap('hit', { attacker: a.id, target: t.id });
    this.resolveDeaths();
  }

  // ---------- main loop ----------
  run(): 0 | 1 | -1 {
    const [A, B] = this.sides;
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
      const live = (s: Side) => s.units.filter((u) => u.hp > 0);
      if (!live(A).length || !live(B).length) break;
      const canAttack = (s: Side) => live(s).some((u) => u.atk > 0);
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
        if (u.hp > 0 && u.atk > 0) {
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
  const bSlots = bIsGhost ? b.ghost!.slots : b.slots;
  const bTier = bIsGhost ? b.ghost!.tier : b.tier;
  const c = new Combat(g,
    { p: a, board: a.board, slots: a.slots, tier: a.tier, persistent: true },
    { p: bIsGhost ? ghostPlayer(b) : b, board: bBoard, slots: bSlots, tier: bTier, persistent: !bIsGhost });
  // anything the battle permanently gave you (cards, growth) is shown when you're back in the shop
  const you = [a, b].find((x) => x.human);
  const winner = you ? withFx(g, you, { name: 'Battle' }, 'From the battle', () => c.run()) : c.run();
  let damage = 0;
  if (winner !== -1) {
    const ws = c.sides[winner];
    const survivors = ws.units.filter((u) => u.hp > 0);
    const tierSum = survivors.reduce((s, u) => s + def(u.cardId).tier, 0);
    const bonus = survivors.filter((u) => u.cardId === 'horseman').reduce((s, u) => s + mult(u), 0);
    damage = combatDamage(ws.tier, tierSum, bonus);
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
    winner, damage, frames: a.human || (!bIsGhost && b.human) ? c.frames : [],
  };
}

function pickTribe(g: GameState, p: Player, tribe: string) {
  const ids = Object.keys(g.pool).filter((id) => g.pool[id] > 0 && def(id).tribe === tribe && def(id).tier <= p.tier);
  const id = pick(g, ids);
  if (id) g.pool[id]--;
  return id;
}

export { tribeOf, hasBattlecry, addKw };
