import { ShipType } from "../types/ship";

export const SHIP_TYPES: Record<string, ShipType> = {
    ATTACKER: {
        name: 'Attacker',
        iconUrl: 'https://cdn.discordapp.com/emojis/1082314151596142662.webp'
    },
    DEFENDER: {
        name: 'Defender',
        iconUrl: 'https://cdn.discordapp.com/emojis/1082314174920663053.webp'
    },
    DEBUFFER: {
        name: 'Debuffer',
        iconUrl: 'https://cdn.discordapp.com/emojis/1082314199100829787.webp'
    },
    SUPPORTER: {
        name: 'Supporter',
        iconUrl: 'https://cdn.discordapp.com/emojis/1082314233301188750.webp'
    }
} satisfies Record<string, ShipType>;

export type ShipTypeName = keyof typeof SHIP_TYPES;