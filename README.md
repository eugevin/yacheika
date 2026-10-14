# Yacheika

A cooperative browser game for 1–6 players. A group of residents walks the same cell of an endless prefab block, floor after floor: a stair landing, the floor corridor, a three-room flat, a loggia.

- Spotted an anomaly? Turn back.
- Didn't? Keep going.
- Ten correct passes in a row end the round. A mistake sets off a samosbor and resets the count.

The whole group has to leave through the same exit. Some anomalies are seen by only one player, who has to convince the others. Voice chat is positional.

The game is in Russian. Design: [docs/DESIGN.md](docs/DESIGN.md).

## Running

```
npm install
npm run server   # game server on :8788
npm run dev      # client; open the address Vite prints
```

To invite players, copy the link from the Esc menu: it contains the room code.

**LAN with voice:** run `npm run dev:lan` instead of `npm run dev` and share the `https://<ip>:5173` address from the "Network" line. The certificate is self-signed, so the browser warns once. Browsers grant the microphone only over HTTPS or on `localhost`.

**Production:** `npm run build && npm run server` serves the page and the WebSocket from one process (port via `PORT`). Voice needs HTTPS: put the server behind an HTTPS proxy or a tunnel.

**VPS:** `docker compose up -d --build` runs the game behind Caddy (HTTPS via Let's Encrypt) with a TURN server for voice. See [docs/DEPLOY.md](docs/DEPLOY.md).

## Controls

| Key | Action |
|---|---|
| WASD, mouse | walk and look; Shift to run |
| LMB / E | place a marker, visible to everyone through walls |
| Enter | chat |
| M | microphone on/off |
| N | sound on/off |
| G | graphics quality |
| F3 | frame rate, draw calls, bake time |
| Esc | menu: players, invite link, start, settings (mouse sensitivity, sound and voice volume) |

## License

MIT, see [LICENSE](LICENSE).
