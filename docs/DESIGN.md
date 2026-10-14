# Yacheika: design

A cooperative game about a group of residents walking the same cell (*yacheika*) of the Gigakhrushch, an endless prefab-panel block, floor after floor. Every floor is the same cell. Spot an anomaly — turn back; see nothing — go forward. Ten correct passes in a row end the round; a mistake sets off a samosbor and resets the count.

## 1. Rules

- **A pass** counts when the whole group leaves through one exit: back into the tambour they came from, or forward into the tambour past the loggia. Any point past the blast door counts as the choice: the first leg, the middle or the dead end. Once the first player is in a tambour, the rest have `COUNTDOWN_MS` (20 s) to follow; when the whole group is in the tambours, the verdict waits `SETTLE_MS` (2.5 s) more, unless everyone already stands in the exit zone, so the last one in can reach it; the banner shows «Гермодверь закроется через 12 с · наверх 1 · вниз 2 · в пути 1», and those already in a tambour also see «Ожидайте остальных в тамбуре»; once everyone is out, it counts down the settle time instead. A split group counts as a mistake.
- **The pass counter is the floor number**, stencilled on the landing wall: «ЭТАЖ 3». It is seen right on leaving the tambour. Nothing else marks a correct pass: no message, no sound.
- **A mistake** sets off a samosbor (section 7) and the next cell starts from floor 0. What was missed is told in a caption afterwards: «Самосбор окончен. Отклонение: горит конфорка».
- **Anomalies** (section 6) appear in `ANOMALY_CHANCE` (60%) of cycles, never in the first cycle of a run (so everyone sees what normal looks like), and never repeat within the last `RECENT_LIMIT` (6) cycles. The hardest tier allowed grows with the streak: tier 1 on floors 0–1, up to 2 on floors 2–4, up to 3 from floor 5.
- **Private anomalies.** With two or more players an anomaly may be shown to one player only (chance `0.1 × floor`, at most 50%). That player has to convince the rest.
- **The rules** hang on the corridor wall as «ПАМЯТКА ЖИЛЬЦУ»: «При обнаружении отклонений — немедленно вернуться назад. Отклонений не обнаружено — продолжать движение. Покинув этаж — ждать всех жильцов в тамбуре. При самосборе — сохранять спокойствие.»
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
- Interior doors stand open at a right angle. Players don't open them; a closed or ajar door is an anomaly.

### 2.1. Tambours and the loop

Each exit leads into a Z-shaped tambour, symmetric under a 180° turn about the centre of its middle leg. A player standing in the exit zone (the part of the middle leg from which neither the doorway nor the dead end is visible) when a pass is resolved is moved by `loopPose` into the back tambour with that turn, and the picture doesn't change; anyone elsewhere in a tambour goes through a fade. The constraints this puts on geometry, light, sound and rendering are listed in `AGENTS.md`.

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

### 3.4. Interface

- **Lobby:** a «ОБЪЯВЛЕНИЕ» sheet on a cork board, in typewriter type. Fields: «Фамилия жильца» (name), «Номер блока» (room code), «Средства защиты» (clothing and gear, with an ID photo), «Связь» (voice chat).
- **Esc:** «Журнал дежурного» — residents, «Начать обход», graphics quality, settings (mouse sensitivity, sound and voice volume), controls and rules.
- **Final screen** at the bottom of the stairs after a win: «АКТ об окончании обхода» with the time and the number of samosbors.
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

Walls, floors and ceilings are split into small tiles so shadows are smooth. Each lamp is a **separate channel** multiplied by the lamp's current colour and brightness, so lamps switch off, flicker, change colour and turn red in a samosbor without rebaking. Characters and moving objects take the light at one point.

Budget: 150 ms per bake. The first bake is cached, since the cell never changes.

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

### 4.3. Materials and reflections

Physically based materials with relief and roughness: varnished parquet 0.35, tile 0.15, polished furniture 0.25, crystal and glass 0.05, enamel 0.2, oilcloth 0.4, linoleum 0.6, wallpaper, whitewash and rugs 0.9–1.0.

Each room gets an environment map captured once from its centre after the bake; glossy materials of that room use it. Lamp highlights come from these maps.

### 4.4. Mirrors

Three mirrors are real reflections (`Reflector`): the hallway mirror, the small one over the washbasin and the middle panel of the bedroom dresser (its turned wings keep the room's environment map). Each is rendered at reduced resolution, only while on screen and only while the player stands in a room it can be seen from, and shows only the rooms around it plus players and anomalies. The hallway one is needed for "Extra in the mirror": that figure lives on a layer only that mirror sees. On low quality there are no reflections: the hallway mirror is frosted glass, the other two are plain glossy glass.

### 4.5. Post-processing

On high quality: HDR with multisampling, bloom on lamps and lit windows only, a "Soviet film" grade (muted colour, greenish shadows, warm faded highlights), vignette, slight chromatic aberration towards the corners, grain. Grain can be frozen for pixel comparisons. No screen-space AO: the baked one replaces it.

### 4.6. Wear

Deterministic decals, the same every cycle: dirt around switches, wallpaper peeling at the ceiling, rust streaks, worn linoleum at thresholds, limescale, soot above the stove, chipped paint and mop streaks on the landing and corridor walls.

Wear must not look like an anomaly: no noticeable one-off detail where an anomaly can show something similar, and nothing in the tambours.

### 4.7. Samosbor fog

Rusty brown, thick at the floor and thinning towards the ceiling, computed in the shaders. Puffs crawl from vent grilles, from under doors, from the garbage chute and from the tambour ends.

### 4.8. Quality and performance

| Mode | What's on |
|---|---|
| High | environment maps, mirrors, post-processing, render scale up to 1.5 |
| Low | baked light, materials without environment maps, mirrors without reflections, no post-processing, render scale 1 |

Switched with **G** or in the Esc menu; the choice is remembered. Budget: at most 300 draw calls. **F3** shows frame rate, draw calls, triangles and bake time.

### 4.9. Measuring the image

Brightness is set by measurement, not by eye:
- mean frame brightness in each room 0.25–0.40, fewer than 1% overexposed pixels;
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
- Everything soft: nothing above 4 kHz louder than −95 dB, no sharp attacks.
- Voice chat is positional: players are heard from where they stand.

## 6. Anomalies

53 anomalies (`shared/anomalies.ts`), three tiers:
- **1** — obvious at once;
- **2** — needs attention;
- **3** — needs knowing the cell by heart.

Any anomaly can be private (section 1). Anomalies that depend on the number of players (slippers, plates, the double) take it from the room's roster.

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

"Radio says a name" writes the name on the radio's front and speaks it with the browser's speech synthesis; without a Russian voice, a formant synthesiser murmurs its vowels.

## 7. Samosbor and victory

### 7.1. Samosbor

About 6 seconds over the cell where the mistake happened, timed from the verdict:

1. **0.0 s.** The lamps go out and a red emergency light comes on; the windows dim. A siren: low, rising, nothing piercing.
2. **0.5 s.** The radio: «Внимание! Самосбор! Всем жильцам немедленно укрыться в гермоблоках».
3. **1.5 s.** Fog creeps from the vents and under the doors; visibility drops from 40 m to 2 m.
4. **3.5 s.** Squelching, flickering light, the screen edges swim.
5. **5.0 s.** Fog covers the screen.
6. **6.0 s.** Silence. The group comes to in the back tambour on floor 0, with the caption naming what was missed.

### 7.2. Server

A wrong verdict or a split group moves the room into the `samosbor` phase for `SAMOSBOR_MS`. The cycle id stays, the anomaly is cleared, exits don't count. Then a new cycle from floor 0, always through a fade. A correct pass is instant and seamless.

### 7.3. Victory

After ten correct passes the dead ends of both tambours open onto a flight of stairs down: 16 steps, a landing with a lamp, a door with a «ВЫХОД» sign. The radio: «Самосбор миновал. Жильцам вернуться в квартиры». Players in the exit zone stay where they are, the rest appear in the back tambour. At the bottom of the stairs, the final screen with the time and the number of samosbors.

## 8. Ideas

Planned work and ideas are in `docs/ROADMAP.md`.
