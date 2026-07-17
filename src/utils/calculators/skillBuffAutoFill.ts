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
    // sourceChargeCount/sourceStartCharged are deprecated (ignored by the action-fed
    // status engine — per-team-actor chargeCount/startCharged via TeamActorInput are
    // authoritative). Still stamped here until the auto-fill shape is refactored.
    const sourceChargeCount = ship.chargeSkillCharge ?? 0;
    const sourceStartCharged = detectFullyCharged([
        ship.activeSkillText,
        ship.chargeSkillText,
        ship.firstPassiveSkillText,
        ship.secondPassiveSkillText,
        ship.thirdPassiveSkillText,
    ]);
    return {
        // selfBuffs = all PLAYER-SIDE effects (self/ally/all-allies). The legacy DPS picker
        // path treats every entry here as player-side (unchanged); the builder reads each
        // entry's effectTarget to route ally/all-allies grants to the right actors.
        selfBuffs: toSelectedBuffs(
            effects.filter((e) => e.target !== 'enemy' && e.target !== 'all-enemies')
        ),
        // enemyDebuffs = both single-target ('enemy') and whole-team ('all-enemies') debuffs —
        // the builder reads effectTarget to stamp the right ability target either way.
        enemyDebuffs: toSelectedBuffs(
            effects.filter((e) => e.target === 'enemy' || e.target === 'all-enemies'),
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
        // Dedupe by (name, target, source): the SAME buff granted on different slots or to
        // different scopes is a DISTINCT grant path. Deduping on buffName alone collapsed e.g.
        // "this Unit gains Attack Up II" (active/self) and "grants Attack Up II" (charged/all-allies)
        // into one entry, dropping a grant the builder needs to emit as its own ability.
        const dedupeKey = `${effect.buffName}|${effect.target}|${effect.source}`;
        if (seen.has(dedupeKey)) continue;
        if (isDoTBuffName(effect.buffName)) continue; // DoTs go to DoT config section
        const buff = BUFFS.find((b) => b.name === effect.buffName);
        if (!buff) continue;

        seen.add(dedupeKey);
        const parsedEffects = parseBuffEffects(buff.name, buff.description);
        const stackInfo = isStackable(buff.description);

        const stackTrigger =
            stackInfo.stackable && effect.stackTrigger ? effect.stackTrigger : undefined;

        result.push({
            // Unique per grant path: the legacy pickers key React lists, stacks-change, and
            // remove off `id` (GameBuffPicker), so same-name entries from different slots/scopes
            // must NOT share an id. Manually-added picker entries still use the bare buff name.
            id: `${buff.name}-${effect.source}-${effect.target}`,
            buffName: buff.name,
            // For accumulating buffs, stacks = rate per trigger. Otherwise, use whatever count
            // the text explicitly stated for THIS single application (e.g. Amartya's "2 stacks of
            // Exposed" — Exposed isn't mechanically "stackable" across triggers, but the count of
            // a single infliction is still real data the parser must not discard). Epic PR1
            // (skill-model gap, finding family 3b): previously hard-forced to 1 whenever
            // stackTrigger was absent, silently dropping any parsed count > 1.
            stacks: effect.stacks ?? 1,
            parsedEffects,
            isStackable: stackInfo.stackable,
            // Lionheart: a consumable Protection grant (maxStacks set by the parser) is a FIXED
            // pool that refreshes each round rather than accumulating past it — prefer the
            // parser's grant-count cap over the buff description's own stack ceiling. Meatshield
            // sets no effect.maxStacks, so it keeps stackInfo.maxStacks (byte-identical).
            maxStacks: effect.maxStacks ?? stackInfo.maxStacks,
            autoFilled: true,
            skillSource: effect.source,
            skillDuration: effect.duration,
            sourceChargeCount,
            sourceStartCharged,
            stackTrigger,
            ...(effect.application !== undefined ? { application: effect.application } : {}),
            // Carry the granular ally-scope so the builder can stamp the right ability target.
            effectTarget: effect.target,
            ...(effect.clearAllOnRedirect ? { clearAllOnRedirect: true } : {}),
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
export const DOT_TIER_MAP: Record<string, { type: DoTType; tier: number }> = {
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
