# Yacheika: design

A cooperative game about a group of residents walking the same cell (*yacheika*) of the Gigakhrushch, an endless prefab-panel block, floor after floor. Every floor is the same cell. Spot an anomaly — turn back; see nothing — go forward. Ten correct passes in a row end the round; a mistake sets off a samosbor and resets the count.

## 1. Rules

- **A pass** is decided by those who left, by majority: back into the tambour they came from, or forward into the tambour past the loggia. Any point past the blast door counts as the choice: the first leg, the middle or the dead end. Once the first player is in a tambour, the rest have `COUNTDOWN_MS` (20 s) to follow; when the whole group is in the tambours, the verdict waits `SETTLE_MS` (2.5 s) more, unless everyone already stands in the exit zone, so the last one in can reach it; the banner shows «Гермодверь закроется через 12 с · наверх 1 · вниз 2 · в пути 1», and those already in a tambour also see «Ожидайте остальных в тамбуре»; once everyone is out, it counts down the settle time instead. A tie between the exits counts as a mistake. Whoever is still in the cell when the countdown runs out doesn't break the pass: they are carried into the next cycle behind a fade, with the caption «Гермодверь закрылась».
- **The pass counter is the floor number**, stencilled on the landing wall: «ЭТАЖ 3». It is seen right on leaving the tambour. Nothing else marks a correct pass: no message, no sound.
- **A mistake** sets off a samosbor (section 7) and the next cell starts from floor 0. What was missed is told in a caption afterwards: «Самосбор окончен. Отклонение: горит конфорка». A mistake is any samosbor, whatever set it off: a wrong choice, a tie, lingering, the chaser. The second in a row without a right pass between them is a big samosbor (section 7.1).
- **Lingering is dangerous.** A fixed rule of every cycle, not an anomaly, so it tells nothing about the cell. From `LINGER.siren` (90 s into the cycle) a distant siren from the next block, quieter than a samosbor's; from `LINGER.fog` (110 s) a thin layer of fog over the floor, thickening; at `LINGER.samosbor` (150 s) a samosbor, «Самосбор окончен. Жильцы задержались на этаже». While anyone is out the clock stands still, and the siren and the fog fade within 1.2 s, before anyone can reach the exit zone, so a group that is leaving is never caught and nothing of it is left at the loop's transfer. Timed by the server's clock of the cycle (`elapsed` in the `cycle` message).
- **Blackout cycles.** From floor `DARK_FROM` (4), about one cycle in six (`DARK_CHANCE`), never twice in a row, the power goes off in the whole building: the flat, the landing, the corridor and the tambours. «Плановое отключение электроэнергии» over the loudspeakers, a notice over the duty roster on the board. It is a condition the whole group is told about, not an anomaly; anomalies happen in it as usual, except those made of light (light off, flickering lamp, wrong light, broken bulb). The street lamps and the other blocks' windows stay lit. Each cycle starts with the lamps as the last one ended, and the switch comes `DARK_SWITCH` (4 s) into the cycle, everywhere at once, with the clunk of the breaker: a blackout cycle starts lit and goes dark, the one after it starts dark and comes back on.
- **The dynamo flashlight («жучок»).** Pumped with **F**, held or tapped: each squeeze charges it a little and the charge fades over about 20 s; the whirr is heard by its owner only. Everyone has one; it works only in a blackout. Teammates see each other's beams.
- **Anomalies** (section 6) appear in `ANOMALY_CHANCE` (60%) of cycles, never in the first cycle of a run (so everyone sees what normal looks like), and never repeat within the last `RECENT_LIMIT` (6) cycles. The hardest tier allowed grows with the streak: tier 1 on floors 0–1, up to 2 on floors 2–4, up to 3 from floor 5.
- **Private anomalies.** With two or more players an anomaly may be shown to one player only (chance `0.1 × floor`, at most 50%). That player has to convince the rest.
- **Morok.** In a cycle that came up clean, with two or more players, from floor 3, one player may be shown an anomaly that isn't there (chance `0.1 × (floor − 2)`, at most 35%). The right answer is still forward; turning back because of it is a samosbor, and afterwards «Отклонений не было, морок видел(а) Петров». A morok has a tell of its own (section 6.1); the end report counts how many times the group fell for one.
- **Alone.** Some anomalies (section 6) come only to a player with nobody near: no other player in the cell within `ALONE_M` (5 m) in the same or the next room. A group that never splits up never meets them, and the verdict is a miss like any other.
- **The rules** hang on the corridor wall as «ПАМЯТКА ЖИЛЬЦУ»: «При обнаружении отклонений — немедленно вернуться назад. Отклонений не обнаружено — продолжать движение. Покинув этаж — ждать всех жильцов в тамбуре. При самосборе — сохранять спокойствие. Не всё, что видишь, — отклонение. Морок дрожит, как воздух над плитой.»
- Up to 6 players per room (`MAX_PLAYERS`). Players don't collide with each other.

## 2. The cell

Sizes in metres. Rooms are about 1.2 times larger than real ones, so six people can turn around in them.

```
[Tambour "back"]   Z-shaped
       │  blast door, always open
[Stair landing 3×3]   «ЭТАЖ N» stencil, mailboxes, electrical panel, lift behind the wall
       │
[Floor corridor 25.6×3, ceiling 2.7]   doors of flats 41–48, garbage chute,
       │                                notice board, caged bulbs, window at the end
[Door of flat 49, padded leatherette]
       │
[Hallway 2.4×3] ── pantry 1.2×1.4 (closed)
       │
[Passage 1.3×4] ── bathroom 1.9×1.8, toilet 1.1×1.6, kitchen 3×3
       │
[Living room 6.2×5.5, walk-through]
       │
[Bedroom 4×4.5]
       │
[Loggia 4×1.8]   blast door into the inter-block passage
       │
[Tambour "forward"]   Z-shaped
```

- The main route is about 45 m, a pass takes 20–25 s. The kitchen, bathroom and toilet are off the route and have to be checked on purpose: the group decides whether to split up.
- Ceilings: 2.5 m in the flat, 2.7 m on the landing and in the corridor.
- Windows: kitchen, living room, bedroom, loggia, end of the corridor.
- Interior doors stand open at a right angle. Players don't open them; a closed or ajar door is an anomaly. A door an anomaly has shut gives way, creaking, when someone comes up to it.

### 2.1. Tambours and the loop

Each exit leads into a Z-shaped tambour, symmetric under a 180° turn about the centre of its middle leg. A player standing in the exit zone (the part of the middle leg from which neither the doorway nor the dead end is visible) when a pass is resolved is moved by `loopPose` into the back tambour with that turn, and the picture doesn't change; anyone elsewhere in a tambour goes through a fade. The zone is painted on the floor in yellow and black diagonal hatching, a stripe through the centre, so the two halves of the turn carry it on into each other. The constraints this puts on geometry, light, sound and rendering are listed in `AGENTS.md`.

Finish: green oil paint up to 1.5 m, whitewash above, metlakh tile, a cable duct, one caged bulb in the middle. Outside, the concrete skin of the inter-block passage.

## 3. Visual style

No assets: textures are drawn on canvas, furniture is built from primitives, sound is synthesised.

### 3.1. Surfaces

| Where | Floor | Walls | Ceiling |
|---|---|---|---|
| Landing, tambours | metlakh tile | green oil paint to 1.5 m, whitewash above | whitewash |
| Floor corridor | concrete | blue paint to half height, whitewash above | whitewash, cable duct |
| Hallway, passage | parquet-pattern linoleum | small-rhombus wallpaper | whitewash |
| Living room | herringbone parquet | large-flower wallpaper | whitewash |
| Bedroom | parquet | striped wallpaper | whitewash |
| Kitchen | linoleum | tile to mid-wall, paint above | whitewash |
| Bathroom, toilet | tile | white-and-blue 15×15 tile | paint |
| Loggia | concrete | whitewash, wooden cladding | concrete |

Every surface has colour, relief and roughness maps. Common details: skirting boards, switches, cast-iron radiators under windows.

### 3.2. Furniture

- **Landing and corridor:** mailboxes, electrical panel, garbage chute hatch, notice board, neighbours' doors with numbers, doormats, caged bulbs.
- **Hallway:** coat rack with a coat and hat, slippers (a pair per player), a cabinet with a rotary phone, electricity meter, mirror, pantry door, mezzanine shelves.
- **Kitchen:** gas stove, "ZIL" fridge, table with oilcloth and a plate per player, stools, wall cupboards, sink, wired radio, tear-off calendar, kettle, curtains.
- **Bathroom and toilet:** cast-iron bathtub with a curtain, sink with a small mirror, washing machine; toilet with a high cistern on a chain.
- **Living room:** wall unit with crystal behind glass, rug on the wall, sofa, two armchairs, coffee table, tube TV, floor lamp, pendulum clock, portrait, chandelier, tulle.
- **Bedroom:** double bed, wardrobe, dressing table, cot, rug on the floor.
- **Loggia:** skis, jars of pickles, a stool, clotheslines.

### 3.3. Characters

- **Clothing:** tracksuit with stripes, quilted jacket, house robe, L-1 protective suit; the main colour is the player's colour.
- **Protective gear:** GP-5 gas mask, gauze mask, "Lepestok" respirator, welding mask, ushanka with a scarf, none. Open variants show a drawn face.
- A «ДНД» armband on the left shoulder in the player's colour, visible from the side and behind.
- An ID card on the chest with the surname and flat number (41–48), readable up close.
- Speaking makes the gear glow faintly. Characters take the baked light of the point they stand on.
- **Your own body** is the same character: looking down you see your chest with the ID card, your legs and, when walking, your hands, in step with the footsteps. The head isn't drawn for your own eyes; the mirrors show the whole figure, mask included.

### 3.4. Interface

- **Lobby:** a «ОБЪЯВЛЕНИЕ» sheet on a cork board, in typewriter type. Fields: «Фамилия жильца» (name), «Номер блока» (room code), «Средства защиты» (clothing and gear, with an ID photo), «Связь» (voice chat, with the warning that the cell may repeat teammates' voices, recorded on this machine only).
- **HUD:** the status line adds «жучок (F)» in a blackout.
- **Esc:** «Журнал дежурного» — residents, «Начать обход», graphics quality, settings (mouse sensitivity, sound and voice volume), controls and rules.
- **Final screen** at the bottom of the stairs after a win: «АКТ об окончании обхода» with the time, the number of samosbors and «Поддались мороку».
- **Fault screen** («НЕИСПРАВНОСТЬ») when WebGL 2 won't start or the context is lost.

### 3.5. The yard

Night outside every window: rows of identical panel blocks in black murk, lit windows (deterministic), driveways with sodium street lamps, lamps over the entrances, bare trees, snow and wet asphalt. The murk is brown low down from the street lamps and black above. The yard is the same in every cycle and carries its own category of anomalies.

## 4. Light and graphics

The goal is a deep, gloomy, filmic picture that keeps the loop pixel-exact and runs on an average laptop.

### 4.1. Baked light

The cell is static, so light is computed once when the world is built and stored in vertices. There are no light sources in the scene.

Baked into each vertex:
1. **Direct light from each lamp:** intensity × falloff × incidence × visibility. Visibility tests the ray against walls (plan rectangles plus doorway heights) and the boxes of large furniture.
2. **Window light:** a few dim points on each window plane.
3. **Bounce light** and **ambient occlusion** at joints, in corners, behind and under furniture.

Walls, floors and ceilings are split into small tiles so shadows are smooth. Each lamp is a **separate channel** multiplied by the lamp's current colour and brightness, so lamps switch off, flicker, change colour and turn red in a samosbor without rebaking; on top of its level each lamp has the building's power (`mains`), which a blackout takes away. Characters and moving objects take the light at one point.

**The one light that isn't baked: flashlight beams.** Up to six cones, one per player, added per fragment in the same shader to the baked light (diffuse only). No shadow maps: each vertex carries the room it belongs to (`bakeRoom`), and a beam lights its own room and the next one only through the doorway it points into, so it doesn't go through walls; furniture casts no shadow from a beam. Beams are worked out in view space for each camera that renders, so both tambours' instances get the same light and the loop stays pixel-exact with a beam in the zone. Close up the spot spreads (the bulb sits in a reflector) instead of burning out.

Budget: 150 ms per bake. The first bake is cached, since the cell never changes. The room attribute costs about 5 ms.

### 4.2. Lamps

| Room | Source | Colour |
|---|---|---|
| Landing, corridor | caged bulbs | 2700 K, pools of light with dark gaps |
| Hallway, passage | bare bulb | 2600 K, harsh shadows |
| Kitchen | fluorescent tube | 5000 K, slightly green |
| Bathroom, toilet | ceiling dome | 4000 K |
| Living room | three-armed chandelier | 2700 K, dim in the corners |
| Bedroom | sconce by the bed | 2400 K |
| Loggia | bulb | 2700 K |
| Tambours | caged bulb in the middle | twilight |
| Windows | street glow | weak, reddish |

White balance is 3500 K. Ambient light is very weak: depth comes from pools of light and darkness between them.

In a blackout every lamp is off, the tambours' too; the environment maps, captured with the lamps on, fade out with them, and the other storeys of our building go dark. The window light counts 3.5 times as much (`DARK_EYES`, the eyes adjusting), so the rooms with windows can be crossed without a beam; the hall, the passage and the tambours are black. A samosbor's red light still comes on over a blackout.

### 4.3. Materials and reflections

Physically based materials with relief and roughness: varnished parquet 0.35, tile 0.15, polished furniture 0.25, crystal and glass 0.05, enamel 0.2, oilcloth 0.4, linoleum 0.6, wallpaper, whitewash and rugs 0.9–1.0.

Each room gets an environment map captured once from its centre after the bake; glossy materials of that room use it. Lamp highlights come from these maps.

### 4.4. Mirrors

Three mirrors are real reflections (`Reflector`): the hallway mirror, the small one over the washbasin and the middle panel of the bedroom dresser (its turned wings keep the room's environment map). Each is rendered at reduced resolution, only while on screen and only while the player stands in a room it can be seen from, and shows only the rooms around it plus players (yourself included) and anomalies. The hallway one is needed for "Extra in the mirror": that figure lives on a layer only that mirror sees. On low quality there are no reflections: the hallway mirror is frosted glass, the other two are plain glossy glass.

### 4.5. Post-processing

On high quality: HDR with multisampling, bloom on lamps and lit windows only, a "Soviet film" grade (muted colour, greenish shadows, warm faded highlights), vignette, slight chromatic aberration towards the corners, grain. Grain can be frozen for pixel comparisons. No screen-space AO: the baked one replaces it.

### 4.6. Wear

Deterministic decals, the same every cycle: dirt around switches, wallpaper peeling at the ceiling, rust streaks, worn linoleum at thresholds, limescale, soot above the stove, chipped paint and mop streaks on the landing and corridor walls.

Wear must not look like an anomaly: no noticeable one-off detail where an anomaly can show something similar, and nothing in the tambours.

### 4.7. Samosbor fog

Rusty brown, thick at the floor and thinning towards the ceiling, computed in the shaders. Puffs crawl from vent grilles, from under doors, from the garbage chute and from the tambour ends. A group that lingers gets a thin, darker layer of the same fog over the floor (`src/linger.ts`).

### 4.8. Quality and performance

| Mode | What's on |
|---|---|
| High | environment maps, mirrors, post-processing, render scale up to 1.5 |
| Low | baked light, materials without environment maps, mirrors without reflections, no post-processing, render scale 1 |

Switched with **G** or in the Esc menu; the choice is remembered. Budget: at most 300 draw calls. **F3** shows frame rate, draw calls, triangles and bake time.

### 4.9. Measuring the image

Brightness is set by measurement, not by eye:
- mean frame brightness in each room 0.25–0.40, fewer than 1% overexposed pixels. The one exception is a blackout, dark on purpose: there the measure is that the rooms with windows can be crossed without a beam (mean 0.03–0.09 in the kitchen, bedroom and loggia, 0.016 in the windowless hall and tambours) and that a beam's spot doesn't burn out, even at a white wall a metre away (under 1%);
- no light leaks through walls (a dark kitchen next to a lit living room stays dark);
- the loop transfer is pixel-exact with frozen grain;
- shots from the ends of long walls and in corners show no artefacts;
- the bake fits its budget.

## 5. Sound

All sound is synthesised with Web Audio. The normal cell always sounds the same:

| Source | Where | Character |
|---|---|---|
| Riser and pipes | everywhere | low, steady |
| Lamps | every lamp | the kitchen tube hums, caged bulbs crackle |
| "ZIL" fridge | kitchen | hum with periodic compressor rattle |
| Wired radio | kitchen | a waltz, always the same loop |
| Dripping tap | bathroom | sparse drops |
| Pendulum clock | living room | ticking, in time with the pendulum and the second hand |
| Electricity meter | hallway | sparse clicks |
| Lift | behind the landing wall | distant hum |
| Footsteps | everywhere | by surface: muffled on rugs, clicking on tile, creaking parquet |

- Reverb by room type: dry in the living room, ringing in the bathroom, booming in the corridor. Sound behind walls is muffled.
- No random sounds in a normal cell: any strange sound is an anomaly.
- No cell source reaches the tambour zones; loudness in both zones matches.
- Everything soft: nothing above 4 kHz louder than −95 dB, no sharp attacks, except the few stings (section 6), each under a 0.15 peak, below the samosbor's.
- Voice chat is positional: players are heard from where they stand. While a samosbor lasts, voices come band-limited and wavering, as through a gas mask, and whoever wears the GP-5 hears their own breath in it.
- A lingering group hears a siren from another block, the same everywhere; a blackout brings the breaker's clunk and the lamps' hum dies with them; the chaser's steps are heavy and stop when it is looked at.

## 6. Anomalies

66 anomalies (`shared/anomalies.ts`), three tiers:
- **1** — obvious at once;
- **2** — needs attention;
- **3** — needs knowing the cell by heart.

Any anomaly can be private (section 1). Anomalies that depend on the number of players (slippers, plates, the double) take it from the room's roster.

### 6.1. Morok

A morok is one of the anomalies below shown in a clean cycle, to one player, with a tell that a real anomaly never has. The same rule for every morok of a kind:

- **Seen** (`morok: 'sight'`): what it is made of shimmers like air over a stove: it sways by a couple of pixels, its picture ripples, fine stripes drift up over it, more at the edges. Faint out of the corner of the eye, plain when looked at straight. And it touches nothing around it: no sound (a morok burner doesn't hiss, a morok TV is silent) and no light (no glow on the floor, a morok chandelier swings but its light stays still).
- **Heard** (`morok: 'sound'`): dry, as if inside the head: no reverb of the room, and through a wall it gets quieter but not duller.

A morok only adds or changes, never takes away: crystal gone, clock stopped, silence, all windows dark are always real, and so is anything made of light (light off, flickering lamp, wrong light, broken bulb, fog on the horizon). Of the new kinds, the alone sounds, the phone's ring, the knock and the voice mimic can be heard as a morok; a door that shuts or slams, and the chaser, are always real.

### Landing and floor corridor

| Anomaly | Tier | What it looks like |
|---|---|---|
| Wrong floor | 3 | The stencil shows the wrong number |
| Mirrored floor | 2 | The stencil is mirrored |
| Neighbour's door ajar | 2 | One of flats 41–48 is ajar, darkness behind it |
| Different notice | 2 | The board says something else, e.g. «НЕ ОТКРЫВАЙТЕ ДВЕРЬ» |
| Garbage chute hums | 2 | A low hum from the hatch, the lid trembles |
| Broken bulb | 1 | One corridor bulb is out, shards beneath it |
| Mailbox open | 3 | Letters stick out of one box |

### Hallway and pantry

| Anomaly | Tier | What it looks like |
|---|---|---|
| Extra slippers | 2 | One more pair than players |
| Receiver off | 1 | The handset lies beside the phone, dial tone audible |
| Phone ringing | 1 | The rotary phone rings |
| Meter runs backwards | 3 | The meter disc spins the other way |
| Extra chain | 3 | Two chains on the front door |
| Extra in the mirror | 3 | Someone stands in the mirror who isn't in the hallway |
| Pantry open | 2 | The pantry door is open, darkness inside |

### Kitchen

| Anomaly | Tier | What it looks like |
|---|---|---|
| Burner on | 1 | A blue flame, quiet hiss |
| Fridge open | 1 | The door is open, light inside |
| Wrong year | 3 | The calendar shows a different year |
| Extra plate | 2 | One more plate than players |
| Radio backwards | 2 | The waltz plays in reverse |
| Radio says a name | 3 | Through static the announcer says a player's name |
| Tap running | 2 | Water runs in a stream |
| Kettle whistling | 1 | The kettle whistles on a cold stove |

### Bathroom and toilet

| Anomaly | Tier | What it looks like |
|---|---|---|
| Bathtub full | 2 | Filled to the brim with dark water |
| Curtain drawn | 2 | The curtain is closed, a silhouette behind it |
| Writing on the mirror | 3 | «ВЫ УЖЕ БЫЛИ ЗДЕСЬ» on the fogged mirror above the sink |
| Cistern running | 3 | Water keeps running in the toilet |

### Living room

| Anomaly | Tier | What it looks like |
|---|---|---|
| Rug upside down | 2 | The wall rug's pattern is flipped |
| Different rug | 3 | Same colours, different pattern |
| TV on | 1 | Static or «НЕ ВЫКЛЮЧАЙТЕ» on the screen, its light flickers on the walls |
| Crystal gone | 2 | One shelf of the wall unit is empty |
| Chandelier swinging | 2 | The chandelier slowly swings |
| Armchair to the wall | 3 | One armchair faces the wall |
| Portrait watching | 3 | The portrait's eyes follow the player |
| Clock stopped | 3 | The pendulum and the second hand are still, no ticking |

### Bedroom and loggia

| Anomaly | Tier | What it looks like |
|---|---|---|
| Wardrobe ajar | 2 | The wardrobe door is open, darkness inside |
| Eyes under the bed | 2 | Two glowing points under the bed |
| Bed unmade | 3 | The bedspread thrown off, a dent in the pillow |
| Cot rocking | 1 | The cot rocks by itself |
| Jars on the loggia | 3 | One more jar of pickles, cloudy |

### Light

| Anomaly | Tier | What it looks like |
|---|---|---|
| Light off | 1 | One room is dark |
| Flickering lamp | 2 | One room's lamp flickers |
| Wrong light | 3 | Warm light in the kitchen, or cold in the living room |

### Windows

| Anomaly | Tier | What it looks like |
|---|---|---|
| Someone in the window opposite | 2 | A silhouette in a window of the block opposite |
| All windows dark | 1 | Not a single lit window in the yard |
| Wall instead of the yard | 1 | A blank concrete wall right outside one window |
| Fog on the horizon | 3 | Reddish samosbor fog over distant roofs |

### Players and sounds

| Anomaly | Tier | What it looks like |
|---|---|---|
| Double | 2 | A copy of a player sits at the kitchen table and turns its head to follow you |
| Footsteps behind | 3 | Someone repeats each of your steps with a delay |
| Knocking on the radiator | 2 | Rhythmic knocking on the heating pipes |
| Neighbours drilling | 1 | A drill behind the corridor wall |
| Crying behind the wall | 2 | A child crying quietly in a neighbouring flat |
| Silence | 3 | All background sound of the cell is gone |

### The group

These need a teammate, so they come only with two players or more.

| Anomaly | Tier | What it looks like |
|---|---|---|
| Looks at you | 2 | On one screen only, a teammate's head keeps turning to you, further than a neck should, wherever they really look |
| Faceless | 2 | One resident has no face, or a gas mask without its glass, or other gear than picked in the lobby; everyone sees it but them |
| Extra | 2 | One more resident from flat 49 waits on the landing, follows the group a couple of metres behind and never leaves the cell; the countdown and the duty log count them |
| Don't look | 3 | While nobody looks, a dark figure at the far end of the corridor stands a step closer, or an armchair turns further |
| Only together | 3 | «ВЫ НЕ ОДНИ» in chalk under the floor stencil, or a figure at the corridor window, seen only while two people look at it at once |

"Radio says a name" writes the name on the radio's front and speaks it with the browser's speech synthesis; without a Russian voice, a formant synthesiser murmurs its vowels.

### Alone

They come only to a player with nobody near (section 1). Rolled like any anomaly and sent to everyone, never private; each screen holds it back until its own player has been alone for a moment, then plays it once. Several players who each wander off each meet it.

| Anomaly | Tier | What it looks like |
|---|---|---|
| Breath behind you | 2 | Somebody breathes out right behind your head |
| A door shut behind you | 2 | The door of the room you have just left swings shut, out of sight, and latches |
| Called from the next room | 3 | Your name from an empty room next door: a teammate's voice the cell took (the voice mimic), or a murmur saying it |
| Footsteps when you're alone | 2 | A few steps behind you keep step with yours, and stop when you do |

### Stings

The only sharp sounds in the game, never in a normal cell.

| Anomaly | Tier | What it looks like |
|---|---|---|
| A door slams | 1 | A door you have just looked at slams the moment you turn your back on it |
| The phone rings once | 1 | One sharp ring of the hall phone as you pass right by it |
| A knock at your ear | 2 | Three knocks in the wall you stand by |

### The voice mimic

Each client keeps the last 8 s of every teammate's voice, on this machine only, never sent anywhere, cut into phrases by the voice level. The anomaly is rolled only for a witness whose machine holds such a phrase (it tells the server whom it has heard), and is always private.

| Anomaly | Tier | What it looks like |
|---|---|---|
| A familiar voice | 3 | Something a teammate said a minute ago, said again from behind a neighbour's door, from the shut pantry, the bathroom or the toilet |

### The chaser

| Anomaly | Tier | What it looks like |
|---|---|---|
| The chaser | 2 | From floor 5, never private. A figure in a protective suit and gas mask at the far end of the flat: once someone enters the living room, it comes for the nearest player through the doorways, faster than a walk, but only while nobody looks at it; looked at, it stands still. Its heavy steps are heard while it moves. It never goes past a blast door: looking back at it while backing out to the landing is how a group gets out. If it reaches someone, a samosbor: «Отклонение: преследователь. Он догнал Петрова» |

The server walks it (`server/chaser.ts`) with the same route through the doorways the extra resident uses, and decides who sees it in plan (`shared/sight.ts`): the view cone a little wider than a screen, the walls, doorways as gaps.

## 7. Samosbor and victory

### 7.1. Samosbor

10 seconds over the cell where the mistake happened, timed from the verdict (`SAMOSBOR` in `shared/rules.ts`):

1. **0.0 s.** The lamps go out and a red emergency light comes on; the windows dim. A motor siren on the next block's roof winds up over three seconds, then wails up and down (250–440 Hz), fat and hollow, echoing off the blocks; nothing piercing. Teammates' voices come through as if from behind a gas mask.
2. **0.8 s.** The radio, once: «Внимание! Самосбор! Всем жильцам немедленно укрыться в гермоблоках».
3. **2.5 s.** Fog creeps from the vents and under the doors; visibility drops from 40 m to 2 m. A few dark figures stand at the edge of what can be seen, in places the cycle's id picks, and are gone for good once looked at straight.
4. **6.0 s.** Squelching, flickering light, the screen edges swim.
5. **8.8 s.** Fog covers the screen; the siren runs down.
6. **10.0 s.** Silence. The group comes to in the back tambour on floor 0, with the caption naming what was missed.

**The big samosbor.** The second mistake in a row lasts `SAMOSBOR_BIG_MS` (18 s, `SAMOSBOR_BIG`): the warning a second time at 6.5 s, the fog from 3 s and covering the screen only at 16.8 s, the light stuttering from 12.5 s, the siren running down at the end.

### 7.2. Server

A wrong verdict, a tie between the exits, lingering or the chaser moves the room into the `samosbor` phase for `SAMOSBOR_MS`, or `SAMOSBOR_BIG_MS` when it is the second mistake in a row (`Room.mistake`; one right pass clears the count; the `result` and `cycle` messages say `big`). The cycle id stays, the anomaly is cleared, exits don't count. Then a new cycle from floor 0, always through a fade, lit. A correct pass is instant and seamless.

### 7.3. Victory

After ten correct passes the dead ends of both tambours open onto a flight of stairs down: 16 steps, a landing with a lamp, a door with a «ВЫХОД» sign. If the last floor ended in a blackout, the way out starts dark and the power comes back 4 s later. The radio: «Самосбор миновал. Жильцам вернуться в квартиры». Players in the exit zone stay where they are, the rest appear in the back tambour. At the bottom of the stairs, the final screen with the time and the number of samosbors.

## 8. Ideas

Planned work and ideas are in `docs/ROADMAP.md`.
