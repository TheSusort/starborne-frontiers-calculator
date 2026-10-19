import { asFactionName, type FactionName } from '../../../constants/factions';

export interface NeonAccent {
    core: string;
    glow: string;
}

const accent = (r: number, g: number, b: number): NeonAccent => ({
    core: `rgb(${r}, ${g}, ${b})`,
    glow: `rgba(${r}, ${g}, ${b}, 0.28)`,
});

/** The neon fighter's hull outline per faction; unknown factions keep the default pink. */
const FACTION_ACCENTS: Partial<Record<FactionName, NeonAccent>> = {
    ATLAS_SYNDICATE: accent(255, 196, 64),
    BINDERBURG: accent(120, 200, 255),
    EVERLIVING: accent(90, 255, 140),
    FRONTIER_LEGION: accent(255, 90, 70),
    GELECEK: accent(190, 120, 255),
    MPL: accent(64, 240, 255),
    MARAUDERS: accent(255, 130, 40),
    TERRAN_COMBINE: accent(230, 230, 255),
    TIANCHAO: accent(255, 70, 160),
    XAOC: accent(160, 255, 60),
};

export const DEFAULT_ACCENT: NeonAccent = accent(255, 79, 216);

export function factionAccent(faction: string): NeonAccent {
    const key = asFactionName(faction);
    return (key && FACTION_ACCENTS[key]) || DEFAULT_ACCENT;
}
