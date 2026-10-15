# Changelog

What each released version brought. Planned work is in `docs/ROADMAP.md`, the game as it is in `docs/DESIGN.md`.

## 0.3.0 — 2026-10-15 "Morok"

Distrust: of what you see yourself, and of your teammates.

- **Morok.** From floor 3, with two players or more, a clean cycle may show one player an anomaly that isn't there. Forward is still right; turning back is a samosbor, told afterwards with who saw the morok. Its tell: a seen morok shimmers like air over a stove, stronger when looked at straight, and makes no sound and no light; a heard one is dry, without the room's echo, and a wall makes it quieter but not duller. A morok only adds or changes, never takes away, and is never made of light. Only the witness's client knows; the memo hints at it, the end report counts «Поддались мороку».
- **Five anomalies in the group**, 58 in all, for two players or more: «Смотрит на тебя» (on one screen a teammate's head keeps turning to you), «Без лица» (a resident with no face or other gear, seen by everyone but them), «Лишний» (a resident from flat 49 follows the group and is counted in the countdown and the duty log), «Не смотри» (a figure up the corridor or an armchair moves while nobody looks), «Только вдвоём» (seen only while two people look at it at once).
- **Under the hood:** the catalogue says how many players an anomaly needs and whether it can be private or a morok; anomalies can turn teammates' heads or dress them differently for a cycle; who sees what is checked against the bake's grid of walls and furniture (`src/gaze.ts`); `yacheika.ghost()` puts a stand-in teammate in the cell for development.

## 0.2.0 — 2026-10-15 "Tambour"

Fixes from the first playtest, where nobody understood that you have to stop in the middle of the tambour.

- **The whole tambour counts as the exit.** Any point past the blast door is the choice, the dead end included. Once the whole group is out, the verdict waits 2.5 s (unless everyone already stands in the exit zone), so the last one in can still loop seamlessly; anyone elsewhere goes on through a fade.
- **The majority decides.** Those who left decide by majority, a tie is a samosbor; whoever is still in the cell when the countdown runs out is carried along with the caption «Гермодверь закрылась».
- **Hints to wait:** «Ожидайте остальных в тамбуре» in the countdown banner, which counts down the last seconds once everyone is out; a new line in the memo; yellow and black hatching on the floor of the exit zone, pixel-exact through the loop.
- **Your own body.** Looking down you see your chest with the ID card, your legs and your hands, in step with the footsteps; all three mirrors show your whole figure.
- **Real mirrors** over the washbasin and on the bedroom dresser, not only in the hallway.
- **Samosbor** of 10 s, the warning heard out in full; a new siren: a motor siren on the next block that winds up, wails and runs down, louder and fuller.
- **The cell:** floor and wallpaper textures tile without seams; wallpaper stops at the doorways, which are lined like the door frames; thresholds under every door and at the tambours; a second hand on the pendulum clock; drips, clock and meter keep their place in space when you turn your head; the living room, loggia and bedroom brought back into the brightness range.
- **Server:** one log line per verdict (floor, anomaly, private or not, the choice, right or wrong, how many were out), for balancing.

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
