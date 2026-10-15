import type * as THREE from 'three';
import type { RtcSignal } from '../shared/protocol.ts';

/** How much of each teammate's voice is kept on this machine, seconds (the voice mimic). */
const KEEP_S = 8;
/** A phrase: speech between pauses at least this long, between these lengths, seconds. */
const PAUSE_S = 0.45;
const PHRASE_MIN = 0.6;
const PHRASE_MAX = 4.5;
/** Voice level (levels()) above which someone counts as talking. */
const TALKING = 0.08;
/** Phrases kept per teammate, the newest. */
const PHRASES = 4;

/**
 * The ring buffer: the last KEEP_S seconds of one voice, and on request the last n samples of it.
 * An AudioWorklet from a string: no file to serve.
 */
const RING = `
class Ring extends AudioWorkletProcessor {
  constructor(o) {
    super();
    this.buf = new Float32Array(o.processorOptions.length);
    this.at = 0;
    this.port.onmessage = (e) => {
      const n = Math.min(e.data, this.buf.length);
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = this.buf[(this.at - n + i + this.buf.length) % this.buf.length];
      this.port.postMessage(out, [out.buffer]);
    };
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) for (let i = 0; i < ch.length; i++) {
      this.buf[this.at] = ch[i];
      this.at = (this.at + 1) % this.buf.length;
    }
    return true;
  }
}
registerProcessor('yacheika-ring', Ring);
`;

interface Peer {
  pc: RTCPeerConnection;
  /** The last seconds of their voice (voice mimic), never sent anywhere. */
  ring?: AudioWorkletNode;
  /** Their phrases cut from it, newest last. */
  phrases: AudioBuffer[];
  /** When they started talking (context time), and when they last were, while a phrase goes on. */
  talk: { from: number; loud: number } | null;
  panner?: PannerNode;
  /** The voice as it is, and through a gas mask (muffle): one of the two is open. */
  dry?: GainNode;
  wet?: GainNode;
  /** The wavering of the muffled voice, stopped with the peer. */
  lfos?: OscillatorNode[];
  /** Taps the incoming voice so avatars can show who is talking. */
  meter?: AnalyserNode;
  /** ICE candidates that arrived before the remote description. */
  pending: RTCIceCandidateInit[];
}

/**
 * Proximity voice chat: a WebRTC mesh where each remote voice goes through a PannerNode placed at
 * that player's avatar. Signalling is relayed by the game server. The newcomer always makes the
 * offers, so two peers never offer to each other at once.
 */
export class Voice {
  /** Our microphone, or null if voice is off or permission was denied: we still hear others. */
  stream: MediaStream | null = null;
  muted = false;
  /** STUN/TURN servers handed out by the game server with each hello. */
  ice: RTCIceServer[] = [];
  private peers = new Map<number, Peer>();
  private readonly ctx: AudioContext;
  /** All incoming voices, for the volume slider in the duty log. */
  private readonly out: GainNode;
  private readonly signal: (to: number, data: RtcSignal) => void;
  /** Voices come through as if from behind a gas mask, while a samosbor lasts. */
  private muffled = false;
  /** The ring buffer's worklet, loaded once; null where AudioWorklet isn't available. */
  private ringReady: Promise<boolean> | null = null;
  /** Called once we hold a first phrase of a teammate: the server may then roll the voice mimic for us. */
  onHeard: ((id: number) => void) | null = null;

  constructor(ctx: AudioContext, signal: (to: number, data: RtcSignal) => void) {
    this.ctx = ctx;
    this.signal = signal;
    this.out = ctx.createGain();
    this.out.connect(ctx.destination);
  }

  /**
   * While a samosbor lasts, teammates' voices come band-limited and wavering, as through a gas mask
   * or a wall (docs/DESIGN.md, 7.1).
   */
  setMuffle(on: boolean) {
    if (on === this.muffled) return;
    this.muffled = on;
    for (const peer of this.peers.values()) this.muffle(peer);
  }

  private muffle(peer: Peer) {
    const t = this.ctx.currentTime;
    peer.dry?.gain.setTargetAtTime(this.muffled ? 0 : 1, t, 0.25);
    peer.wet?.gain.setTargetAtTime(this.muffled ? 1.6 : 0, t, 0.25);
  }

  setVolume(v: number) {
    this.out.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  async enableMic() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (e) {
      console.warn('microphone unavailable', e);
    }
    return this.stream !== null;
  }

  toggleMute() {
    this.muted = !this.muted;
    this.stream?.getAudioTracks().forEach((t) => (t.enabled = !this.muted));
  }

  /** We just joined: call everyone already in the room. */
  async call(id: number) {
    const peer = this.peer(id, true);
    await peer.pc.setLocalDescription(await peer.pc.createOffer());
    this.signal(id, { sdp: peer.pc.localDescription!.toJSON() });
  }

  async onSignal(from: number, data: RtcSignal) {
    if ('sdp' in data) {
      const peer = data.sdp.type === 'offer' ? this.peer(from, false) : this.peers.get(from);
      if (!peer) return;
      await peer.pc.setRemoteDescription(data.sdp);
      for (const c of peer.pending.splice(0)) await peer.pc.addIceCandidate(c);
      if (data.sdp.type === 'offer') {
        await peer.pc.setLocalDescription(await peer.pc.createAnswer());
        this.signal(from, { sdp: peer.pc.localDescription!.toJSON() });
      }
    } else {
      const peer = this.peers.get(from);
      if (!peer) return;
      if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(data.candidate);
      else peer.pending.push(data.candidate);
    }
  }

  remove(id: number) {
    const peer = this.peers.get(id);
    if (!peer) return;
    peer.pc.close();
    peer.panner?.disconnect();
    peer.meter?.disconnect();
    peer.ring?.disconnect();
    peer.ring?.port.close();
    for (const o of peer.lfos ?? []) o.stop();
    this.peers.delete(id);
  }

  clear() {
    for (const id of [...this.peers.keys()]) this.remove(id);
  }

  /** Moves each voice to its speaker's head. The listener is placed by Sound.update. */
  update(heads: Map<number, THREE.Vector3>) {
    for (const [id, peer] of this.peers) {
      const h = heads.get(id);
      if (!h || !peer.panner) continue;
      const t = this.ctx.currentTime;
      peer.panner.positionX.setTargetAtTime(h.x, t, 0.05);
      peer.panner.positionY.setTargetAtTime(h.y, t, 0.05);
      peer.panner.positionZ.setTargetAtTime(h.z, t, 0.05);
    }
  }

  /**
   * How loudly each peer is talking right now, 0..1. Noise-suppressed silence reads as 0. Called
   * every frame, it also cuts what they say into phrases (the voice mimic).
   */
  levels() {
    const out = new Map<number, number>();
    const buf = new Float32Array(512);
    const now = this.ctx.currentTime;
    for (const [id, peer] of this.peers) {
      if (!peer.meter) continue;
      peer.meter.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      const level = Math.min(1, Math.max(0, (Math.sqrt(sum / buf.length) - 0.01) * 12));
      out.set(id, level);
      if (level > TALKING) {
        peer.talk ??= { from: now, loud: now };
        peer.talk.loud = now;
      } else if (peer.talk && now - peer.talk.loud > PAUSE_S) {
        const len = peer.talk.loud - peer.talk.from;
        peer.talk = null;
        if (len >= PHRASE_MIN && len <= PHRASE_MAX) this.keep(id, peer, len + PAUSE_S + 0.25);
      }
    }
    return out;
  }

  /**
   * One of the phrases our teammates said, as heard on this machine, or null: the voice mimic plays
   * it back from where nobody stands. `r`: the anomaly's random.
   */
  phrase(r: () => number) {
    const all = [...this.peers].flatMap(([from, p]) => p.phrases.map((buffer) => ({ from, buffer })));
    return all.length ? all[Math.floor(r() * all.length)] : null;
  }

  /** Takes the last `secs` of a peer's voice out of its ring buffer as a phrase, levelled. */
  private keep(id: number, peer: Peer, secs: number) {
    const ring = peer.ring;
    if (!ring) return;
    ring.port.onmessage = (e: MessageEvent<Float32Array>) => {
      const data = e.data;
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v));
      if (peak < 1e-3 || !this.peers.has(id)) return;
      const b = this.ctx.createBuffer(1, data.length, this.ctx.sampleRate);
      const ch = b.getChannelData(0);
      for (let i = 0; i < data.length; i++) ch[i] = (data[i] / peak) * 0.6;
      const first = peer.phrases.length === 0;
      peer.phrases = [...peer.phrases, b].slice(-PHRASES);
      if (first) this.onHeard?.(id);
    };
    ring.port.postMessage(Math.floor(secs * this.ctx.sampleRate));
  }

  /** Loads the ring buffer's worklet, once. */
  private ringModule() {
    this.ringReady ??= this.ctx.audioWorklet
      ? this.ctx.audioWorklet
          .addModule(URL.createObjectURL(new Blob([RING], { type: 'application/javascript' })))
          .then(() => true)
          .catch(() => false)
      : Promise.resolve(false);
    return this.ringReady;
  }

  private peer(id: number, initiator: boolean): Peer {
    this.remove(id);
    const pc = new RTCPeerConnection({ iceServers: this.ice });
    const peer: Peer = { pc, pending: [], phrases: [], talk: null };
    this.peers.set(id, peer);
    if (this.stream) for (const t of this.stream.getTracks()) pc.addTrack(t, this.stream);
    // without a mic the offer still needs an audio section, or we'd never hear the other side
    else if (initiator) pc.addTransceiver('audio', { direction: 'recvonly' });
    pc.onicecandidate = (e) => {
      if (e.candidate) this.signal(id, { candidate: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      // Chrome won't pull a remote WebRTC stream through Web Audio unless a media element consumes it too
      const sink = new window.Audio();
      sink.muted = true;
      sink.srcObject = stream;
      const panner = new PannerNode(this.ctx, {
        panningModel: 'HRTF',
        distanceModel: 'inverse',
        refDistance: 1.5,
        maxDistance: 40,
        rolloffFactor: 1.3,
      });
      const source = this.ctx.createMediaStreamSource(stream);
      panner.connect(this.out);
      const ctx = this.ctx;
      const dry = new GainNode(ctx, { gain: 1 });
      const wet = new GainNode(ctx, { gain: 0 });
      source.connect(dry).connect(panner);
      // the mask: a narrow band whose top wanders, and a slow flutter in the level
      const low = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 380, Q: 0.7 });
      const top = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 1200, Q: 2.5 });
      const flutter = new GainNode(ctx, { gain: 0.8 });
      const wander = new OscillatorNode(ctx, { frequency: 0.6 });
      wander.connect(new GainNode(ctx, { gain: 320 })).connect(top.frequency);
      const shake = new OscillatorNode(ctx, { frequency: 3.3 });
      shake.connect(new GainNode(ctx, { gain: 0.2 })).connect(flutter.gain);
      wander.start();
      shake.start();
      source.connect(low).connect(top).connect(flutter).connect(wet).connect(panner);
      peer.dry = dry;
      peer.wet = wet;
      peer.lfos = [wander, shake];
      this.muffle(peer);
      const meter = this.ctx.createAnalyser();
      meter.fftSize = 512;
      source.connect(meter);
      peer.panner = panner;
      peer.meter = meter;
      // the last seconds of their voice, kept here and nowhere else
      void this.ringModule().then((ok) => {
        if (!ok || this.peers.get(id) !== peer) return;
        const ring = new AudioWorkletNode(this.ctx, 'yacheika-ring', { numberOfOutputs: 1, processorOptions: { length: Math.ceil(KEEP_S * this.ctx.sampleRate) } });
        // pulled through a silent gain, or the browser wouldn't run it
        source.connect(ring).connect(new GainNode(this.ctx, { gain: 0 })).connect(this.ctx.destination);
        peer.ring = ring;
      });
    };
    return peer;
  }
}
