import { MASKS, OUTFITS, isMask, isOutfit } from '../shared/masks.ts';
import type { ClientMsg, ServerMsg } from '../shared/protocol.ts';
import { Room, type Player } from './room.ts';

export type JoinMsg = Extract<ClientMsg, { t: 'join' }>;

function cleanName(raw: unknown) {
  return typeof raw === 'string' ? raw.replace(/[\p{C}]/gu, '').trim().slice(0, 16) : '';
}

function cleanCode(raw: unknown) {
  if (typeof raw !== 'string') return null;
  const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return code.length >= 3 && code.length <= 8 ? code : null;
}

/** Rooms by code. A code that doesn't exist yet creates that room, so a shared link always works. */
export class Rooms {
  private rooms = new Map<string, Room>();
  private guests = 0;

  join(msg: JoinMsg, send: (msg: ServerMsg) => void): { room: Room; player: Player } | { error: string } {
    const code = cleanCode(msg.code);
    if (!code) return { error: 'Неверный код комнаты' };
    const name = cleanName(msg.name) || `Гость ${++this.guests}`;
    let room = this.rooms.get(code);
    if (!room) this.rooms.set(code, (room = new Room(code)));
    if (room.full) return { error: 'Комната заполнена' };
    const mask = isMask(msg.mask) ? msg.mask : MASKS[Math.floor(Math.random() * MASKS.length)].id;
    const outfit = isOutfit(msg.outfit) ? msg.outfit : OUTFITS[Math.floor(Math.random() * OUTFITS.length)].id;
    return { room, player: room.join(send, name, mask, outfit) };
  }

  leave(room: Room, player: Player) {
    room.leave(player);
  }

  tick() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (room.players.size === 0) this.rooms.delete(code);
      else room.tick(now);
    }
  }

  get stats() {
    let players = 0;
    for (const r of this.rooms.values()) players += r.players.size;
    return `${players} online in ${this.rooms.size} rooms`;
  }
}
