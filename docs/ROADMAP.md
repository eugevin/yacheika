# Roadmap

What the game still needs before 1.0.0, by version. `docs/DESIGN.md` describes the game as it is, `CHANGELOG.md` what each released version brought. When a version ships, its section moves from here to the changelog, and the decisions it made go into the design document.

Versions are 0.x while the game is changing a lot. Each one ends with a group playtest, and its results may reshuffle the next.

## 0.2 "Tambour"

Fixes from the first playtest (5 players, about 30 minutes). The group had fun, and the Double turning its head after a player was the best moment. But **nobody understood that you have to stop in the middle of the Z-shaped tambour**: everyone walked on to the dead end, and the pass was lost.

### The whole tambour counts as the exit

An exit counts only in `ZONE`, the middle leg of the Z. A player who walks on past the corner is "on the way" again for the server; the countdown runs out and the group counts as split.

- Any point past the blast door counts as the choice: the first leg, the middle, the dead end. `ZONE` stays only for the seamless transfer: whoever stands in it at the verdict moves on unnoticed, the rest go through a fade.
- Once the whole group is in the tambours, wait 2–3 s before the verdict, so someone who has just crossed the threshold can reach the zone and loop seamlessly.
- Hints: the countdown banner on entering a tambour («Ожидайте остальных в тамбуре»), a line in «ПАМЯТКА ЖИЛЬЦУ» («Дождаться всех жильцов в тамбуре»), a yellow-black hatched marking on the floor of the middle leg, symmetric under the 180° turn about `MID_CENTER` (verify with the pixel-exact loop test).

### The majority decides, stragglers are carried along

- When the countdown runs out with someone still in the cell, they don't break the pass: those who left decide, and the stragglers are carried into the next cycle through a fade with the caption «Гермодверь закрылась».
- If players left through different exits, the majority decides; a tie is a samosbor. Stragglers in the cell are carried along either way.
- Revisit `COUNTDOWN_MS` (20 s) afterwards.

### Your own body

- **Full first-person body.** Looking down shows your legs, arms and torso: the same `Character` other players see, in your outfit and protective gear, walking in step with the footsteps. The camera sits in the head, so the head and the mask stay hidden from your own view (but not from the mirror).
- **Your reflection in the hallway mirror.** The mirror shows you, not only the others; "Extra in the mirror" then stands next to a familiar figure. It costs one draw call more on high quality.

### A longer samosbor

`SAMOSBOR_MS` is 6 s: the spoken warning doesn't finish before the screen goes dark. Make it 15 s, the fog, puffs, flicker and veil spread over that time, and a better siren: fuller, more like a real civil-defence siren.

### Verdict log

One server log line per verdict: floor, anomaly, private or not, correct or not, number of players. Shows which anomalies nobody notices and which are too obvious.

### Cell fixes

- **Floor seams.** Visible joins in the floor covering in several places: so far noticed in the corridor, the hallway and the bedroom.
- **Wallpaper seams** in the hallway and the corridor.
- **Wallpaper over doorways.** Wallpaper must not run onto the doorway reveals or onto the doors themselves.
- **Thresholds.** Under a doorway the floor of one room meets the other's in a bare line: a threshold strip covers the joint.
- **Real mirrors.** The small mirror over the washbasin and the bedroom dresser's mirror reflect like the hall one.
- **Brightness back in range.** Measured from each room's centre in four directions (docs/DESIGN.md, 4.9), the same as in 0.1.0: the living room (0.19) and the loggia (0.22) are darker than 0.25, and the bedroom sconce overexposes 4% of the frame looking at the north wall.
- **Clock hand.** The clock is missing a hand.
- **Drip and clock sound position.** When the player turns their head quickly, the sound's position seems to update only when the next tick or drop plays; it has to follow the listener continuously, like the other sources.

## 0.3 "Morok"

### Morok

In a clean cycle one player is shown a false anomaly. The right answer is forward; turning back because of it is a samosbor with the caption «Отклонений не было. Петров видел морок».

- One learnable, subtle tell for every morok: a visual morok faintly "breathes" — its edges shimmer, a slight heat haze when looked at directly; a sound morok is silent or plays without the room's reverb. A hint in the memo: «Не всё, что видишь, — отклонение».
- From floor 3–4, two or more players, a chance like private anomalies. Built from the existing anomalies plus the tell.
- The player who sees it gets a flag in `cycle` (their client has to draw the tell); other players never get it. The invariant about not revealing anomalies needs that addendum.

### Anomalies involving players

- **"Looks at you"** — on your screen a teammate's avatar always turns its head towards you, whatever they actually look at. Private.
- **"Don't look"** — an object moves while nobody looks at it: a chair, a door, a figure at the end of the corridor. Per player, from the camera frame.
- **"Faceless"** — a teammate with a blank face or the wrong mask.
- **"Extra"** — one more resident wanders with the group; the banner's "on the way" counter shows one too many.
- **"Only together"** — an anomaly visible only while two players look at it at once; teammates' gaze already arrives with their positions.

## 0.4 "Fear"

Towards horror, keeping the core: the base cell is the same every time, any strange sound is an anomaly, the tambours stay symmetric, the server reveals nothing.

- **Voice mimic.** The client keeps the last few seconds of each teammate's real voice (it already receives it over WebRTC) and, as an anomaly, plays a phrase of theirs from behind a neighbour's door, the pantry or an empty room. Stays on the client; private by nature; not rolled for a teammate who hasn't spoken recently.
- **Lingering is dangerous.** If the group stays in the cell longer than about 90 s, a distant siren starts, then thin floor-level fog creeps from the vents. A fixed rule tied to cycle time, not an anomaly. Splitting up to check every room gets a real cost.
- **Being alone is dangerous.** Anomalies that appear only to a player with nobody within a few metres: a breath behind them, a door closing behind them, a teammate's voice from the next room.
- **A scarier samosbor.** Silhouettes in the fog that are gone a moment later, teammates' voices distorted, heavy breathing in a gas mask. Maybe a longer "big samosbor" after two mistakes in a row.
- **Rare stings.** Relax "no sharp attacks" for a few deliberate sounds inside anomalies, measured for peak level like the rest.

## 0.5 "Threat"

Real danger.

- **A chaser**, like the running man in Exit 8: a figure that walks towards the group while not looked at; if it reaches a player, samosbor. Public, from floor 5.
- **Darkness and a dynamo flashlight ("жучок")**: whole wings dark, a flashlight you pump with a key. No live lights in the scene, so the beam is a cone in the shared baked-light shader, one per player.

## 1.0.0

The game holds up for people who have never heard of it.

- **First-time explanation.** The rules without someone to tell them: what an anomaly is, where to go, to wait in the tambour. In-world (the memo, the radio, the first clean cycle), not a tutorial screen.
- **Lore.** Duty log entries between games: reports from other floors, who didn't come back.
- **A log of found anomalies** between games: which ones the player has seen, which are still unknown.
- **Balance from the verdict log:** anomaly tiers, the chances of anomalies, private anomalies and moroks, the number of passes (10 now; 8 if rounds feel long).
- **Stability:** reconnecting mid-cycle, a player leaving during the countdown or a samosbor, a full room, a lost WebGL context — all tried in a group playtest.

## After 1.0

- Several cell variants with different anomaly sets; entering a neighbour's flat.
