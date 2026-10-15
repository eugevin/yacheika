import type { Exit } from './map.ts';
import type { MaskId, OutfitId } from './masks.ts';

export type Phase = 'lobby' | 'playing' | 'samosbor' | 'won';

/** How the run went, shown once the group is out: time from the start and samosbors on the way. */
export interface RunStats {
  ms: number;
  samosbors: number;
  /** Samosbors the group brought on itself by turning back from a morok. */
  moroks: number;
}

export interface PlayerInfo {
  id: number;
  name: string;
  color: string;
  mask: MaskId;
  outfit: OutfitId;
  /** Flat number on the resident's card, unique in the room. */
  flat: number;
}

/** WebRTC signalling for voice chat, relayed as is between two players of the same room. */
export type RtcSignal = { sdp: RTCSessionDescriptionInit } | { candidate: RTCIceCandidateInit };

export type ClientMsg =
  | { t: 'join'; name: string; code: string; mask: MaskId; outfit: OutfitId }
  | { t: 'start' }
  // c: cycle the position belongs to, so a position from the previous cycle can't pick an exit;
  // pitch only tilts the avatar's head
  | { t: 'pos'; c: number; x: number; z: number; yaw: number; pitch: number }
  | { t: 'chat'; text: string }
  | { t: 'mark'; x: number; y: number; z: number }
  | { t: 'rtc'; to: number; data: RtcSignal };

export type ServerMsg =
  | { t: 'error'; text: string }
  // ice: STUN/TURN servers for voice chat, with short-lived TURN credentials
  | { t: 'hello'; id: number; code: string; color: string; flat: number; players: PlayerInfo[]; ice: RTCIceServer[] }
  | { t: 'joined'; player: PlayerInfo }
  | { t: 'left'; id: number }
  /**
   * Personal view of the current cycle. `anomalies` only lists what this player is allowed to see:
   * an anomaly shown to someone else is never sent. A morok (an anomaly that isn't there) comes
   * flagged, to its witness only: to everyone else the cycle is a clean one. A samosbor keeps the cycleId of the cycle it
   * broke out in: the cell stays, only the phase changes. `run` comes with the phase 'won'.
   * `elapsed`: ms since the cycle began, so every client's clock of the cycle agrees.
   */
  | {
      t: 'cycle';
      phase: Phase;
      cycle: number;
      goal: number;
      cycleId: number;
      elapsed: number;
      anomalies: { id: string; seed: number; morok?: true }[];
      run?: RunStats;
    }
  // c: cycle each position belongs to; positions from another cycle are in the other corridor
  | { t: 'pos'; list: [id: number, x: number, z: number, yaw: number, pitch: number, c: number][] }
  | { t: 'countdown'; endsIn: number; forward: number; back: number; inside: number }
  | { t: 'countdown_off' }
  | {
      t: 'result';
      correct: boolean;
      split: boolean;
      choice: Exit | null;
      anomaly: { name: string; seenBy: string | null } | null;
      /** What one player was shown in a clean cycle, told only after the choice. */
      morok: { name: string; seenBy: string } | null;
      cycle: number;
      won: boolean;
    }
  | { t: 'chat'; id: number; text: string }
  | { t: 'mark'; id: number; x: number; y: number; z: number }
  | { t: 'rtc'; from: number; data: RtcSignal };
