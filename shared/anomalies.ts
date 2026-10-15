/**
 * Catalogue of anomalies (docs/DESIGN.md, 6). The server only needs ids, names and tiers; how each
 * one changes the cell lives in src/anomalies.ts under the same id.
 * Tier 1 is obvious at a glance, 2 needs attention, 3 needs to know the cell by heart.
 */
export interface AnomalyInfo {
  id: string;
  name: string;
  tier: 1 | 2 | 3;
  /** Fewest players it makes sense with: one that copies or watches a teammate needs one. 1 by default. */
  players?: number;
  /**
   * 'always': it only ever happens on one screen; 'never': it needs everyone to see it. Otherwise
   * it is shown to one player by chance (shared/rules.ts, privateChance).
   */
  only?: 'always' | 'never';
  /**
   * Can be shown as a morok, and with which tell: 'sight' shimmers and makes no sound and no light,
   * 'sound' plays dry, without the room's reverb or the walls' muffling. A morok only ever adds or
   * changes: what takes something away, and what is made of light, is never one.
   */
  morok?: 'sight' | 'sound';
  /**
   * Comes only to a player with nobody near (shared/walk.ts, alone): sent to everyone, never private,
   * and each screen holds it back until its own player is alone, then plays it once.
   */
  alone?: true;
  /**
   * Plays back a teammate's own voice, recorded on the witness's machine (the voice mimic): only for
   * a witness who has heard someone (the 'heard' message). Always private.
   */
  mimic?: true;
}

export const ANOMALIES: AnomalyInfo[] = [
  // landing and floor corridor
  { id: 'floor_wrong', name: 'Неверный этаж', tier: 3, morok: 'sight' },
  { id: 'floor_mirror', name: 'Зеркальный этаж', tier: 2, morok: 'sight' },
  { id: 'neighbour_ajar', name: 'Дверь соседей приоткрыта', tier: 2, morok: 'sight' },
  { id: 'notice_other', name: 'Другое объявление', tier: 2, morok: 'sight' },
  { id: 'chute_hum', name: 'Гудит мусоропровод', tier: 2, morok: 'sound' },
  { id: 'lamp_broken', name: 'Разбита лампочка', tier: 1 },
  { id: 'mailbox_open', name: 'Почтовый ящик открыт', tier: 3, morok: 'sight' },
  // hall and pantry
  { id: 'slippers_extra', name: 'Лишние тапочки', tier: 2, morok: 'sight' },
  { id: 'receiver_off', name: 'Снята трубка', tier: 1, morok: 'sight' },
  { id: 'phone_ringing', name: 'Звонит телефон', tier: 1, morok: 'sound' },
  { id: 'meter_backwards', name: 'Счётчик крутится назад', tier: 3, morok: 'sight' },
  { id: 'chain_extra', name: 'Лишняя цепочка', tier: 3, morok: 'sight' },
  { id: 'mirror_extra', name: 'Лишний в зеркале', tier: 3, morok: 'sight' },
  { id: 'pantry_open', name: 'Кладовка открыта', tier: 2, morok: 'sight' },
  // kitchen
  { id: 'burner_on', name: 'Горит конфорка', tier: 1, morok: 'sight' },
  { id: 'fridge_open', name: 'Холодильник открыт', tier: 1, morok: 'sight' },
  { id: 'calendar_year', name: 'Не тот год', tier: 3, morok: 'sight' },
  { id: 'plate_extra', name: 'Лишняя тарелка', tier: 2, morok: 'sight' },
  { id: 'radio_reversed', name: 'Радио задом наперёд', tier: 2, morok: 'sound' },
  { id: 'radio_name', name: 'Радио называет имя', tier: 3, morok: 'sound' },
  { id: 'tap_running', name: 'Кран льёт', tier: 2, morok: 'sight' },
  { id: 'kettle_whistle', name: 'Чайник свистит', tier: 1, morok: 'sound' },
  // bathroom and toilet
  { id: 'tub_full', name: 'Ванна полна', tier: 2, morok: 'sight' },
  { id: 'curtain_closed', name: 'Шторка задёрнута', tier: 2, morok: 'sight' },
  { id: 'mirror_writing', name: 'Надпись на зеркальце', tier: 3, morok: 'sight' },
  { id: 'cistern_running', name: 'Бачок течёт', tier: 3, morok: 'sound' },
  // living room
  { id: 'carpet_flipped', name: 'Ковёр вверх ногами', tier: 2, morok: 'sight' },
  { id: 'carpet_other', name: 'Другой ковёр', tier: 3, morok: 'sight' },
  { id: 'tv_on', name: 'Телевизор включён', tier: 1, morok: 'sight' },
  { id: 'crystal_gone', name: 'Хрусталь пропал', tier: 2 },
  { id: 'chandelier_swing', name: 'Люстра качается', tier: 2, morok: 'sight' },
  { id: 'armchair_turned', name: 'Кресло к стене', tier: 3, morok: 'sight' },
  { id: 'portrait_eyes', name: 'Портрет смотрит', tier: 3, morok: 'sight' },
  { id: 'clock_stopped', name: 'Часы остановились', tier: 3 },
  // bedroom and loggia
  { id: 'wardrobe_ajar', name: 'Шифоньер приоткрыт', tier: 2, morok: 'sight' },
  { id: 'eyes_under_bed', name: 'Глаза под кроватью', tier: 2, morok: 'sight' },
  { id: 'bed_unmade', name: 'Кровать разобрана', tier: 3, morok: 'sight' },
  { id: 'cot_rocking', name: 'Кроватка качается', tier: 1, morok: 'sight' },
  { id: 'jars_extra', name: 'Банки на лоджии', tier: 3, morok: 'sight' },
  // light
  { id: 'light_off', name: 'Свет не горит', tier: 1 },
  { id: 'lamp_flicker', name: 'Мигает лампа', tier: 2 },
  { id: 'light_wrong', name: 'Не тот свет', tier: 3 },
  // windows
  { id: 'window_watcher', name: 'Кто-то в окне напротив', tier: 2, morok: 'sight' },
  { id: 'windows_dark', name: 'Все окна погасли', tier: 1 },
  { id: 'window_wall', name: 'Стена вместо двора', tier: 1, morok: 'sight' },
  { id: 'fog_horizon', name: 'Туман у горизонта', tier: 3 },
  // players and sounds
  { id: 'double', name: 'Двойник', tier: 2, morok: 'sight' },
  { id: 'gaze', name: 'Смотрит на тебя', tier: 2, players: 2, only: 'always' },
  { id: 'faceless', name: 'Без лица', tier: 2, players: 2, only: 'never', morok: 'sight' },
  { id: 'extra', name: 'Лишний', tier: 2, players: 2 },
  { id: 'dont_look', name: 'Не смотри', tier: 3, players: 2, morok: 'sight' },
  { id: 'together', name: 'Только вдвоём', tier: 3, players: 2, only: 'never' },
  { id: 'follower', name: 'Шаги за спиной', tier: 3, morok: 'sound' },
  { id: 'radiator_knock', name: 'Стук по батарее', tier: 2, morok: 'sound' },
  { id: 'drill', name: 'Соседи сверлят', tier: 1, morok: 'sound' },
  { id: 'crying', name: 'Плач за стеной', tier: 2, morok: 'sound' },
  { id: 'silence', name: 'Тишина', tier: 3 },
  // alone: only to whoever wanders off
  { id: 'alone_breath', name: 'Дыхание за спиной', tier: 2, alone: true, morok: 'sound' },
  { id: 'alone_door', name: 'Дверь закрылась за спиной', tier: 2, alone: true },
  { id: 'alone_call', name: 'Зовут из соседней комнаты', tier: 3, alone: true, morok: 'sound' },
  { id: 'alone_steps', name: 'Шаги, когда ты один', tier: 2, alone: true, morok: 'sound' },
  // stings: the few sharp sounds the game allows
  { id: 'sting_slam', name: 'Дверь хлопнула', tier: 1 },
  { id: 'sting_ring', name: 'Телефон звякнул', tier: 1, morok: 'sound' },
  { id: 'sting_knock', name: 'Стук у самого уха', tier: 2, morok: 'sound' },
  // the voice mimic: a teammate's words from where nobody is
  { id: 'voice_mimic', name: 'Чужой голос знакомый', tier: 3, players: 2, only: 'always', mimic: true, morok: 'sound' },
];
