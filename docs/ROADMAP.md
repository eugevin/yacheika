# Roadmap

What the game still needs before 1.0.0, by version. `docs/DESIGN.md` describes the game as it is, `CHANGELOG.md` what each released version brought. When a version ships, its section moves from here to the changelog, and the decisions it made go into the design document.

Versions are 0.x while the game is changing a lot. Each one ends with a group playtest, and its results may reshuffle the next.

## 0.4 "Fear"

Towards horror and real danger. 0.3 made players distrust what they see; 0.4 makes the cell push back: it punishes lingering and splitting up, it imitates teammates, it can go dark, and once in a while something comes for the group. The core stays: the base cell is the same every time, any strange sound is an anomaly, the tambours stay symmetric and the loop seamless, the server reveals nothing it shouldn't.

Order of work: the draw-call headroom and the shared groundwork, then the rules (lingering, a bigger samosbor), then the new anomalies (alone, voice, stings), then darkness with the flashlight, then the chaser, then documents, measurements and the playtest. Each step leaves the game playable.

### Groundwork

- **Draw-call headroom.** The cell alone already takes 298 of the 300 calls, and a full group of six goes past it. Before anything new is drawn, merge what can be merged (matte materials that differ only by colour, small `keep()` units that never move apart, the stairs and tambour pieces) until the cell alone is at 280 or less. Measured with F3 in every room; the bake order and the loop check unchanged.
- **Sight on the server** (`shared/sight.ts`): whether a point is seen from a player's position and yaw, in plan only: the view cone and a line against the walls of `ROOMS` with the gaps of `DOORWAYS`, furniture ignored. The server needs it for the chaser; `src/gaze.ts` keeps the finer check with furniture for what only the client decides.
- **Who is near whom** (`ALONE_M` in `shared/rules.ts`): a player is alone when nobody else who is in the cell stands within this many metres and in the same or an adjacent room. Decided by each client for its own player.
- **Walking the cell on the server.** The route through the doorways that the extra resident uses (`src/stranger.ts`: the room graph, the points either side of a doorway, sliding round furniture with `canStand`) moves to `shared/`, so the server can walk the chaser with it and the extra keeps using it on the client.
- **Cycle time on the client**: the time since the cycle began, from the server's `cycle` message (`elapsed` in ms), so every client's lingering rule and timed effects agree within a frame or two, a reconnect included.

### Rules

**Lingering is dangerous.** A fixed rule of every cycle, not an anomaly, so it never tells anything about the cell.

- From `LINGER.siren` (90 s after the cycle began) a distant siren, quieter than the samosbor's, from the next block; from `LINGER.fog` (110 s) a thin layer of samosbor fog over the floor (the existing fog shader at a low density, `SMOG`), thickening; at `LINGER.samosbor` (150 s) the server sets off a samosbor, a mistake like any other, with «Самосбор окончен. Жильцы задержались на этаже».
- The countdown takes precedence: once someone is out, the clock stops, so a group that is leaving is never caught by it.
- It must not break the loop: the siren and the fog fade out as soon as the first player is out, within 1.5 s, less than the walk from the blast door to the zone, so nothing cuts off at the transfer (with everyone in the zone the verdict comes at once, there is no settle time to fade in). The siren isn't a cell source; it plays everywhere, the tambours included, the same in both zones.
- Measured: the siren's level against the samosbor's (quieter), nothing above 4 kHz louder than −95 dB.

**A bigger samosbor.** The samosbor itself gets scarier, and a second mistake in a row gets a longer one.

- Silhouettes in the fog: a few dark figures that stand at the edge of visibility and are gone when looked at (`src/gaze.ts`), one instanced draw call, placed from the cycle's seed, not at random.
- Teammates' voices through a filter while it lasts (band-limited and wavering, as through a gas mask or a wall); a gas-mask breath under your own voice when you wear the GP-5.
- After two mistakes in a row, a "big samosbor": `SAMOSBOR_BIG_MS` (18 s), the warning twice, the fog reaching the screen later, the siren running down at the end. A mistake is any samosbor, whatever set it off: a wrong verdict (an anomaly missed, or turning back from a clean cycle or a morok), a tie, lingering, the chaser. "In a row" means without a right pass between them; one right pass clears the count. The cycle after a samosbor starts on floor 0 and may hold an anomaly, so getting it wrong is the second in a row. `Room` keeps the count; the phase and the `cycle` message stay the same, with `big: true`.
- Its peaks stay the loudest in the game; the siren and announcement re-measured.

### New anomalies

**Alone** (`alone: true` in the catalogue, never private). They happen only to a player with nobody near (`ALONE_M`): a breath right behind them, a door closing behind them in the room they just left, a teammate calling their name from the next room (with the voice mimic, below, or the formant murmur of "Radio says a name" when there is no recording), footsteps that stop when they stop. Rolled like any anomaly and sent to everyone; each client holds it back until its own player is alone, then plays it once. Several players who each wander off each meet it; a group that never splits up never does, and its verdict is a miss like any other. On the verdict screen they read as usual: «Отклонение: дыхание за спиной».

**Voice mimic.**

- The client keeps the last 8 s of each teammate's voice in a ring buffer (an `AudioWorklet` on the source `voice.ts` already has), only on this machine, never sent anywhere; cut into phrases by the voice level it already measures.
- As an anomaly, one of those phrases plays from behind a neighbour's door (flats 43–48, so it never reaches the back zone), from the pantry or from an empty room, through the walls like any emitter, levelled to the other anomaly sounds. Private by nature: each client has its own recordings. It can be a morok (`morok: 'sound'`): the phrase plays dry.
- Rolled only for a witness who has heard a teammate: the client sends `{ t: 'heard', id }` once it holds a phrase of that teammate; the server keeps the set, validated like every other message, and forgets it when either leaves.
- The lobby's voice checkbox says that teammates' voices may be repeated by the cell, on this machine only.

**Rare stings.** "No sharp attacks" is relaxed for a few deliberate sounds inside anomalies: a door slamming when you turn your back on it, the phone's single ring right beside you, a knock on the wall at your ear. Each with a peak limit below the samosbor's (0.15), measured like the rest; never in a normal cell.

### Darkness and the flashlight

**Blackout cycles.** Some cycles the power is off everywhere: the flat, the landing, the corridor and the tambours. «Плановое отключение электроэнергии» over the building's loudspeakers, heard everywhere like the samosbor's warning (the kitchen radio reaches only a few metres), and a notice on the board. It's a condition the whole group is told about, not an anomaly, so darkness says nothing by itself; anomalies happen in it as usual, except those made of light (light off, flickering lamp, wrong light, broken bulb), which are left out of the pool. From floor 4, one cycle in six or so, never twice in a row; the server sends `dark: true` to everyone. The street lamps and the other blocks' windows stay lit: only our building is off.

- **The loop.** A player in the zone is carried into the next cycle's back tambour, and its picture has to match the one they left. So the light never changes at the transfer: each cycle starts with the lamps as the last one ended, and the switch comes `DARK_SWITCH` (4 s) after the cycle began, everywhere at once, with the clunk of the breaker and the hum dying (or coming back). A blackout cycle starts lit and goes dark; the cycle after it starts dark and comes back on. Both tambours are always in the same state when the group leaves, so the transfer stays pixel-exact and the zones sound the same.
- **The bake** stays as it is: switching off is `lamp.set(0)` on every channel, the tambour lamps included, which is already how light anomalies work; the samosbor's red light still comes on over it.
- **Reflections.** The environment maps were captured with the lamps on and don't know they're off: in the dark, varnish, tiles and glass would mirror a lit room. They fade out with the lamps (`envMapIntensity` to 0) and come back with them; the real mirrors render as they are.
- **Brightness.** A blackout breaks the 0.25–0.40 rule on purpose; it is written down as the one exception. What is measured instead: the windows and the street light still let a player find the way without a beam, and a beam's spot doesn't burn out (under 1% of overexposed pixels).

**The dynamo flashlight («жучок»).**

- Pumped with a key (held or tapped), it charges a little with each squeeze and fades over about 20 s; the whirr is ours, like footsteps. Everyone has one; it's only useful in the dark, so it only shows up in blackout cycles.
- Its beam is a cone in the shared baked-light shader (`useBaked`): up to six beams as uniforms (position, direction, strength), computed per fragment from the world position and the normal, since the tiles are about a metre and a beam's spot drawn per vertex would come out smeared and angular. Characters get it the same way, per fragment, on top of their probe.
- No shadow maps. So a beam doesn't shine through walls, each vertex carries the room it belongs to (a new bake attribute, passed on flat), and a beam lights its own room, plus the next room only through the doorway rectangle it points through. Furniture casts no shadow from a beam: the wall behind a wardrobe is lit too. Accepted.
- This is the first light that isn't baked: the invariant "light is baked only" in `AGENTS.md` gets the exception, where it lives and why it keeps the loop.
- Teammates' beams come from their position and yaw in `pos`, plus a strength they send (a byte, validated); others see where you shine.
- Tambours: a beam in a tambour lights its instances by their own geometry, the same for both halves, so the loop stays pixel-exact; checked like the rest.

### The chaser

A figure that comes for the group, like the running man in Exit 8. It's an anomaly («Преследователь», `chaser`, tier 2, never private, from floor 5; the name checked against the canon in 0.5): the right answer is back, and it makes the way back dangerous.

- It appears at the far end of the flat (the bedroom or the loggia) once the first player enters the living room, and walks towards the nearest player, through the doorways (the route moved to `shared/`), faster than a walk, but only while nobody looks at it (`shared/sight.ts` on the server, with everyone's positions and yaws, its cone a little wider than the screen to cover the delay of positions); when anyone sees it, it stands still.
- Its footsteps are heard while it moves, so silence is the sign it is being watched: an anomaly sound with a hard range like the rest, which never reaches the tambour zones.
- If it reaches a player, a samosbor at once, with «Самосбор окончен. Отклонение: преследователь. Он догнал Петрова».
- The server runs it and sends its position with the others' (`pos` gets one more entry); clients draw it and smooth it like an avatar. One draw call.
- It never goes past the blast doors; looking back at it while walking backwards to the landing is how a group gets out.

### Documents and release

- `docs/DESIGN.md`: the lingering rule, the bigger samosbor and the big one, blackout cycles and the flashlight in the rules; the new anomalies in the catalogue; the chaser.
- `AGENTS.md`: `shared/sight.ts` and the walking route in `shared/`, the flashlight's place in the bake shader and the per-vertex room, the voice ring buffer and the `heard` message, `dark` and `big` in `cycle`, the chaser in `pos`; the invariants that change (light is no longer baked only: the beams; brightness: the blackout exception; sharp attacks allowed in a few anomalies, with their peak limit; recordings never leave the machine).
- Measured before release: draw calls alone and with six players, the bake time with the new attribute, brightness in a blackout with and without beams, the loop pixel check with a beam in the zone, sound in the tambour zones with the lingering siren.
- Group playtest; from the verdict log: how often groups get caught lingering, how often the chaser catches someone, how often an alone anomaly is missed.

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
- **Within the draw calls.** New props that move need `keep()` and a call each; the headroom won in 0.4 is spent carefully, and the cell alone stays at 280 or less.
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
