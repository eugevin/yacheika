# Roadmap

What the game still needs before 1.0.0, by version. `docs/DESIGN.md` describes the game as it is, `CHANGELOG.md` what each released version brought. When a version ships, its section moves from here to the changelog, and the decisions it made go into the design document.

Versions are 0.x while the game is changing a lot. Each one ends with a group playtest, and its results may reshuffle the next.

## 0.3 "Morok"

The theme is distrust: of what you see yourself (a morok) and of your teammates (anomalies that live in the players). Private anomalies made one player convince the rest; a morok makes the rest ask whether that player should be believed. The base cell, the loop, the bake and the sound stay as they are; everything here is either a rule on the server or something an anomaly adds on top of a built cell.

Order of work: the shared groundwork first, then the morok, then the five anomalies, then the documents, measurements and the playtest. Each step leaves the game playable.

### Groundwork

Things the morok and the new anomalies share. Nothing here changes how the game plays.

- **Catalogue fields** in `AnomalyInfo` (`shared/anomalies.ts`):
  - `players?: number` — the fewest players the anomaly makes sense with (2 for the ones that need a teammate). `Room.roll()` filters the pool by the room's size.
  - `only?: 'always' | 'never'` — forced private (an anomaly that by nature happens on one screen) or never private (one that needs two people). Default: private by `privateChance`, as now.
  - `morok?: 'sight' | 'sound'` — whether the anomaly can be a morok and which tell it gets (see below). Absent: never a morok.
- **People with ids.** `People` in `src/anomalies.ts` carries each teammate's player id with their look, so an anomaly can pick a teammate and the avatar code can find them.
- **Avatar overrides per cycle.** Avatars live across cycles while the world is rebuilt, so an anomaly can't touch them directly without breaking "no need to roll back". Instead `World` gets `avatars: { gaze?: number[]; look?: Map<number, Look | 'blank'>; extra?: Look }`, filled by the anomaly; `Avatars` reads it on `enterCycle` and every frame, and drops it with the old world. An overridden look builds a second `Character` for the cycle and hides the real one (still one draw call per resident).
- **Gaze** (`src/gaze.ts`): whether an eye at (position, yaw, pitch) sees a point — inside a cone of about ±35° horizontally and ±25° vertically, and a ray to it not blocked by the cell (the `far` layer, the raycaster the markers already use). For us it's the camera; for a teammate, their avatar's head with the yaw and pitch from `pos` (10 Hz, smoothed). Checked a few times a second, not every frame.
- **A fake teammate for development.** `yacheika.ghost(x, z, yaw, pitch)` adds a local avatar that stands and looks where told (`yacheika.ghost()` removes it), so the player anomalies can be built and screenshotted alone, without a second browser.
- **Server checks** (Node scripts, as now): the pool respects `players` and `only`; a cycle message to a non-witness is byte-for-byte the same as for a clean cycle.

### Morok

In a clean cycle one player is shown an anomaly that isn't there. The right answer is still forward. Turning back because of it is a mistake like any other: a samosbor, and afterwards «Самосбор окончен. Отклонений не было, морок видел(а) Петров. Этаж 0.»

**Rules**

- Rolled only in a cycle that came up clean, with two or more players, from floor 3. Chance `morokChance(cycle, players)` in `shared/rules.ts`: `0.1 × (floor − 2)`, at most 35%. So from floor 5 roughly one cycle in seven is a morok, against one in three or so with a private anomaly: rare enough that a lone witness is usually right, common enough that the group learns it exists.
- The witness is picked like for a private anomaly. The anomaly comes from the pool of those with a `morok` field, within the floor's tier and not among the recent ones; it goes into `recent` like a real one.
- A cycle has at most one of: an anomaly, a morok. Never both, so a morok is never "the wrong one of two".

**Protocol and server**

- `cycle.anomalies` entries get `morok?: true`. Only the witness gets the entry at all; for everyone else the message is the same as for a clean cycle. The witness has to get the flag, since their client draws the tell.
- `Room` keeps the morok next to the anomaly (`morok: { id, seed, only } | null`); `resolve()` treats the cycle as clean; it is cleared with the anomaly.
- `result` gets `morok: { name, seenBy } | null`, sent only after the choice, like the anomaly. On a right pass it isn't shown anywhere: nothing marks a right pass.
- The verdict log line names it: `clean (morok tv_on, private), back, wrong, 3/3 out`.
- The invariant in `AGENTS.md` gets the addendum: the morok flag goes only to the witness, and nothing else may tell a morok cycle from a clean one.

**The tell**

One rule per kind, the same for every morok of that kind, learnable once seen and never shown by a real anomaly:

- **Sight.** The morok's objects "breathe": a heat haze over them, the surface and its picture swimming by a few millimetres, the edges flickering faintly against what's behind. Barely there out of the corner of the eye, plain when looked at straight from up close (the effect grows towards the centre of the screen). And it doesn't touch the world: a morok makes no sound and casts no light (no hiss from a morok burner, no flicker of a morok TV on the walls, no light in a morok fridge).
- **Sound.** The morok sound plays dry: no reverb of the room and no muffling through walls, as if heard inside the head. Easy to tell in the corridor, the landing and the bathroom, harder in the dry living room; that's fine, it's a tier on top of the tier.

How:

- Each anomaly function in `APPLY` returns what it changed (`Object3D[]`), and gets a `morok` flag. With the flag, a sight morok skips its emitters, lamp tints and ambience changes; a sound morok marks its emitters `dry`.
- The haze is a patch on the materials of the returned objects (cloned per object, so shared matte materials are untouched and the draw calls stay the same): a vertex wobble and a UV ripple in time, scaled by a uniform the client sets from how close to the screen centre the object is. It goes into the shader through the same `onBeforeCompile` chain as `useBaked()`, works for skinned meshes (the double) and on both qualities, since it's in the material, not in post-processing.
- `dry` on an `Emitter`: the reverb send is zero and the source skips `MUFFLE`. The ranges stay, so a dry sound still never reaches the tambour zones.

**Which anomalies can be a morok**

- Sight: floor stencil (both), neighbour's door, notice, mailbox, slippers, receiver, meter, chain, extra in the mirror, pantry, burner, fridge, calendar, plate, tap, bathtub, curtain, writing on the mirror, both rugs, TV, chandelier, armchair, portrait, wardrobe, eyes under the bed, bed, cot, jars, someone in the window, wall instead of the yard, double, and the new "Faceless" and "Don't look".
- Sound: garbage chute, phone, kettle, both radio ones, cistern, footsteps behind, radiator, drill, crying.
- Never: anything that takes away (crystal gone, clock stopped, silence, all windows dark) and anything made of light (light off, flickering lamp, wrong light, broken bulb, fog on the horizon), plus "Looks at you", "Extra" and "Only together". A morok can only add or change, never remove: that is itself something players can learn.

**Teaching it**

- The memo gets a line: «Не всё, что видишь, — отклонение. Морок дрожит, как воздух над плитой.»
- The caption after the samosbor names the morok, so the group knows what they fell for and can look for the haze next time.
- The end report («АКТ об окончании обхода») gets «Поддались мороку: N».

**Checks**

- Server script: in a morok cycle, the `cycle` message to every non-witness equals the clean one; `result` carries the morok only after the verdict; going back is wrong, forward is right.
- `yacheika.preview('tv_on', 3, seed, { morok: true })`; screenshots of every sight morok from 1.5 m looking straight at it and from the side at 30°: the haze has to show in the first and barely in the second.
- Sound: every sound morok measured in its room and through a wall: no reverb tail, the same level through the wall as in the open, the tambour zones still silent.
- Draw calls unchanged with a morok.

### Anomalies involving players

Five new anomalies, 58 in all. All five need a teammate, so they're rolled only with two or more players (`players: 2`).

**"Смотрит на тебя"** (looks at you), tier 2, always private.
On the witness's screen one teammate's avatar keeps turning its head to them, wherever that teammate actually looks; a little further than a neck should go (up to ±2 rad, the double's limit is ±1.3). The teammate says they're looking elsewhere, and both are right. `world.avatars.gaze = [id]`; `Avatars.update` aims that head at the camera instead of using `pitch` and the body's yaw. The teammate is chosen among those who entered the cell, so they're likely to be seen.

**"Не смотри"** (don't look), tier 3.
Something moves while nobody looks at it: a kitchen stool slides away from the table, the armchair turns a little, a figure at the far end of the corridor stands a step closer each time. It moves in steps, a sequence from the seed, one step after it's been out of everyone's sight for 2 s; "everyone" is the camera plus every teammate's gaze (`src/gaze.ts`). Each client moves it by its own view of the group, so two clients may be a step apart for a moment; the steps are coarse enough that this doesn't matter. Nothing that blocks walking moves: interior doors keep their place, since their leaves are walking obstacles in `shared/map.ts`. The corridor figure stops a few metres from the landing and never comes near the exits.

**"Без лица"** (faceless), tier 2.
One teammate has a blank face: the face patch is painted flat skin with no features; under a gas mask, the mask has no glass. Or wears different gear from the one picked in the lobby. `world.avatars.look`, a cycle-long `Character` for them. The teammate doesn't see it on themselves, except in a mirror when the anomaly is public. Private by `privateChance`, as usual.

**"Лишний"** (extra), tier 2, private by `privateChance`, as usual.
One more resident walks with the group: a look from the seed (outfit, gear, a surname, flat 49 — the flat the group walks through, which nobody can have). It follows a few metres behind the nearest player, stands among the group when they stop, never speaks, never goes past a blast door: when the group leaves, it stays in the doorway. Its footsteps are heard like a player's. The countdown banner's «в пути» counts it (the server's number plus one, on the screens that see it), and the duty log (Esc) lists it among the residents. Client-only: `world.avatars.extra`, walking with `canStand` and the same gait as avatars.

**"Только вдвоём"** (only together), tier 3, never private.
Something visible only while two players look at it at once: «ВАС ДВОЕ» written on the corridor wall by the window, or a figure standing against the window at the end of the corridor. Each client fades it in when its own camera and at least one teammate's gaze (`src/gaze.ts`) both see the spot, and out after a second when not. Placed where a walking group looks together anyway: down the corridor, at the floor stencil.

### Documents and release

- `docs/DESIGN.md`: the morok in section 1 (rules) and its tells in a new subsection of 6; the five anomalies in the "Players and sounds" table; 58 anomalies.
- `AGENTS.md`: the morok addendum to the invariant about private anomalies; avatar overrides (`world.avatars`), `src/gaze.ts`, `yacheika.ghost` and the `morok` preview option; the `morok` and `players`/`only` catalogue fields in "How to add an anomaly".
- Measured before release: draw calls with six players and "Extra", the bake time, the loop pixel check (nothing new is in the tambours), sound in the tambour zones.
- Group playtest. Watch in the verdict log how often moroks fool groups and how often private anomalies are now disbelieved; tune `morokChance` from that, or move it to the 1.0 balance pass.

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
