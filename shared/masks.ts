/**
 * What players wear, picked in the lobby: clothes and protective gear (docs/DESIGN.md, 3.3). How each
 * one looks lives in src/character.ts under the same id.
 */
export const OUTFITS = [
  { id: 'tracksuit', name: 'Спортивный костюм' },
  { id: 'quilted', name: 'Телогрейка' },
  { id: 'robe', name: 'Домашний халат' },
  { id: 'l1', name: 'Химзащита Л-1' },
] as const;

export const MASKS = [
  { id: 'gp5', name: 'Противогаз ГП-5' },
  { id: 'gauze', name: 'Марлевая повязка' },
  { id: 'petal', name: 'Респиратор «Лепесток»' },
  { id: 'welder', name: 'Сварочная маска' },
  { id: 'ushanka', name: 'Ушанка с шарфом' },
  { id: 'none', name: 'Без защиты' },
] as const;

export type OutfitId = (typeof OUTFITS)[number]['id'];
export type MaskId = (typeof MASKS)[number]['id'];

export function isOutfit(id: unknown): id is OutfitId {
  return OUTFITS.some((o) => o.id === id);
}

export function isMask(id: unknown): id is MaskId {
  return MASKS.some((m) => m.id === id);
}

/** Players are neighbours: each gets a flat on the floor corridor, the first free one. */
export const FLATS = [41, 42, 43, 44, 45, 46, 47, 48];
