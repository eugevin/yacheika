import type * as THREE from 'three';
import type { RtcSignal } from '../shared/protocol.ts';

interface Peer {
  pc: RTCPeerConnection;
  panner?: PannerNode;
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

  constructor(ctx: AudioContext, signal: (to: number, data: RtcSignal) => void) {
    this.ctx = ctx;
    this.signal = signal;
    this.out = ctx.createGain();
    this.out.connect(ctx.destination);
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

  /** How loudly each peer is talking right now, 0..1. Noise-suppressed silence reads as 0. */
  levels() {
    const out = new Map<number, number>();
    const buf = new Float32Array(512);
    for (const [id, peer] of this.peers) {
      if (!peer.meter) continue;
      peer.meter.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      out.set(id, Math.min(1, Math.max(0, (Math.sqrt(sum / buf.length) - 0.01) * 12)));
    }
    return out;
  }

  private peer(id: number, initiator: boolean): Peer {
    this.remove(id);
    const pc = new RTCPeerConnection({ iceServers: this.ice });
    const peer: Peer = { pc, pending: [] };
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
      source.connect(panner).connect(this.out);
      const meter = this.ctx.createAnalyser();
      meter.fftSize = 512;
      source.connect(meter);
      peer.panner = panner;
      peer.meter = meter;
    };
    return peer;
  }
}
