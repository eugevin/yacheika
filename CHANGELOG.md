# Changelog

What each released version brought. Planned work is in `docs/ROADMAP.md`, the game as it is in `docs/DESIGN.md`.

## 0.1.0 — 2026-10-14

The first public build, the one played in the first group playtest at https://yacheika.eugevin.dev.

- **The game.** Co-op for 1–6 players in the browser: walk the same cell of the Gigakhrushch floor after floor, turn back on an anomaly, go forward otherwise; 10 correct passes in a row. The whole group has to leave through one exit; the floor number on the landing stencil is the only sign of progress.
- **The cell.** A stair landing, the floor corridor with neighbours' doors, a three-room Soviet flat (hallway, kitchen, bathroom and toilet, living room, bedroom) and a loggia, joined by Z-shaped tambours that loop seamlessly.
- **53 anomalies** across every room, the light, the yard and the players themselves, in three difficulty tiers. Some are private: only one player sees them and has to convince the rest. The hallway mirror is a real reflection.
- **Samosbor** on a mistake: siren, red emergency light, fog from the vents, then floor 0. **Victory**: the tambours open onto stairs down to the exit and a final screen with the time and the number of samosbors.
- **Residents**: clothing, protective gear, a volunteer patrol armband and an ID card with a flat number, picked in a notice-board lobby.
- **Graphics**: baked light with lamp channels, procedural textures and furniture, per-room reflections, a night yard with street lamps, wear, "Soviet film" post-processing; two quality modes.
- **Sound**: synthesized ambience of the cell (riser, lamps, fridge, radio, clock, meter, lift), per-room reverb, footsteps by surface; positional voice chat over WebRTC with a TURN server.
- **Server**: rooms by code, validation of every message, rate limits, limits on sockets, connections per address and rooms; deployment with Docker, Caddy and coturn.
