# Deploying to a VPS

The game runs in three containers (`docker-compose.yml`):

- **app** — the Node game server. Serves the built client and the WebSocket.
- **caddy** — HTTPS. Obtains a Let's Encrypt certificate for the domain and renews it on its own.
- **coturn** — a TURN server for voice. It's needed when two players behind strict NAT (mobile internet, many office networks) can't connect directly. The game server hands out temporary credentials for it using the shared secret `TURN_SECRET`.

You need a VPS with Ubuntu and a public IPv4 address, a domain or subdomain, and 10–15 minutes.

## 1. DNS

Wherever your domain's DNS is managed, add a record:

```
game    A    <your VPS IP>
```

The main site and other subdomains are unaffected.

- **If DNS is on Cloudflare**, turn off the proxy for this record (grey cloud, "DNS only"). Neither certificate issuance nor TURN works through the Cloudflare proxy.
- **If the domain has CAA records**, `letsencrypt.org` must be among them. If there are no CAA records at all, you're fine.

Check (from any machine):

```
dig +short game.example.com    # must return the VPS IP
```

You can do the next steps right away, but step 6 only once `dig` already shows the right IP. Otherwise Let's Encrypt refuses, and keeps refusing for a while.

## 2. Docker on the VPS

```
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER    # then log in again so docker works without sudo
```

## 3. Ports

| Port | Purpose |
|---|---|
| 22/tcp | SSH |
| 80/tcp | Let's Encrypt domain validation and redirect to HTTPS |
| 443/tcp, 443/udp | the game (HTTPS and HTTP/3) |
| 3478/tcp, 3478/udp | TURN |
| 49160–49200/udp | ports TURN relays voice through |

```
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443
sudo ufw allow 3478
sudo ufw allow 49160:49200/udp
sudo ufw enable
```

If your hosting provider has its own firewall in the control panel, open the same ports there too.

## 4. Code on the VPS

Copy the code from the project folder:

```
rsync -av --delete --exclude node_modules --exclude dist --exclude .env ./ user@<IP>:~/yacheika/
```

`.git` is copied along with the code, so the server shows which commit is deployed (`git log -1`).

## 5. Configuration

On the VPS:

```
cd ~/yacheika
cp .env.example .env
openssl rand -hex 32    # this will be TURN_SECRET
nano .env
```

```
DOMAIN=game.example.com
PUBLIC_IP=203.0.113.10
TURN_SECRET=<string from openssl>
```

`.env` is not in git, and the `rsync` above leaves it alone.

## 6. Launch

```
docker compose up -d --build
docker compose logs -f caddy    # wait for "certificate obtained successfully", then Ctrl+C
```

Open `https://game.example.com`. Players get the room link from the Esc menu.

All containers restart on their own, both after a crash and after a VPS reboot (`restart: unless-stopped`).

## 7. Testing voice over TURN

Only some players need TURN, so a breakage is easy to miss without testing:

1. Open https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/.
2. Get temporary credentials. In the browser console on the game page, **before** joining a room:
   ```js
   const ws = new WebSocket(`wss://${location.host}/ws`);
   ws.onopen = () => ws.send(JSON.stringify({ t: 'join', name: 'test', code: 'TURNTEST', mask: 'none', outfit: 'robe' }));
   ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === 'hello') { console.log(m.ice); ws.close(); } };
   ```
3. Enter `turn:<IP>:3478` with that `username` and `credential` on the trickle ICE page and press "Gather candidates". If there's a candidate of type **relay**, TURN works.

You can also test it live: one player joins from a phone on mobile internet, another from a computer. Voice should be audible.

## Updating

Run the `rsync` from step 4 again on your machine, then on the VPS:

```
cd ~/yacheika && docker compose up -d --build
```

Rooms live in server memory, so an update ends all games in progress. Update when nobody is playing.

## Troubleshooting

- **Logs:** `docker compose logs -f app` — players joining and leaving; `caddy` — the certificate; `coturn` — TURN.
- **No certificate.** Check `dig` from step 1, that port 80 is open, and that the Cloudflare proxy is off. After fixing: `docker compose restart caddy`.
- **Voice fails only for some pairs.** Test TURN per step 7. If the VPS IP is behind the provider's NAT (the interface has an address like `10.x` or `172.x`, see `ip addr`), change coturn's `--external-ip=${PUBLIC_IP}` in `docker-compose.yml` to `--external-ip=${PUBLIC_IP}/<internal IP>`.
- **Nobody has voice.** The browser grants the microphone only over HTTPS: make sure you're on `https://`.
- **Load.** The server is light; 1 GB of memory is enough. Voice over TURN is about 30 kbit/s for each pair that needs it.
