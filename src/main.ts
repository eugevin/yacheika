import * as THREE from 'three';
import { ANOMALIES } from '../shared/anomalies.ts';
import { STAIRS, exitAt, loopPose, spawnPoint, stairDepth } from '../shared/map.ts';
import { MASKS, OUTFITS, isMask, isOutfit, type MaskId, type OutfitId } from '../shared/masks.ts';
import type { Phase, RunStats, ServerMsg } from '../shared/protocol.ts';
import { applyAnomaly, type People } from './anomalies.ts';
import { Sound } from './audio.ts';
import { Avatars } from './avatars.ts';
import { Character, type Look } from './character.ts';
import { Preview, corkTexture } from './lobby.ts';
import { Net } from './net.ts';
import { Post } from './post.ts';
import { Samosbor, clearSmog } from './samosbor.ts';
import { SMOG_SPACE } from './world/smog.ts';
import { Walker } from './player.ts';
import { Voice } from './voice.ts';
import { applyEnv } from './world/env.ts';
import { LAYERS, buildWorld, type World } from './world/index.ts';

const POS_HZ = 15;
/** Picked by measuring mean frame brightness in every room (docs/DESIGN.md, 4.9), not by eye. */
const EXPOSURE = 1;
const MARK_COOLDOWN = 0.5;
const FADE_SPEED = 3; // full fade in a third of a second
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const ui = {
  lobby: $('lobby'),
  name: $<HTMLInputElement>('name'),
  code: $<HTMLInputElement>('code'),
  mic: $<HTMLInputElement>('mic'),
  error: $('lobby-error'),
  pause: $('pause'),
  roomCode: $('room-code'),
  players: $('players'),
  start: $<HTMLButtonElement>('start'),
  hud: $('hud'),
  banner: $('banner'),
  message: $('message'),
  shift: $('shift'),
  status: $('status'),
  chat: $('chat'),
  chatInput: $<HTMLInputElement>('chat-input'),
  fade: $('fade'),
  veil: $('veil'),
  warp: $('warp'),
  caption: $('caption'),
  final: $('final'),
  finalStats: $('final-stats'),
  quality: $<HTMLButtonElement>('quality'),
  debug: $('debug'),
};

/** Something the game can't go on without: a sheet over everything, with a reload button. */
function broken(text: string) {
  $('broken-text').textContent = text;
  $('broken').classList.remove('hidden');
  document.exitPointerLock?.();
}
$('broken-reload').onclick = () => location.reload();

// --- rendering ---
const renderer = (() => {
  try {
    return new THREE.WebGLRenderer({ antialias: true });
  } catch (e) {
    broken('Браузер не смог запустить трёхмерную графику (WebGL 2). Включите аппаратное ускорение в настройках браузера или откройте игру в другом браузере.');
    throw e;
  }
})();
// the driver reset or the GPU ran out of memory: the baked cell and its maps are gone with it
renderer.domElement.addEventListener('webglcontextlost', () => {
  broken('Видеокарта сбросила графику: так бывает при нехватке видеопамяти или сбое драйвера. Обновите страницу — вы вернётесь в тот же блок.');
});
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = EXPOSURE;
document.body.prepend(renderer.domElement);
// No scene lights: everything is lit by the bake (world/lighting.ts).
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0a08);
scene.fog = new THREE.Fog(0x0b0a08, 12, 40);
// far enough for the yard behind the windows (world/yard.ts)
const camera = new THREE.PerspectiveCamera(72, 1, 0.05, 500);
camera.layers.enable(LAYERS.far);
// counted by hand: the hall mirror renders inside the frame's render and would reset the count
renderer.info.autoReset = false;
// bloom, grade, vignette and grain, on high quality only (post.ts)
const post = new Post(renderer, scene, camera);
const resize = () => {
  renderer.setSize(innerWidth, innerHeight);
  post.setSize(innerWidth, innerHeight, renderer.getPixelRatio());
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
};
addEventListener('resize', resize);

// High: reflections, post-processing and a sharper picture. Low: none of them; the baked light costs nothing either way.
type Quality = 'high' | 'low';
let quality: Quality = localStorage.getItem('yacheika.quality') === 'low' ? 'low' : 'high';
function applyQuality() {
  renderer.setPixelRatio(quality === 'high' ? Math.min(devicePixelRatio, 1.5) : 1);
  // post-processing renders in linear HDR: the samosbor's fog is mixed in before tone mapping
  SMOG_SPACE.linear = quality === 'high';
  resize();
  if (world) {
    applyEnv(renderer, scene, world, quality === 'high', [avatars.root]);
    world.setQuality(quality === 'high');
  }
  ui.quality.textContent = `Графика: ${quality === 'high' ? 'высокая' : 'низкая'} (G)`;
}
function toggleQuality() {
  quality = quality === 'high' ? 'low' : 'high';
  localStorage.setItem('yacheika.quality', quality);
  applyQuality();
}

const walker = new Walker(camera);

// --- settings, in the duty log ---
const SETTINGS = {
  sens: { key: 'yacheika.sens', def: 1, show: (v: number) => `${v.toFixed(2)}×`, apply: (v: number) => (walker.sensitivity = v) },
  sound: { key: 'yacheika.volume', def: 1, show: (v: number) => `${Math.round(v * 100)}%`, apply: (v: number) => sound?.setVolume(v) },
  voice: { key: 'yacheika.voices', def: 1, show: (v: number) => `${Math.round(v * 100)}%`, apply: (v: number) => voice?.setVolume(v) },
};
const setting = (id: keyof typeof SETTINGS) => $<HTMLInputElement>(`set-${id}`).valueAsNumber;
function applySettings() {
  for (const id of Object.keys(SETTINGS) as (keyof typeof SETTINGS)[]) SETTINGS[id].apply(setting(id));
}
for (const [id, s] of Object.entries(SETTINGS)) {
  const input = $<HTMLInputElement>(`set-${id}`);
  const out = input.nextElementSibling as HTMLOutputElement;
  const saved = Number(localStorage.getItem(s.key) ?? s.def);
  input.value = String(Number.isFinite(saved) ? saved : s.def);
  out.textContent = s.show(input.valueAsNumber);
  input.oninput = () => {
    out.textContent = s.show(input.valueAsNumber);
    s.apply(input.valueAsNumber);
    localStorage.setItem(s.key, input.value);
  };
}
const avatars = new Avatars();
walker.onStep = (run) => sound?.step(null, run);
avatars.onStep = (x, z, run) => sound?.step({ x, y: 0.05, z }, run);
scene.add(avatars.root);

// --- session state ---
let net: Net | null = null;
let sound: Sound | null = null;
let voice: Voice | null = null;
let myId = 0;
let world: World | null = null;
let cycleMsg: Extract<ServerMsg, { t: 'cycle' }> | null = null;
let shownCycleId = -1;
let shownPhase: Phase | null = null;
let fade = 1;
let posTimer = 0;
let markTimer = 0;
let messageTimer = 0;
let captionTimer = 0;
/** The samosbor going on in the shown cell, if any. */
let samosbor: Samosbor | null = null;
let warned = false;
/** What went wrong, told once the samosbor is over and the next cell is up. */
let aftermath: string | null = null;
/** The final screen came up at the bottom of the stairs; it doesn't come back until the next run. */
let finalShown = false;
/** How the run went, from the cell built for the win. */
let run: RunStats | null = null;
/** Dev only: the samosbor stands still (yacheika.samosbor). */
let samosborHeld = false;
let bakeMs = 0;
applyQuality();

// --- lobby ---
const randomCode = () => Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
ui.name.value = localStorage.getItem('yacheika.name') ?? '';
ui.code.value = new URLSearchParams(location.search).get('room')?.toUpperCase() ?? randomCode();
// no secure context (plain http on a LAN address): the browser hides getUserMedia entirely
if (!window.isSecureContext || !navigator.mediaDevices) {
  ui.mic.checked = false;
  ui.mic.disabled = true;
  $('mic-warning').classList.remove('hidden');
}
// What you wear: remembered between sessions, random the first time. The photo for the card shows
// it in a neutral colour: yours is handed out when you join.
const PREVIEW_COLOR = '#8a93a0';
const randomOf = <T extends string>(list: readonly { id: T }[]) => list[Math.floor(Math.random() * list.length)].id;
const savedOutfit = localStorage.getItem('yacheika.outfit');
const savedMask = localStorage.getItem('yacheika.mask');
let myOutfit: OutfitId = isOutfit(savedOutfit) ? savedOutfit : randomOf(OUTFITS);
let myMask: MaskId = isMask(savedMask) ? savedMask : randomOf(MASKS);
ui.lobby.style.backgroundImage = `url(${corkTexture()})`;
let preview: Preview | null = new Preview($<HTMLCanvasElement>('preview'));
const lookFor = (outfit: OutfitId, mask: MaskId): Look => ({ name: ui.name.value.trim(), color: PREVIEW_COLOR, outfit, mask, flat: 0 });
const showLook = () => preview?.set(lookFor(myOutfit, myMask));

/** A row of icon buttons; picking one remembers it and dresses the photo. */
function picker<T extends string>(box: string, label: string, list: readonly { id: T; name: string }[], look: (id: T) => Look, part: 'body' | 'head', pick: (id: T) => void, current: T) {
  const buttons = list.map((item) => {
    const b = document.createElement('button');
    b.title = item.name;
    const c = document.createElement('canvas');
    c.width = c.height = 96;
    preview?.icon(c, look(item.id), part);
    b.append(c);
    b.onclick = () => {
      pick(item.id);
      for (const [i, other] of buttons.entries()) other.classList.toggle('on', list[i].id === item.id);
      $(label).textContent = item.name;
      showLook();
    };
    return b;
  });
  $(box).append(...buttons);
  buttons[list.findIndex((m) => m.id === current)].click();
}
picker('outfits', 'outfit-name', OUTFITS, (id) => lookFor(id, 'none'), 'body', (id) => {
  myOutfit = id;
  localStorage.setItem('yacheika.outfit', id);
}, myOutfit);
picker('masks', 'mask-name', MASKS, (id) => lookFor('tracksuit', id), 'head', (id) => {
  myMask = id;
  localStorage.setItem('yacheika.mask', id);
}, myMask);
preview.start();
// the surname on the card follows the typing
let typing = 0;
ui.name.addEventListener('input', () => {
  clearTimeout(typing);
  typing = window.setTimeout(showLook, 250);
});
$('new-code').onclick = () => (ui.code.value = randomCode());
$('join').onclick = join;
// a block body on purpose: an on* handler that returns false cancels the keystroke
ui.name.onkeydown = ui.code.onkeydown = (e) => {
  if (e.key === 'Enter') void join();
};

async function join() {
  const code = ui.code.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length < 3) {
    ui.error.textContent = 'Код комнаты: от 3 до 8 латинских букв или цифр';
    return;
  }
  localStorage.setItem('yacheika.name', ui.name.value.trim());
  history.replaceState(null, '', `?room=${code}`);
  if (!sound) {
    sound = new Sound();
    if (world) sound.attach(world);
  }
  sound.unlock();
  voice ??= new Voice(sound.ctx, (to, data) => net?.send({ t: 'rtc', to, data }));
  applySettings();
  if (ui.mic.checked && !voice.stream) await voice.enableMic();
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  net = new Net(url, { t: 'join', name: ui.name.value.trim(), code, mask: myMask, outfit: myOutfit }, handle);
  // the game has its own renderer: the photo's goes
  preview?.dispose();
  preview = null;
  ui.lobby.classList.add('hidden');
  ui.hud.classList.remove('hidden');
  showPause(true);
}

function showPause(show: boolean) {
  ui.pause.classList.toggle('hidden', !show);
  if (show) renderPause();
}

function renderPause() {
  const me = { id: myId, name: ui.name.value.trim() || 'вы', color: myColor(), outfit: myOutfit, mask: myMask, flat: myFlat };
  ui.players.replaceChildren(
    ...[me, ...avatars.all]
      .sort((a, b) => a.flat - b.flat)
      .map((p) => {
        const tr = document.createElement('tr');
        const cell = (...content: (string | Node)[]) => {
          const td = document.createElement('td');
          td.append(...content);
          tr.append(td);
          return td;
        };
        const dot = document.createElement('span');
        dot.className = 'dot';
        dot.style.background = p.color;
        cell(String(p.flat));
        cell(dot, p.id === myId ? `${p.name} (вы)` : p.name);
        const mask = MASKS.find((m) => m.id === p.mask)?.name ?? '';
        const gear = `${OUTFITS.find((o) => o.id === p.outfit)?.name ?? ''}, ${mask.charAt(0).toLowerCase()}${mask.slice(1)}`;
        cell(gear).className = 'gear';
        return tr;
      }),
  );
  const phase = cycleMsg?.phase;
  ui.start.classList.toggle('hidden', phase !== 'lobby' && phase !== 'won');
  ui.start.textContent = phase === 'won' ? 'Новый обход' : 'Начать обход';
  ui.shift.textContent =
    phase === 'playing' ? `Обход: этаж ${cycleMsg!.cycle} из ${cycleMsg!.goal}`
    : phase === 'samosbor' ? 'Самосбор'
    : phase === 'won' ? 'Обход завершён'
    : 'Обход не начат';
}

let myColorValue = '#ffffff';
let myFlat = 0;
const myColor = () => myColorValue;

ui.pause.onclick = (e) => {
  if (e.target === ui.pause || (e.target as HTMLElement).classList.contains('resume')) renderer.domElement.requestPointerLock();
};
ui.start.onclick = () => {
  net?.send({ t: 'start' });
  renderer.domElement.requestPointerLock();
};
ui.quality.onclick = toggleQuality;
$('copy').onclick = () => {
  void navigator.clipboard?.writeText(location.href);
  $('copy').textContent = 'Скопировано';
  setTimeout(() => ($('copy').textContent = 'Скопировать ссылку'), 1500);
};
document.addEventListener('pointerlockchange', () => {
  // a slider left focused would take the arrow keys meant for walking
  if (document.pointerLockElement && document.activeElement !== ui.chatInput) (document.activeElement as HTMLElement | null)?.blur();
  if (!net) return;
  showPause(!document.pointerLockElement && document.activeElement !== ui.chatInput && ui.final.classList.contains('hidden'));
});
$('final-again').onclick = () => {
  net?.send({ t: 'start' });
  ui.final.classList.add('hidden');
  renderer.domElement.requestPointerLock();
};
$('final-stay').onclick = () => {
  ui.final.classList.add('hidden');
  renderer.domElement.requestPointerLock();
};
renderer.domElement.addEventListener('click', () => {
  if (net && !document.pointerLockElement) renderer.domElement.requestPointerLock();
});

// --- input ---
addEventListener('keydown', (e) => {
  if (e.code === 'F3') {
    ui.debug.classList.toggle('hidden');
    e.preventDefault();
    return;
  }
  if (!net) return;
  if (document.activeElement === ui.chatInput) {
    if (e.key === 'Enter') {
      const text = ui.chatInput.value.trim();
      if (text) net.send({ t: 'chat', text });
      closeChat();
    } else if (e.key === 'Escape') closeChat();
    return;
  }
  if (!document.pointerLockElement) return;
  if (e.key === 'Enter') {
    ui.chatInput.classList.remove('hidden');
    ui.chatInput.value = '';
    ui.chatInput.focus();
    e.preventDefault();
  } else if (e.code === 'KeyE') placeMark();
  else if (e.code === 'KeyM') voice?.toggleMute();
  else if (e.code === 'KeyN') sound?.toggleMute();
  else if (e.code === 'KeyG') toggleQuality();
});
addEventListener('mousedown', (e) => {
  if (document.pointerLockElement && e.button === 0) placeMark();
});

function closeChat() {
  ui.chatInput.blur();
  ui.chatInput.classList.add('hidden');
  if (!document.pointerLockElement) showPause(true);
}

const raycaster = new THREE.Raycaster();
raycaster.far = 30;
raycaster.layers.enable(LAYERS.far);
function placeMark() {
  if (!world || markTimer > 0) return;
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  const hit = raycaster.intersectObject(world.group, true)[0];
  if (!hit) return;
  markTimer = MARK_COOLDOWN;
  net?.send({ t: 'mark', x: hit.point.x, y: hit.point.y, z: hit.point.z });
}

// --- HUD ---
function chatLine(text: string, color?: string, name?: string) {
  const div = document.createElement('div');
  if (name) {
    const b = document.createElement('b');
    b.style.color = color ?? '';
    b.textContent = `${name}: `;
    div.append(b);
  } else div.style.color = 'var(--dim)';
  div.append(text);
  ui.chat.append(div);
  while (ui.chat.children.length > 8) ui.chat.firstChild!.remove();
  setTimeout(() => (div.style.opacity = '0'), 10_000);
  setTimeout(() => div.remove(), 11_000);
}

function showMessage(title: string, detail: string, color: string, seconds: number) {
  ui.message.innerHTML = '';
  const t = document.createElement('div');
  t.className = 'title';
  t.style.color = color;
  t.textContent = title;
  const d = document.createElement('div');
  d.className = 'detail';
  d.textContent = detail;
  ui.message.append(t, d);
  ui.message.style.opacity = '1';
  messageTimer = seconds;
}

/** A line at the bottom of the screen, for what the radio says after the fact. */
function caption(text: string, seconds: number) {
  ui.caption.textContent = text;
  ui.caption.style.opacity = '1';
  captionTimer = seconds;
}

function banner(text: string | null) {
  ui.banner.classList.toggle('hidden', !text);
  if (text) ui.banner.textContent = text;
}

function phaseBanner() {
  if (cycleMsg?.phase === 'lobby') banner('Обход не начат: когда все соберутся, Esc → «Начать обход»');
  else if (cycleMsg?.phase === 'won') banner('Самосбор миновал. Лестница вниз — в конце тамбура');
  else banner(null);
}

// --- network ---
function handle(msg: ServerMsg) {
  switch (msg.t) {
    case 'error':
      net?.close();
      net = null;
      ui.error.textContent = msg.text;
      ui.lobby.classList.remove('hidden');
      ui.hud.classList.add('hidden');
      showPause(false);
      break;
    case 'hello':
      // also arrives after a reconnect: start from a clean slate
      myId = msg.id;
      myColorValue = msg.color;
      myFlat = msg.flat;
      avatars.clear();
      voice?.clear();
      if (voice) voice.ice = msg.ice;
      shownCycleId = -1;
      ui.roomCode.textContent = msg.code;
      for (const p of msg.players) {
        avatars.add(p);
        void voice?.call(p.id);
      }
      renderPause();
      break;
    case 'joined':
      avatars.add(msg.player);
      chatLine(`${msg.player.name}, кв. ${msg.player.flat}, заступает на обход`);
      renderPause();
      break;
    case 'left': {
      const name = avatars.info(msg.id)?.name;
      avatars.remove(msg.id);
      voice?.remove(msg.id);
      if (name) chatLine(`${name} покидает блок`);
      renderPause();
      break;
    }
    case 'cycle':
      cycleMsg = msg;
      // a samosbor keeps the cell: only the phase changes
      if (msg.cycleId === shownCycleId) shownPhase = msg.phase;
      if (msg.phase !== 'won') {
        finalShown = false;
        ui.final.classList.add('hidden');
      }
      phaseBanner();
      renderPause();
      break;
    case 'pos':
      for (const [id, x, z, yaw, pitch, c] of msg.list) if (id !== myId && c === shownCycleId) avatars.setPos(id, x, z, yaw, pitch);
      break;
    case 'countdown': {
      const s = Math.ceil(msg.endsIn / 1000);
      const parts = [`наверх ${msg.forward}`, `вниз ${msg.back}`];
      if (msg.inside) parts.push(`в пути ${msg.inside}`);
      banner(`Гермодверь закроется через ${s} с · ${parts.join(' · ')}`);
      break;
    }
    case 'countdown_off':
      phaseBanner();
      break;
    case 'result': {
      // No verdict for a right choice: the floor number on the landing is all there is. A wrong
      // one is the samosbor, and what was missed is told once it's over.
      if (msg.won) {
        sound?.allClear();
        showMessage('САМОСБОР МИНОВАЛ', 'Жильцам вернуться в квартиры', 'var(--good)', 7);
      } else if (!msg.correct) {
        const a = msg.anomaly;
        const seen = a?.seenBy ? `, его видел(а) только ${a.seenBy}` : '';
        aftermath = `${msg.split ? 'Группа разделилась. ' : ''}${a ? `Отклонение: «${a.name}»${seen}` : 'Отклонений не было'}`;
        startSamosbor();
      }
      break;
    }
    case 'chat': {
      const p = msg.id === myId ? { name: ui.name.value.trim() || 'вы', color: myColor() } : avatars.info(msg.id);
      chatLine(msg.text, p?.color, p?.name ?? '???');
      break;
    }
    case 'mark': {
      const color = msg.id === myId ? myColor() : (avatars.info(msg.id)?.color ?? '#fff');
      avatars.mark(msg.x, msg.y, msg.z, color);
      sound?.blip();
      break;
    }
    case 'rtc':
      void voice?.onSignal(msg.from, msg.data);
      break;
  }
}

/** A wrong verdict: the samosbor plays over the cell as it is (samosbor.ts), until the server moves on. */
function startSamosbor() {
  if (!world || samosbor) return;
  samosbor = new Samosbor(world);
  warned = false;
  sound?.samosbor();
}

/**
 * Swaps in the cell of a new cycle. 'loop' (seamless): whoever stands in an exit zone is carried
 * through the loop (shared/map.ts, loopPose) and keeps walking; 'stay': the way out after the last
 * floor is built around whoever stands in an exit zone, where they are; 'spawn': respawn, behind a fade.
 */
function enterCycle(msg: Extract<ServerMsg, { t: 'cycle' }>, mode: 'loop' | 'stay' | 'spawn' = 'spawn') {
  if (world) {
    scene.remove(world.group);
    world.dispose();
  }
  samosbor = null;
  samosborHeld = false;
  clearSmog();
  // one pair of slippers, one plate per person in the room
  world = buildWorld(msg.cycle, 1 + avatars.all.length, msg.phase === 'won');
  walker.stairs = world.won;
  run = msg.run ?? null;
  const people: People = { self: { name: ui.name.value.trim() || 'вы', color: myColor(), mask: myMask, outfit: myOutfit, flat: myFlat }, others: avatars.all };
  for (const a of msg.anomalies) applyAnomaly(world, a.id, a.seed, msg.cycle, people);
  scene.add(world.group);
  // Compile whatever new shaders the cell needs now, in the background where the browser can:
  // compiled on first sight, an anomaly would stall the frame you first look at it.
  void renderer.compileAsync(world.group, camera, scene);
  if (world.bakeMs) bakeMs = world.bakeMs;
  applyEnv(renderer, scene, world, quality === 'high', [avatars.root]);
  world.setQuality(quality === 'high');
  sound?.attach(world);
  const pose = mode === 'loop' ? loopPose(walker.x, walker.z, walker.yaw) : null;
  if (mode === 'stay') {
    // nothing moves: the stairs open up behind a dead end nobody in the zone can see
  } else if (pose) {
    walker.x = pose.x;
    walker.z = pose.z;
    walker.yaw = pose.yaw;
  } else {
    const order = [myId, ...avatars.all.map((p) => p.id)].sort((a, b) => a - b);
    const spawn = spawnPoint(order.indexOf(myId));
    walker.place(spawn.x, spawn.z, spawn.yaw);
  }
  avatars.loop(mode);
  shownCycleId = msg.cycleId;
  shownPhase = msg.phase;
  if (aftermath && msg.phase === 'playing') caption(`Самосбор окончен. ${aftermath}. Этаж ${msg.cycle}.`, 7);
  aftermath = null;
  // joined (or reconnected) in the middle of one
  if (msg.phase === 'samosbor') startSamosbor();
}

/** At the bottom of the stairs: how the run went, and another go. */
function showFinal() {
  finalShown = true;
  const goal = cycleMsg?.goal ?? 10;
  const time = run ? `${Math.floor(run.ms / 60000)}:${String(Math.floor(run.ms / 1000) % 60).padStart(2, '0')}` : '—';
  const s = run?.samosbors ?? 0;
  ui.finalStats.replaceChildren(
    ...[`Этаж: ${goal}`, `Время обхода: ${time}`, `Самосборов за обход: ${s}`].map((t) => {
      const li = document.createElement('li');
      li.textContent = t;
      return li;
    }),
  );
  showPause(false);
  ui.final.classList.remove('hidden');
  document.exitPointerLock();
}

// Dev-only console helpers for building anomalies: yacheika.preview('id'), yacheika.teleport(12, 1.5, -Math.PI / 2)
if (import.meta.env.DEV) {
  Object.assign(window, {
    yacheika: {
      anomalies: () => ANOMALIES.map((a) => a.id),
      voice: () => voice,
      sound: () => sound,
      preview(id?: string, cycle = 3, seed = Date.now()) {
        const { x, z, yaw, pitch } = walker;
        enterCycle({ t: 'cycle', phase: 'playing', cycle, goal: 10, cycleId: shownCycleId, anomalies: id ? [{ id, seed }] : [] });
        Object.assign(walker, { x, z, yaw, pitch });
      },
      /**
       * Sets off a samosbor in the shown cell; yacheika.preview() clears it. `at` skips ahead, in
       * seconds; `hold` then stops it there (for snapshots).
       */
      samosbor(at = 0, hold = false) {
        aftermath = 'Отклонений не было';
        startSamosbor();
        for (let s = 0; s < at; s += 1 / 30) samosbor?.update(1 / 30);
        samosborHeld = hold;
      },
      /** The cell after the last floor, around where you stand, as if the group had just won. */
      win(samosbors = 2) {
        enterCycle(
          { t: 'cycle', phase: 'won', cycle: 10, goal: 10, cycleId: shownCycleId, anomalies: [], run: { ms: 754_000, samosbors } },
          'stay',
        );
      },
      /**
       * Everyone you could meet, in the floor corridor facing the landing: a row of protective gear
       * across the corridor for each outfit, one behind another (or just one outfit's row). Gone on
       * the next rebuild.
       */
      lineup(outfit?: OutfitId) {
        const colors = ['#e8c547', '#5fb3e8', '#e8705f', '#7be85f', '#c77be8', '#e8a35f'];
        const rows = outfit ? OUTFITS.filter((o) => o.id === outfit) : OUTFITS;
        rows.forEach((o, row) =>
          MASKS.forEach((m, i) => {
            const c = new Character({ name: `Жилец ${i + 1}`, color: colors[i], mask: m.id, outfit: o.id, flat: 41 + i });
            c.root.position.set(6.5 + row * 1.2, 0, 0.25 + i * 0.5);
            c.root.rotation.y = Math.PI / 2;
            c.animate(1, 0, 0, 0, 0);
            world?.probe(c.root.position.x, c.root.position.z, c.probe);
            world?.group.add(c.root);
          }),
        );
      },
      where: () => ({ x: walker.x, z: walker.z, yaw: walker.yaw, cycleId: shownCycleId, fade }),
      /** Brightness of the lamps of one room (or of all), 0..1, until the next rebuild. */
      lamp(room: string | null, level: number) {
        for (const l of world?.lamps ?? []) if (room === null || l.room === room) l.set(level);
      },
      quality: () => toggleQuality(),
      /** Film grain standing still (true) or moving, for pixel-for-pixel comparisons of screenshots. */
      freeze(on = true) {
        post.frozen = on;
      },
      world: () => world,
      teleport(x: number, z: number, yaw = walker.yaw, pitch = 0) {
        Object.assign(walker, { x, z, yaw, pitch });
      },
    },
  });
}

// --- main loop ---
let last = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.1, (now - last) / 1000);
  // the samosbor keeps to the clock however slow the frames: the server ends it on time
  const realDt = (now - last) / 1000;
  last = now;
  const t = now / 1000;

  // In an exit zone the next cycle starts on the spot (and so does the way out after the last floor);
  // otherwise, and always after a samosbor, fade to black, swap, fade back in.
  const onSpot = world !== null && shownPhase === 'playing' && exitAt(walker.x, walker.z) !== null && cycleMsg !== null && cycleMsg.cycleId !== shownCycleId;
  if (onSpot && cycleMsg!.phase === 'playing') enterCycle(cycleMsg!, 'loop');
  else if (onSpot && cycleMsg!.phase === 'won') enterCycle(cycleMsg!, 'stay');
  const switching = cycleMsg !== null && cycleMsg.cycleId !== shownCycleId;
  fade = THREE.MathUtils.clamp(fade + (switching ? 1 : -1) * dt * FADE_SPEED, 0, 1);
  if (switching && (fade >= 1 || !world)) enterCycle(cycleMsg!);

  const active = !!document.pointerLockElement && document.activeElement !== ui.chatInput;
  walker.update(dt, active && !switching);
  if (voice) avatars.setTalk(voice.levels());
  avatars.update(dt, t);
  if (world) avatars.light(world.probe);
  if (samosbor) {
    samosbor.update(samosborHeld ? 0 : realDt);
    if (!warned && samosbor.t >= 0.5) {
      warned = true;
      showMessage('ВНИМАНИЕ! САМОСБОР!', 'Всем жильцам немедленно укрыться в гермоблоках', 'var(--bad)', 4.2);
    }
  }
  ui.veil.style.opacity = String(samosbor?.veil ?? 0);
  ui.warp.style.opacity = String(samosbor?.warp ?? 0);
  if (world) for (const u of world.updaters) u(t, dt, camera);
  if (world?.won && !finalShown && stairDepth(walker.x, walker.z) <= -STAIRS.drop + 0.01) showFinal();

  ui.fade.style.opacity = String(fade);
  sound?.update(camera, t);
  voice?.update(avatars.heads());

  markTimer = Math.max(0, markTimer - dt);
  if (messageTimer > 0 && (messageTimer -= dt) <= 0) ui.message.style.opacity = '0';
  if (captionTimer > 0 && (captionTimer -= dt) <= 0) ui.caption.style.opacity = '0';

  posTimer -= dt;
  if (net && world && posTimer <= 0) {
    posTimer = 1 / POS_HZ;
    net.send({ t: 'pos', c: shownCycleId, x: walker.x, z: walker.z, yaw: walker.yaw, pitch: walker.pitch });
  }

  const mic = !voice?.stream ? 'нет' : voice.muted ? 'выкл' : 'вкл';
  ui.status.textContent = `микрофон: ${mic} (M) · звук: ${sound?.muted ? 'выкл' : 'вкл'} (N)${net?.status === 'offline' ? ' · нет связи' : ''}`;

  renderer.info.reset();
  if (quality === 'high') post.render();
  else renderer.render(scene, camera);
  if (!ui.debug.classList.contains('hidden')) debugOverlay(dt);
});

// F3: what the renderer is doing, to check performance on a real machine
let debugTimer = 0;
let frames = 0;
function debugOverlay(dt: number) {
  frames++;
  if ((debugTimer += dt) < 0.5) return;
  const info = renderer.info.render;
  // the budget is the scene's; post-processing adds a dozen full-screen passes on top
  const calls = quality === 'high' ? `${post.sceneCalls} (+${info.calls - post.sceneCalls} постобработка)` : `${info.calls}`;
  ui.debug.textContent = [
    `${Math.round(frames / debugTimer)} к/с`,
    `вызовов отрисовки ${calls}, треугольников ${info.triangles}`,
    `запекание ${bakeMs.toFixed(0)} мс`,
    `графика ${quality === 'high' ? 'высокая' : 'низкая'}, плотность ${renderer.getPixelRatio()}`,
    `x ${walker.x.toFixed(2)} z ${walker.z.toFixed(2)}`,
  ].join('\n');
  debugTimer = 0;
  frames = 0;
}
