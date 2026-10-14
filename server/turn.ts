import { createHmac } from 'node:crypto';

/** Public address of our coturn (TURN_HOST) and the secret it shares with us (TURN_SECRET). */
const HOST = process.env.TURN_HOST;
const SECRET = process.env.TURN_SECRET;
/** A credential outlives any session; reconnecting fetches a fresh one with the next hello. */
const TTL_S = 24 * 60 * 60;

const PUBLIC_STUN: RTCIceServer = { urls: 'stun:stun.l.google.com:19302' };

/**
 * ICE servers for one player. Without TURN only STUN is offered, and two players both behind a
 * strict NAT won't hear each other. With it, credentials follow coturn's use-auth-secret scheme:
 * username is "expiry:label", password is base64 HMAC-SHA1 of it, so they can't be reused forever
 * and coturn doesn't need a user list.
 */
export function iceServers(label: string): RTCIceServer[] {
  if (!HOST || !SECRET) return [PUBLIC_STUN];
  const username = `${Math.floor(Date.now() / 1000) + TTL_S}:${label}`;
  const credential = createHmac('sha1', SECRET).update(username).digest('base64');
  return [
    { urls: `stun:${HOST}:3478` },
    { urls: [`turn:${HOST}:3478?transport=udp`, `turn:${HOST}:3478?transport=tcp`], username, credential },
  ];
}
