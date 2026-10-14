# Roadmap

What the game still needs before 1.0.0, by version. `docs/DESIGN.md` describes the game as it is, `CHANGELOG.md` what each released version brought. When a version ships, its section moves from here to the changelog, and the decisions it made go into the design document.

Versions are 0.x while the game is changing a lot. Each one ends with a group playtest, and its results may reshuffle the next.

## 0.3 "Morok"

### Left from 0.2

- Revisit `COUNTDOWN_MS` (20 s) after the 0.2 playtest: stragglers no longer break a pass, so it may be too long.

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

## 0.6 "Interface"

Every screen and control reworked as one interface: the lobby notice board, the duty log (Esc), the HUD, banners and captions, the end report and the final screen.

- Buttons, menus and settings in one style, with the paper-and-typewriter look of the lobby carried through; clear states (hover, pressed, disabled).
- Settings sorted into sections (graphics, sound, controls), each explained in a line.
- Transitions between screens instead of hard cuts.
- Readable everywhere: font sizes, contrast, nothing covering the view at the wrong moment.

## 0.7 "Residents"

Characters that look, move and handle better.

- **Looks:** more shaped bodies, faces and gear than the current boxes, still one skinned mesh and one draw call per resident, lit by the bake through a probe.
- **Animation:** a proper walk and run cycle, turning on the spot, idle shifting, the head and eyes following where a player looks, hands that do something (the marker, the door).
- **Handling:** acceleration and stopping instead of instant speed, a calmer camera bob, smoother movement of other players between position updates.

## 0.8 "Translation"

The game in English, and any other language by adding one file.

- All text in JSON locale files (`ru.json`, `en.json`): the interface, captions, banners, anomaly names on the verdict screen, and the text in the world (the memo, the floor stencil, notices, cards), which canvas textures draw from the locale.
- The language picked in the lobby (the browser's language by default) and remembered; each player sees their own, the server sends ids, not text.
- Spoken lines (the samosbor warning, the radio) in the locale's language, with the speech-synthesis voice for it.
- Adding a language: copy a file, translate the strings, nothing else; a check that every file has every key.

## 0.9 "Mobile"

Playing on a phone or a tablet.

- Touch controls: a virtual stick to walk, dragging to look, buttons for the marker, chat and the duty log.
- Every screen laid out for small screens and both orientations.
- A quality preset for weak devices; the bake has to fit its budget on a phone's CPU.
- Voice chat and sound in mobile browsers (their autoplay and microphone rules).

## 1.0.0

The game holds up for people who have never heard of it.

- **First-time explanation.** The rules without someone to tell them: what an anomaly is, where to go, to wait in the tambour. In-world (the memo, the radio, the first clean cycle), not a tutorial screen.
- **Lore.** Duty log entries between games: reports from other floors, who didn't come back.
- **A log of found anomalies** between games: which ones the player has seen, which are still unknown.
- **Balance from the verdict log:** anomaly tiers, the chances of anomalies, private anomalies and moroks, the number of passes (10 now; 8 if rounds feel long).
- **Stability:** reconnecting mid-cycle, a player leaving during the countdown or a samosbor, a full room, a lost WebGL context — all tried in a group playtest.

## After 1.0

- Several cell variants with different anomaly sets; entering a neighbour's flat.
