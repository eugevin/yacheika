/**
 * Catalogue of anomalies (docs/DESIGN.md, 6). The server only needs ids, names and tiers; how each
 * one changes the cell lives in src/anomalies.ts under the same id.
 * Tier 1 is obvious at a glance, 2 needs attention, 3 needs to know the cell by heart.
 */
export interface AnomalyInfo {
  id: string;
  name: string;
  tier: 1 | 2 | 3;
}

export const ANOMALIES: AnomalyInfo[] = [
  // landing and floor corridor
  { id: 'floor_wrong', name: 'Неверный этаж', tier: 3 },
  { id: 'floor_mirror', name: 'Зеркальный этаж', tier: 2 },
  { id: 'neighbour_ajar', name: 'Дверь соседей приоткрыта', tier: 2 },
  { id: 'notice_other', name: 'Другое объявление', tier: 2 },
  { id: 'chute_hum', name: 'Гудит мусоропровод', tier: 2 },
  { id: 'lamp_broken', name: 'Разбита лампочка', tier: 1 },
  { id: 'mailbox_open', name: 'Почтовый ящик открыт', tier: 3 },
  // hall and pantry
  { id: 'slippers_extra', name: 'Лишние тапочки', tier: 2 },
  { id: 'receiver_off', name: 'Снята трубка', tier: 1 },
  { id: 'phone_ringing', name: 'Звонит телефон', tier: 1 },
  { id: 'meter_backwards', name: 'Счётчик крутится назад', tier: 3 },
  { id: 'chain_extra', name: 'Лишняя цепочка', tier: 3 },
  { id: 'mirror_extra', name: 'Лишний в зеркале', tier: 3 },
  { id: 'pantry_open', name: 'Кладовка открыта', tier: 2 },
  // kitchen
  { id: 'burner_on', name: 'Горит конфорка', tier: 1 },
  { id: 'fridge_open', name: 'Холодильник открыт', tier: 1 },
  { id: 'calendar_year', name: 'Не тот год', tier: 3 },
  { id: 'plate_extra', name: 'Лишняя тарелка', tier: 2 },
  { id: 'radio_reversed', name: 'Радио задом наперёд', tier: 2 },
  { id: 'radio_name', name: 'Радио называет имя', tier: 3 },
  { id: 'tap_running', name: 'Кран льёт', tier: 2 },
  { id: 'kettle_whistle', name: 'Чайник свистит', tier: 1 },
  // bathroom and toilet
  { id: 'tub_full', name: 'Ванна полна', tier: 2 },
  { id: 'curtain_closed', name: 'Шторка задёрнута', tier: 2 },
  { id: 'mirror_writing', name: 'Надпись на зеркальце', tier: 3 },
  { id: 'cistern_running', name: 'Бачок течёт', tier: 3 },
  // living room
  { id: 'carpet_flipped', name: 'Ковёр вверх ногами', tier: 2 },
  { id: 'carpet_other', name: 'Другой ковёр', tier: 3 },
  { id: 'tv_on', name: 'Телевизор включён', tier: 1 },
  { id: 'crystal_gone', name: 'Хрусталь пропал', tier: 2 },
  { id: 'chandelier_swing', name: 'Люстра качается', tier: 2 },
  { id: 'armchair_turned', name: 'Кресло к стене', tier: 3 },
  { id: 'portrait_eyes', name: 'Портрет смотрит', tier: 3 },
  { id: 'clock_stopped', name: 'Часы остановились', tier: 3 },
  // bedroom and loggia
  { id: 'wardrobe_ajar', name: 'Шифоньер приоткрыт', tier: 2 },
  { id: 'eyes_under_bed', name: 'Глаза под кроватью', tier: 2 },
  { id: 'bed_unmade', name: 'Кровать разобрана', tier: 3 },
  { id: 'cot_rocking', name: 'Кроватка качается', tier: 1 },
  { id: 'jars_extra', name: 'Банки на лоджии', tier: 3 },
  // light
  { id: 'light_off', name: 'Свет не горит', tier: 1 },
  { id: 'lamp_flicker', name: 'Мигает лампа', tier: 2 },
  { id: 'light_wrong', name: 'Не тот свет', tier: 3 },
  // windows
  { id: 'window_watcher', name: 'Кто-то в окне напротив', tier: 2 },
  { id: 'windows_dark', name: 'Все окна погасли', tier: 1 },
  { id: 'window_wall', name: 'Стена вместо двора', tier: 1 },
  { id: 'fog_horizon', name: 'Туман у горизонта', tier: 3 },
  // players and sounds
  { id: 'double', name: 'Двойник', tier: 2 },
  { id: 'follower', name: 'Шаги за спиной', tier: 3 },
  { id: 'radiator_knock', name: 'Стук по батарее', tier: 2 },
  { id: 'drill', name: 'Соседи сверлят', tier: 1 },
  { id: 'crying', name: 'Плач за стеной', tier: 2 },
  { id: 'silence', name: 'Тишина', tier: 3 },
];
