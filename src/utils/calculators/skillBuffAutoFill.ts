import { SelectedGameBuff, DoTApplicationEntry, DoTType } from '../../types/calculator';
import { Ship } from '../../types/ship';
import { BUFFS } from '../../constants/buffs';
import { parseAllSkillEffects, SkillEffect, detectFullyCharged } from '../skillTextParser';
import { parseBuffEffects, isStackable } from './buffParser';

// DoT buff name prefixes — these go to the DoT config, not the buff picker
const DOT_PREFIXES = new Set(['Corrosion', 'Inferno', 'Bomb']);
function isDoTBuffName(name: string): boolean {
    return DOT_PREFIXES.has(name.split(' ')[0]);
}

export interface SkillBuffAutoFill {
    selfBuffs: SelectedGameBuff[];
    enemyDebuffs: SelectedGameBuff[];
}

export function buildSkillBuffAutoFill(ship: Ship): SkillBuffAutoFill {
    const effects = parseAllSkillEffects(ship);
    const sourceChargeCount = ship.chargeSkillCharge ?? 0;
    const sourceStartCharged = detectFullyCharged([
        ship.activeSkillText,
        ship.chargeSkillText,
        ship.firstPassiveSkillText,
        ship.secondPassiveSkillText,
        ship.thirdPassiveSkillText,
    ]);
    return {
        selfBuffs: toSelectedBuffs(effects.filter((e) => e.target === 'self')),
        enemyDebuffs: toSelectedBuffs(
            effects.filter((e) => e.target === 'enemy'),
            sourceChargeCount,
            sourceStartCharged
        ),
    };
}

function toSelectedBuffs(
    effects: SkillEffect[],
    sourceChargeCount?: number,
    sourceStartCharged?: boolean
): SelectedGameBuff[] {
    const seen = new Set<string>();
    const result: SelectedGameBuff[] = [];

    for (const effect of effects) {
        if (seen.has(effect.buffName)) continue;
        if (isDoTBuffName(effect.buffName)) continue; // DoTs go to DoT config section
        const buff = BUFFS.find((b) => b.name === effect.buffName);
        if (!buff) continue;

        seen.add(effect.buffName);
        const parsedEffects = parseBuffEffects(buff.name, buff.description);
        const stackInfo = isStackable(buff.description);

        const stackTrigger =
            stackInfo.stackable && effect.stackTrigger ? effect.stackTrigger : undefined;

        result.push({
            id: buff.name,
            buffName: buff.name,
            // For accumulating buffs, stacks = rate per trigger; otherwise always 1.
            stacks: stackTrigger ? (effect.stacks ?? 1) : 1,
            parsedEffects,
            isStackable: stackInfo.stackable,
            maxStacks: stackInfo.maxStacks,
            autoFilled: true,
            skillSource: effect.source,
            skillDuration: effect.duration,
            sourceChargeCount,
            sourceStartCharged,
            stackTrigger,
            ...(effect.application !== undefined ? { application: effect.application } : {}),
        });
    }

    return result;
}

/**
 * Merges auto-filled buff entries into an existing list.
 * Stale auto-filled entries whose buffName appears in the new set are replaced.
 * Manually-added entries always take precedence over auto-filled ones.
 */
export function mergeAutoFill(
    existing: SelectedGameBuff[],
    autoFilled: SelectedGameBuff[]
): SelectedGameBuff[] {
    // Remove ALL stale auto-filled entries; keep only manual ones
    const kept = existing.filter((b) => !b.autoFilled);
    // Append new auto-filled entries that aren't already present (manual entries take precedence)
    const keptNames = new Set(kept.map((b) => b.buffName));
    return [...kept, ...autoFilled.filter((b) => !keptNames.has(b.buffName))];
}

// Maps parsed buff names to their DoT type and numeric tier.
// Also used to exclude DoT buffs from the buff picker auto-fill (they go to the DoT config).
const DOT_TIER_MAP: Record<string, { type: DoTType; tier: number }> = {
    Corrosion: { type: 'corrosion', tier: 3 },
    'Corrosion I': { type: 'corrosion', tier: 3 },
    'Corrosion II': { type: 'corrosion', tier: 6 },
    'Corrosion III': { type: 'corrosion', tier: 9 },
    Inferno: { type: 'inferno', tier: 15 },
    'Inferno I': { type: 'inferno', tier: 15 },
    'Inferno II': { type: 'inferno', tier: 30 },
    'Inferno III': { type: 'inferno', tier: 45 },
    Bomb: { type: 'bomb', tier: 100 },
    'Bomb I': { type: 'bomb', tier: 100 },
    'Bomb II': { type: 'bomb', tier: 200 },
    'Bomb III': { type: 'bomb', tier: 300 },
};

export interface DoTAutoFill {
    activeDoTs: DoTApplicationEntry[];
    chargedDoTs: DoTApplicationEntry[];
}

/**
 * Parses a ship's skill texts and returns DoT entries (Inferno/Bomb/Corrosion) found on
 * active and charge skills, ready to populate the DoT config sections.
 */
export function buildDoTAutoFill(ship: Ship): DoTAutoFill {
    const effects = parseAllSkillEffects(ship);
    const activeDoTs: DoTApplicationEntry[] = [];
    const chargedDoTs: DoTApplicationEntry[] = [];

    for (const effect of effects) {
        if (effect.source !== 'active' && effect.source !== 'charge') continue;
        const dotInfo = DOT_TIER_MAP[effect.buffName];
        if (!dotInfo) continue;

        const entry: DoTApplicationEntry = {
            id: `autofill-${effect.source}-${dotInfo.type}-${dotInfo.tier}`,
            type: dotInfo.type,
            tier: dotInfo.tier,
            stacks: effect.stacks ?? 1,
            duration: typeof effect.duration === 'number' ? effect.duration : 2,
            autoFilled: true,
        };

        const list = effect.source === 'active' ? activeDoTs : chargedDoTs;
        // Deduplicate: one entry per type+tier per skill slot
        if (!list.some((d) => d.type === entry.type && d.tier === entry.tier)) {
            list.push(entry);
        }
    }

    return { activeDoTs, chargedDoTs };
}

/**
 * Replaces auto-filled DoT entries in an existing list with new auto-fills,
 * preserving any manually-added entries.
 */
export function mergeAutoFillDoTs(
    existing: DoTApplicationEntry[],
    newAutoFills: DoTApplicationEntry[]
): DoTApplicationEntry[] {
    return [...existing.filter((e) => !e.autoFilled), ...newAutoFills];
}
