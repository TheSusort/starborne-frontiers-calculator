import { Faction } from '../types/ship';

export const FACTIONS: Record<string, Faction> = {
  ATLAS_SYNDICATE: {
    name: 'Atlas Syndicate',
    iconUrl: 'https://cdn.discordapp.com/emojis/1133426145023492116.webp',
  },
  BINDERBURG: {
    name: 'Binderburg',
    iconUrl: 'https://cdn.discordapp.com/emojis/1133426146579583056.webp',
  },
  EVERLIVING: {
    name: 'Everliving',
    iconUrl: 'https://cdn.discordapp.com/emojis/1133426149050032168.webp',
  },
  FRONTIER_LEGION: {
    name: 'Frontier Legion',
    iconUrl: 'https://cdn.discordapp.com/emojis/1133426150522228737.webp',
  },
  GELECEK: {
    name: 'Gelecek',
    iconUrl: 'https://cdn.discordapp.com/emojis/1133426152371925132.webp',
  },
  MPL: {
    name: 'MPL',
    iconUrl: 'https://cdn.discordapp.com/emojis/1133426156201316462.webp',
  },
  MARAUDERS: {
    name: 'Marauders',
    iconUrl: 'https://cdn.discordapp.com/emojis/1133426154888495114.webp',
  },
  TERRAN_COMBINE: {
    name: 'Terran Combine',
    iconUrl: 'https://cdn.discordapp.com/emojis/1133426138149044374.webp',
  },
  TIANCHAO: {
    name: 'Tianchao',
    iconUrl: 'https://cdn.discordapp.com/emojis/1133426140946636820.webp',
  },
  XAOC: {
    name: 'XAOC',
    iconUrl: 'https://cdn.discordapp.com/emojis/1133426142423031818.webp',
  },
} satisfies Record<string, Faction>;

export type FactionName = keyof typeof FACTIONS;
