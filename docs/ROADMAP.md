# Roadmap

What the game still needs before 1.0.0, by version. `docs/DESIGN.md` describes the game as it is, `CHANGELOG.md` what each released version brought. When a version ships, its section moves from here to the changelog, and the decisions it made go into the design document.

Versions are 0.x while the game is changing a lot. Each one ends with a group playtest, and its results may reshuffle the next.

## 0.4 "Fear"

Towards horror and real danger, keeping the core: the base cell is the same every time, any strange sound is an anomaly, the tambours stay symmetric, the server reveals nothing.

### Fear

- **Voice mimic.** The client keeps the last few seconds of each teammate's real voice (it already receives it over WebRTC) and, as an anomaly, plays a phrase of theirs from behind a neighbour's door, the pantry or an empty room. Stays on the client; private by nature; not rolled for a teammate who hasn't spoken recently.
- **Lingering is dangerous.** If the group stays in the cell longer than about 90 s, a distant siren starts, then thin floor-level fog creeps from the vents. A fixed rule tied to cycle time, not an anomaly. Splitting up to check every room gets a real cost.
- **Being alone is dangerous.** Anomalies that appear only to a player with nobody within a few metres: a breath behind them, a door closing behind them, a teammate's voice from the next room.
- **A scarier samosbor.** Silhouettes in the fog that are gone a moment later, teammates' voices distorted, heavy breathing in a gas mask. Maybe a longer "big samosbor" after two mistakes in a row.
- **Rare stings.** Relax "no sharp attacks" for a few deliberate sounds inside anomalies, measured for peak level like the rest.

### Threat

- **A chaser**, like the running man in Exit 8: a figure that walks towards the group while not looked at; if it reaches a player, samosbor. Public, from floor 5. Builds on the gaze checks of "Don't look" (`src/gaze.ts`).
- **Darkness and a dynamo flashlight ("жучок")**: whole wings dark, a flashlight you pump with a key. No live lights in the scene, so the beam is a cone in the shared baked-light shader, one per player.

## 0.5 "Lore Accuracy"

The cell, its words and its samosbor checked against the Samosbor canon (the Gigakhrushch setting the game is built on), so that someone who knows it recognises the world, and someone who doesn't gets a consistent one.

- **An audit first.** Everything the player reads or hears, listed and checked against the canon: the terms (гермодверь, гермоблок, ячейка, самосбор, ликвидаторы, домком, ДНД), the memo, the notices and their variants in "Different notice", the radio announcements, the ID card, the lobby sheet, the duty log, the end report, the anomaly names on the verdict screen. What doesn't fit is reworded; what is our own invention and doesn't contradict the canon may stay, written down as such.
- **The samosbor as the canon describes it**: what the warning says and how, what the fog looks and sounds like, what the residents are told to do, what is left after it. Still timed by `SAMOSBOR` and still on top of the cell where the mistake happened; nothing of it stays into the next cycle, so the base cell stays the same.
- **The world around the cell**: what the yard, the facade and the windows of other blocks should be in the Gigakhrushch (an endless building rather than a yard between separate blocks?), and what that means for the window anomalies. Changes to the yard are re-measured for brightness and keep the loop pixel-exact.
- **Things in the flat and on the landing**: posters, notices, signs, labels and stencils in the right voice (the domkom, the party, civil defence), deterministic and drawn on canvas like the rest. New details obey "wear doesn't look like an anomaly".
- **Residents**: protective gear, armband and card checked against what residents wear and carry in the canon; the lobby choices follow.
- **Duty log entries between games**: reports from other floors, who didn't come back, written in the same checked voice.
- A short note in `docs/DESIGN.md` on which sources the setting follows and where the game deliberately departs from them.

## 0.6 "Interface"

Every screen and control reworked as one interface, and the game in English, and any other language by adding one file.

### Interface

The lobby notice board, the duty log (Esc), the HUD, banners and captions, the end report and the final screen.

- Buttons, menus and settings in one style, with the paper-and-typewriter look of the lobby carried through; clear states (hover, pressed, disabled).
- Settings sorted into sections (graphics, sound, controls), each explained in a line.
- Transitions between screens instead of hard cuts.
- Readable everywhere: font sizes, contrast, nothing covering the view at the wrong moment.

### Translation

Done together with the interface, so every reworked screen takes its text from the locale from the start.

- All text in JSON locale files (`ru.json`, `en.json`): the interface, captions, banners, anomaly names on the verdict screen, and the text in the world (the memo, the floor stencil, notices, cards), which canvas textures draw from the locale.
- The language picked in the lobby (the browser's language by default) and remembered; each player sees their own, the server sends ids, not text.
- Spoken lines (the samosbor warning, the radio) in the locale's language, with the speech-synthesis voice for it.
- Adding a language: copy a file, translate the strings, nothing else; a check that every file has every key.

## 0.7 "Residents"

Characters that look, move and handle better.

- **Looks:** more shaped bodies, faces and gear than the current boxes, still one skinned mesh and one draw call per resident, lit by the bake through a probe.
- **Animation:** a proper walk and run cycle, turning on the spot, idle shifting, the head and eyes following where a player looks, hands that do something (the marker, the door).
- **Handling:** acceleration and stopping instead of instant speed, a calmer camera bob, smoother movement of other players between position updates.

## 0.8 "More anomalies"

A bigger catalogue, so that a group that has played a few rounds still meets anomalies it hasn't seen.

- **Fill the gaps.** Count the anomalies by room and by tier and add where there are few: the hallway passage, the toilet, the loggia and the landing have the fewest; tier 3 needs the most, since it is what a group that knows the cell plays for.
- **Kinds the catalogue lacks**: changes of geometry that the loop allows (a neighbour's door number swapped, one more door in the corridor, a radiator section missing), changes in time (the pendulum clock showing the wrong hour, the calendar a day off, the meter's reading), small changes of texture (the wallpaper pattern, the stencil's font, the notice's signature), sounds in rooms that have none.
- **Every new one decides** whether it can be a morok (`morok: 'sight' | 'sound'`, never for what takes away or is made of light), how many players it needs and whether it can be private; it gets its seed-driven variants, a sound measured like the rest, and nothing asymmetric near the tambours.
- **Draw calls first.** The cell already takes 298 of the 300 alone; new props that move need `keep()` and a call each, so the cell is trimmed before the catalogue grows.
- **Tiers from the verdict log**: anomalies nobody misses move down a tier, those nobody notices move up or are made clearer.

## 0.9 "Mobile"

Playing on a phone or a tablet.

- Touch controls: a virtual stick to walk, dragging to look, buttons for the marker, chat and the duty log.
- Every screen laid out for small screens and both orientations.
- A quality preset for weak devices; the bake has to fit its budget on a phone's CPU.
- Voice chat and sound in mobile browsers (their autoplay and microphone rules).

## 1.0.0

The game holds up for people who have never heard of it.

- **First-time explanation.** The rules without someone to tell them: what an anomaly is, where to go, to wait in the tambour. In-world (the memo, the radio, the first clean cycle), not a tutorial screen.
- **A log of found anomalies** between games: which ones the player has seen, which are still unknown.
- **Balance from the verdict log:** anomaly tiers, the chances of anomalies, private anomalies and moroks, the number of passes (10 now; 8 if rounds feel long).
- **Stability:** reconnecting mid-cycle, a player leaving during the countdown or a samosbor, a full room, a lost WebGL context — all tried in a group playtest.

## After 1.0

- Several cell variants with different anomaly sets; entering a neighbour's flat.
