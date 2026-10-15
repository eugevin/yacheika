import { ANOMALIES } from '../shared/anomalies.ts';
import { exitAt, inCell, tambourAt, type Exit } from '../shared/map.ts';
import { FLATS, type MaskId, type OutfitId } from '../shared/masks.ts';
import type { ClientMsg, Phase, PlayerInfo, RtcSignal, RunStats, ServerMsg } from '../shared/protocol.ts';
import {
  ANOMALY_CHANCE,
  COUNTDOWN_MS,
  SETTLE_MS,
  GOAL,
  MAX_PLAYERS,
  RECENT_LIMIT,
  SAMOSBOR_MS,
  maxDifficulty,
  morokChance,
  privateChance,
} from '../shared/rules.ts';
import { iceServers } from './turn.ts';

const COLORS = ['#e8c547', '#5fb3e8', '#e8705f', '#7be85f', '#c77be8', '#e8a35f'];
const POS_EVERY = 3; // ticks between position broadcasts: 30 Hz tick -> 10 Hz

export const TICK = 1 / 30;

/**
 * Token bucket: up to `size` messages at once, refilled at `rate` per second. Excess is dropped,
 * so one flooding client can't swamp the rest of the room.
 */
class Bucket {
  private readonly size: number;
  private readonly rate: number;
  private tokens: number;
  private last = Date.now();

  constructor(size: number, rate: number) {
    this.size = size;
    this.rate = rate;
    this.tokens = size;
  }

  take() {
    const now = Date.now();
    this.tokens = Math.min(this.size, this.tokens + ((now - this.last) / 1000) * this.rate);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens--;
    return true;
  }
}

// Positions come at 15 Hz; voice setup sends a burst of ICE candidates to every peer.
const anyMsg = () => new Bucket(120, 60);
// Chat and marks are rebroadcast to the whole room.
const loudMsg = () => new Bucket(8, 2);

export interface Player extends PlayerInfo {
  send: (msg: ServerMsg) => void;
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  /** Cycle the last reported position belongs to; -1 until the player reports one. */
  posCycle: number;
  /**
   * Has walked into the cell this cycle. Cycles start inside the back vestibule, so standing in
   * an exit zone only counts as a choice after that.
   */
  entered: boolean;
  any: Bucket;
  loud: Bucket;
}

interface Anomaly {
  id: string;
  name: string;
  seed: number;
  /** Player who alone can see it, or null when everyone can. */
  only: number | null;
}

const rand = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)];

/** One group walking the loop: lobby, cycles, verdicts. */
export class Room {
  readonly code: string;
  readonly players = new Map<number, Player>();
  private nextId = 1;
  private phase: Phase = 'lobby';
  private cycle = 0;
  private cycleId = 0;
  private anomaly: Anomaly | null = null;
  /** What one player is shown in a clean cycle: an anomaly that isn't there. */
  private morok: (Anomaly & { only: number }) | null = null;
  private recent: string[] = [];
  private countdownEnd: number | null = null;
  /** When the verdict is due once the whole group is in the vestibules. */
  private settleEnd: number | null = null;
  /** When the samosbor that follows a wrong verdict is over. */
  private samosborEnd = 0;
  /** Tick time of the run's start, set on the first tick after it (tests pass their own clock). */
  private startedAt: number | null = null;
  private samosbors = 0;
  private moroks = 0;
  private run: RunStats | null = null;
  private ticks = 0;
  /** Time of the last tick (tests pass their own clock), and when the current cycle began by it. */
  private clock = Date.now();
  private cycleStart = this.clock;

  constructor(code: string) {
    this.code = code;
  }

  get full() {
    return this.players.size >= MAX_PLAYERS;
  }

  join(send: (msg: ServerMsg) => void, name: string, mask: MaskId = 'none', outfit: OutfitId = 'tracksuit'): Player {
    const others = [...this.players.values()];
    const color = COLORS.find((c) => !others.some((p) => p.color === c)) ?? rand(COLORS);
    const flat = FLATS.find((f) => !others.some((p) => p.flat === f)) ?? rand(FLATS);
    const p: Player = { id: this.nextId++, name, color, mask, outfit, flat, send, x: 0, z: 0, yaw: 0, pitch: 0, posCycle: -1, entered: false, any: anyMsg(), loud: loudMsg() };
    const ice = iceServers(`${this.code}-${p.id}`);
    send({ t: 'hello', id: p.id, code: this.code, color, flat, players: others.map(info), ice });
    this.broadcast({ t: 'joined', player: info(p) });
    this.players.set(p.id, p);
    send(this.cycleFor(p));
    return p;
  }

  leave(p: Player) {
    this.players.delete(p.id);
    this.broadcast({ t: 'left', id: p.id });
    // A private anomaly loses its only witness; the cycle stays as is, the group just can't know.
  }

  /** Messages come straight from the network: every field is checked before it is used. */
  onMessage(p: Player, msg: ClientMsg) {
    if (!p.any.take()) return;
    switch (msg.t) {
      case 'pos':
        if (!Number.isInteger(msg.c) || ![msg.x, msg.z, msg.yaw, msg.pitch].every(Number.isFinite)) return;
        p.x = msg.x;
        p.z = msg.z;
        p.yaw = msg.yaw;
        p.pitch = msg.pitch;
        p.posCycle = msg.c;
        if (msg.c === this.cycleId && inCell(msg.x, msg.z)) p.entered = true;
        break;
      case 'start':
        if (this.phase === 'lobby' || this.phase === 'won') this.start();
        break;
      case 'chat': {
        if (typeof msg.text !== 'string' || !p.loud.take()) return;
        const text = msg.text.replace(/[\p{C}]/gu, '').trim().slice(0, 200);
        if (text) this.broadcast({ t: 'chat', id: p.id, text });
        break;
      }
      case 'mark':
        if (![msg.x, msg.y, msg.z].every(Number.isFinite) || !p.loud.take()) return;
        this.broadcast({ t: 'mark', id: p.id, x: msg.x, y: msg.y, z: msg.z });
        break;
      case 'rtc': {
        const data = signal(msg.data);
        if (data && msg.to !== p.id) this.players.get(msg.to)?.send({ t: 'rtc', from: p.id, data });
        break;
      }
    }
  }

  tick(now = Date.now()) {
    this.clock = now;
    if (++this.ticks % POS_EVERY === 0 && this.players.size > 1) {
      const list: [number, number, number, number, number, number][] = [];
      for (const p of this.players.values())
        if (p.posCycle >= 0) list.push([p.id, round(p.x), round(p.z), round(p.yaw), round(p.pitch), p.posCycle]);
      this.broadcast({ t: 'pos', list });
    }

    if (this.phase === 'samosbor' && now >= this.samosborEnd) this.newCycle(false);
    if (this.phase !== 'playing') return;
    this.startedAt ??= now;

    const choices = new Map<number, Exit | null>();
    const counted = (p: Player) => p.posCycle === this.cycleId && p.entered;
    for (const p of this.players.values()) choices.set(p.id, counted(p) ? tambourAt(p.x, p.z) : null);
    const out = [...choices.values()].filter((c) => c !== null);
    if (out.length === 0) {
      this.settleEnd = null;
      if (this.countdownEnd !== null) {
        this.countdownEnd = null;
        this.broadcast({ t: 'countdown_off' });
      }
      return;
    }
    this.countdownEnd ??= now + COUNTDOWN_MS;
    if (out.length === choices.size) {
      // everyone is out: a moment for the last ones to reach the zones, unless they all stand there
      this.settleEnd ??= now + SETTLE_MS;
      const zoned = [...this.players.values()].every((p) => exitAt(p.x, p.z) !== null);
      if (zoned || now >= this.settleEnd) {
        this.resolve([...choices.values()], now);
        return;
      }
    } else this.settleEnd = null;
    if (now >= this.countdownEnd) {
      this.resolve([...choices.values()], now);
      return;
    }
    const forward = out.filter((c) => c === 'forward').length;
    this.broadcast({
      t: 'countdown',
      // with everyone out, the door shuts when they have settled, not when the countdown runs out
      endsIn: Math.min(this.countdownEnd, this.settleEnd ?? Infinity) - now,
      forward,
      back: out.length - forward,
      inside: choices.size - out.length,
    });
  }

  private start() {
    this.cycle = 0;
    this.recent = [];
    this.startedAt = null;
    this.samosbors = 0;
    this.moroks = 0;
    this.run = null;
    this.newCycle(true);
  }

  /** The first cycle of a run is always clean, so everyone sees what "normal" looks like. */
  private newCycle(first: boolean) {
    this.phase = 'playing';
    this.cycleId++;
    this.cycleStart = this.clock;
    this.countdownEnd = null;
    this.settleEnd = null;
    this.anomaly = first ? null : this.roll();
    this.morok = first || this.anomaly ? null : this.rollMorok();
    for (const p of this.players.values()) p.entered = false;
    this.sendCycle();
  }

  private roll(): Anomaly | null {
    if (Math.random() >= ANOMALY_CHANCE) return null;
    const tier = maxDifficulty(this.cycle);
    const ids = [...this.players.keys()];
    const pool = ANOMALIES.filter((a) => a.tier <= tier && (a.players ?? 1) <= ids.length && !this.recent.includes(a.id));
    if (pool.length === 0) return null;
    const a = rand(pool);
    this.recent = [...this.recent, a.id].slice(-RECENT_LIMIT);
    const alone = a.only === 'always' || (a.only !== 'never' && Math.random() < privateChance(this.cycle, ids.length));
    const only = alone ? rand(ids) : null;
    return { id: a.id, name: a.name, seed: Math.floor(Math.random() * 2 ** 31), only };
  }

  /** A morok for a clean cycle, maybe: drawn like an anomaly, from those that can be one. */
  private rollMorok(): (Anomaly & { only: number }) | null {
    const ids = [...this.players.keys()];
    if (Math.random() >= morokChance(this.cycle, ids.length)) return null;
    const tier = maxDifficulty(this.cycle);
    const pool = ANOMALIES.filter((a) => a.morok && a.tier <= tier && (a.players ?? 1) <= ids.length && !this.recent.includes(a.id));
    if (pool.length === 0) return null;
    const a = rand(pool);
    this.recent = [...this.recent, a.id].slice(-RECENT_LIMIT);
    return { id: a.id, name: a.name, seed: Math.floor(Math.random() * 2 ** 31), only: rand(ids) };
  }

  /**
   * Those who left decide, by majority; a tie is a samosbor. Whoever is still in the cell doesn't
   * break the pass: they are carried along behind a fade. A right choice starts the next cycle at
   * once: players in the exit zones walk straight into it. A wrong one sets off a samosbor in the
   * cell they are in; exits don't count while it lasts, and the cycle after it starts from floor 0
   * behind a fade.
   */
  private resolve(choices: (Exit | null)[], now: number) {
    const forward = choices.filter((c) => c === 'forward').length;
    const back = choices.filter((c) => c === 'back').length;
    const split = forward === back;
    const choice: Exit | null = split ? null : forward > back ? 'forward' : 'back';
    const correct = choice !== null && (choice === 'back') === (this.anomaly !== null);
    // one line per verdict, to see which anomalies nobody notices and which are too obvious
    const seen = this.anomaly ? `${this.anomaly.id}${this.anomaly.only !== null ? ' (private)' : ''}` : this.morok ? `clean (morok ${this.morok.id})` : 'clean';
    console.log(`verdict ${this.code} floor ${this.cycle}: ${seen}, ${choice ?? 'tie'}, ${correct ? 'right' : 'wrong'}, ${forward + back}/${choices.length} out`);
    this.cycle = correct ? this.cycle + 1 : 0;
    const won = this.cycle >= GOAL;
    const a = this.anomaly;
    const m = this.morok;
    if (m && choice === 'back') this.moroks++;
    this.broadcast({ t: 'countdown_off' });
    this.broadcast({
      t: 'result',
      correct,
      split,
      choice,
      anomaly: a && { name: a.name, seenBy: a.only === null ? null : (this.players.get(a.only)?.name ?? '???') },
      morok: m && { name: m.name, seenBy: this.players.get(m.only)?.name ?? '???' },
      cycle: this.cycle,
      won,
    });
    if (!correct) {
      this.phase = 'samosbor';
      this.samosborEnd = now + SAMOSBOR_MS;
      this.samosbors++;
      this.anomaly = null;
      this.morok = null;
      this.sendCycle();
      return;
    }
    if (!won) {
      this.newCycle(false);
      return;
    }
    this.run = { ms: now - (this.startedAt ?? now), samosbors: this.samosbors, moroks: this.moroks };
    this.phase = 'won';
    this.cycleId++;
    this.countdownEnd = null;
    this.settleEnd = null;
    this.anomaly = null;
    this.morok = null;
    this.sendCycle();
  }

  private sendCycle() {
    for (const p of this.players.values()) p.send(this.cycleFor(p));
  }

  private cycleFor(p: Player): ServerMsg {
    const a = this.anomaly;
    const visible = a && (a.only === null || a.only === p.id);
    const m = this.morok?.only === p.id ? this.morok : null;
    return {
      t: 'cycle',
      phase: this.phase,
      cycle: this.cycle,
      goal: GOAL,
      cycleId: this.cycleId,
      elapsed: Math.max(0, this.clock - this.cycleStart),
      anomalies: visible ? [{ id: a.id, seed: a.seed }] : m ? [{ id: m.id, seed: m.seed, morok: true }] : [],
      ...(this.phase === 'won' && this.run ? { run: this.run } : {}),
    };
  }

  private broadcast(msg: ServerMsg) {
    for (const p of this.players.values()) p.send(msg);
  }
}

function info(p: Player): PlayerInfo {
  return { id: p.id, name: p.name, color: p.color, mask: p.mask, outfit: p.outfit, flat: p.flat };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** A WebRTC signal rebuilt from known fields only, or null if it isn't one. */
function signal(data: unknown): RtcSignal | null {
  if (!isObject(data)) return null;
  const { sdp, candidate } = data;
  if (isObject(sdp)) {
    if ((sdp.type !== 'offer' && sdp.type !== 'answer') || typeof sdp.sdp !== 'string') return null;
    return { sdp: { type: sdp.type, sdp: sdp.sdp } };
  }
  if (isObject(candidate)) {
    const { candidate: line, sdpMid, sdpMLineIndex, usernameFragment } = candidate;
    if (typeof line !== 'string') return null;
    if (sdpMid != null && typeof sdpMid !== 'string') return null;
    if (sdpMLineIndex != null && !Number.isInteger(sdpMLineIndex)) return null;
    if (usernameFragment != null && typeof usernameFragment !== 'string') return null;
    return { candidate: { candidate: line, sdpMid, sdpMLineIndex, usernameFragment } as RTCIceCandidateInit };
  }
  return null;
}

function round(v: number) {
  return Math.round(v * 100) / 100;
}
