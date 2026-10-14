import type { ClientMsg, ServerMsg } from '../shared/protocol.ts';

const RECONNECT_MS = 1500;

/**
 * WebSocket to the game server with auto-reconnect. Messages are handled as they arrive, not per
 * frame: a hidden tab gets no animation frames but must still answer voice-chat signalling.
 */
export class Net {
  status: 'connecting' | 'online' | 'offline' = 'connecting';
  private ws?: WebSocket;
  private closed = false;
  private readonly url: string;
  private readonly join: Extract<ClientMsg, { t: 'join' }>;
  private readonly onMessage: (msg: ServerMsg) => void;

  constructor(url: string, join: Extract<ClientMsg, { t: 'join' }>, onMessage: (msg: ServerMsg) => void) {
    this.url = url;
    this.join = join;
    this.onMessage = onMessage;
    this.connect();
  }

  send(msg: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close() {
    this.closed = true;
    this.ws?.close();
  }

  private connect() {
    const ws = (this.ws = new WebSocket(this.url));
    ws.onopen = () => {
      this.status = 'online';
      this.send(this.join);
    };
    ws.onmessage = (e) => this.onMessage(JSON.parse(e.data));
    ws.onclose = () => {
      this.status = 'offline';
      if (!this.closed) setTimeout(() => this.connect(), RECONNECT_MS);
    };
  }
}
