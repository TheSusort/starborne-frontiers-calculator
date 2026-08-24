/**
 * Squad-leader pre-fight pass (sub-project F, PR F1).
 *
 * Resolves each side's `SquadLeaderSelection` against the SQUAD_LEADERS data and folds
 * the leader's active effects into that side's PreFightUnits. Game rules (binding):
 *   - stages are ADDITIVE deltas: stage III = I + II + III active simultaneously;
 *   - 'all-allies' lands ONLY on own-side units of the LEADER'S faction;
 *   - 'all-enemies' lands on ALL opposing units, but ONLY while the leader's own team
 *     fields >=1 ship of the leader's faction — gate unmet means the effect is inactive
 *     by game rule and records NOTHING (not even `unsimulated`);
 *   - percentages apply to the final gear-resolved pre-fight stats.
 *
 * Both sides run through ONE shared `applyLeaderForSide`, so team symmetry holds by
 * construction. Stat math is order-independent ACROSS BOTH LEADERS: per recipient per
 * stat, ALL active contributions from BOTH sides' leaders accumulate first (Σpct and
 * Σflat, into one accumulator owned by the pass), then apply exactly once as
 * `final = base × (1 + Σpct/100) + Σflat`, floored at 0. A unit hit by its own leader's
 * buff AND the opposing leader's debuff therefore folds them additively
 * (base×(1+(a+b)/100)), never as sequential multiplies — and no intermediate clamp can
 * break side symmetry.
 */
import { SQUAD_LEADERS } from '../../../constants/squadLeaders';
import type {
    SquadLeader,
    SquadLeaderEffect,
    SquadLeaderModifierChannel,
} from '../../../constants/squadLeaders';
import type { FactionName } from '../../../constants/factions';
import type {
    PreFightCombatModifiers,
    PreFightPass,
    PreFightStatBlock,
    PreFightUnit,
    SquadLeaderSelection,
} from './types';

/** Stats the pre-fight layer can fold. A data stat name outside this set (e.g. a future
 *  'healModifier' line) is surfaced via `unsimulated` instead of being applied. */
const PRE_FIGHT_STAT_KEYS = [
    'attack',
    'crit',
    'critDamage',
    'defensePenetration',
    'shieldPenetration',
    'hacking',
    'security',
    'defence',
    'hp',
    'speed',
] as const satisfies readonly (keyof PreFightStatBlock)[];

type PreFightStatKey = (typeof PRE_FIGHT_STAT_KEYS)[number];

const isPreFightStat = (stat: string): stat is PreFightStatKey =>
    (PRE_FIGHT_STAT_KEYS as readonly string[]).includes(stat);

/** Data channel → `PreFightCombatModifiers` field. `outgoingRepair` is the game's term
 *  for heal output ('outgoingHeal' is its data alias — both fold into `outgoingHeal`);
 *  `shieldGeneration` seeds the starting shield pool as % of max HP. `damageReduction`
 *  has no pre-fight field (0 occurrences in the data) and falls through to `unsimulated`. */
const MODIFIER_FIELD_BY_CHANNEL: Partial<
    Record<SquadLeaderModifierChannel, keyof PreFightCombatModifiers>
> = {
    outgoingDamage: 'outgoingDamage',
    incomingDamage: 'incomingDamage',
    outgoingCritDamage: 'outgoingCritDamage',
    incomingCritDamage: 'incomingCritDamage',
    outgoingRepair: 'outgoingHeal',
    outgoingHeal: 'outgoingHeal',
    incomingHeal: 'incomingHeal',
    shieldGeneration: 'startingShieldPctOfHp',
};

/** Per-recipient per-stat accumulation buckets (summed before the single apply). */
type StatAccumulator = Map<PreFightStatKey, { pct: number; flat: number }>;
type SideStatAcc = Map<PreFightUnit, StatAccumulator>;

// ---------------------------------------------------------------------------
// Shared targeting/classification helpers — the SINGLE source of truth for both
// the pass below and UI previews (SquadLeaderPicker). Keep in lock-step with
// `applyLeaderForSide`; any rule change must land in exactly one place here.
// ---------------------------------------------------------------------------

/** The effects active at a stage. Stages are ADDITIVE deltas: stage III = I+II+III. */
export function activeSquadLeaderEffects(
    leader: SquadLeader,
    stage: 1 | 2 | 3
): SquadLeaderEffect[] {
    return leader.stages.slice(0, stage).flat();
}

/** Who a squad-leader effect targets, given the leader's OWN side's units.
 *  - 'allies'  : the own-side units of the leader's faction ('self' has no deployed
 *                unit and attributes to the same set — see the pass comment below).
 *  - 'enemies' : ALL opposing units, but only while `gateMet` (>=1 leader-faction
 *                ship on the leader's own team) — gate unmet means inactive by game rule. */
export type SquadLeaderEffectTargeting<T> =
    { scope: 'allies'; recipients: T[] } | { scope: 'enemies'; gateMet: boolean };

export function squadLeaderEffectTargeting<T extends { faction: FactionName }>(
    effect: SquadLeaderEffect,
    leaderFaction: FactionName,
    own: readonly T[]
): SquadLeaderEffectTargeting<T> {
    if (effect.target === 'all-enemies') {
        return { scope: 'enemies', gateMet: own.some((u) => u.faction === leaderFaction) };
    }
    return { scope: 'allies', recipients: own.filter((u) => u.faction === leaderFaction) };
}

/** Whether the pass SIMULATES an effect (folds it into stats / a consumed modifier
 *  channel) or surfaces it via `unsimulated`. Mirrors the pass's branch order exactly:
 *  conditional / 'other' / per-round / 'self' effects are unsimulated; stat effects are
 *  simulated iff the stat is in the pre-fight block; modifier effects are simulated iff
 *  their channel maps onto a `PreFightCombatModifiers` field (the engine consumes every
 *  mapped channel since PR F3 — unmapped channels stay unsimulated). */
export function isSquadLeaderEffectSimulated(effect: SquadLeaderEffect): boolean {
    if (
        effect.condition !== undefined ||
        effect.kind === 'other' ||
        effect.recurrence === 'per-round' ||
        effect.target === 'self'
    ) {
        return false;
    }
    if (effect.kind === 'stat') return isPreFightStat(effect.stat);
    // kind === 'modifier': mapped channels are consumed by the engine (PR F3).
    return MODIFIER_FIELD_BY_CHANNEL[effect.channel] !== undefined;
}

/** Resolve ONE side's leader selection and fold its active effects into that side's
 *  (and, for enemy effects, the opposing side's) units. Shared by both sides. Stat
 *  contributions accumulate into `statAcc` — OWNED BY THE PASS and shared across both
 *  leaders — and are applied once by the pass after both sides have contributed. */
function applyLeaderForSide(
    own: PreFightUnit[],
    opposing: PreFightUnit[],
    sel: SquadLeaderSelection,
    statAcc: SideStatAcc
): void {
    // Trust boundary (mirrors simulateBattle's input validation): the selection comes
    // from persisted/user state, so an unknown faction or leader name must throw loudly.
    const leader = SQUAD_LEADERS[sel.faction]?.find((l) => l.name === sel.name);
    if (!leader) {
        throw new Error(
            `squadLeaderPass: unknown squad leader "${sel.name}" for faction "${sel.faction}"`
        );
    }

    // Stages are additive deltas: everything up to and including the selected stage is live.
    const effects = activeSquadLeaderEffects(leader, sel.stage);

    for (const effect of effects) {
        // Recipients by the shared targeting rule. 'self' has no deployed unit to land on
        // (squad leaders are not on the board — 0 occurrences in data), so it attributes
        // its unsimulated text to the own-side faction units, same as 'all-allies'. The
        // all-enemies gate: enemy effects are live only while the leader's own team
        // fields at least one ship of the leader's faction.
        const targeting = squadLeaderEffectTargeting(effect, sel.faction, own);
        let recipients: PreFightUnit[];
        if (targeting.scope === 'enemies') {
            if (!targeting.gateMet) continue; // gate unmet → inactive by game rule, record nothing
            recipients = opposing;
        } else {
            recipients = targeting.recipients;
        }

        // Not simulated in F1: conditional effects, the 'other' escape hatch, per-round
        // recurrence, and 'self' targeting. Surface the verbatim text on each recipient.
        if (
            effect.condition !== undefined ||
            effect.kind === 'other' ||
            effect.recurrence === 'per-round' ||
            effect.target === 'self'
        ) {
            for (const unit of recipients) unit.unsimulated.push(effect.text);
            continue;
        }

        if (effect.kind === 'stat') {
            // Defensive: a stat name outside the pre-fight block cannot be folded.
            if (!isPreFightStat(effect.stat)) {
                for (const unit of recipients) unit.unsimulated.push(effect.text);
                continue;
            }
            for (const unit of recipients) {
                let perStat = statAcc.get(unit);
                if (!perStat) {
                    perStat = new Map();
                    statAcc.set(unit, perStat);
                }
                let bucket = perStat.get(effect.stat);
                if (!bucket) {
                    bucket = { pct: 0, flat: 0 };
                    perStat.set(effect.stat, bucket);
                }
                if (effect.valueType === 'percentage') bucket.pct += effect.value;
                else bucket.flat += effect.value;
            }
        } else {
            // kind === 'modifier'
            const field = MODIFIER_FIELD_BY_CHANNEL[effect.channel];
            if (!field) {
                for (const unit of recipients) unit.unsimulated.push(effect.text);
                continue;
            }
            // SIMULATED (PR F3): every mapped channel is consumed by the engine — the
            // battle simulator attaches the accumulated block to the unit's actor and
            // the folds fire at the buff-channel/crit-family/shield-seed sites. Only
            // conditional effects (filtered above) and unmapped channels stay unsimulated.
            for (const unit of recipients) {
                unit.modifiers[field] += effect.value;
            }
        }
    }
}

/** Build the squad-leader pre-fight pass for the given per-side selections. With
 *  neither selection set the pass is an exact no-op (golden safety). */
export function squadLeaderPass(selections: {
    player?: SquadLeaderSelection;
    enemy?: SquadLeaderSelection;
}): PreFightPass {
    return ({ player, enemy }) => {
        // ONE accumulator for BOTH leaders: a unit hit by its own leader's buff and the
        // opposing leader's debuff must fold them as a single additive Σpct/Σflat
        // (base×(1+(a+b)/100)), not per-side sequential multiplies with intermediate
        // clamping — which would also let apply order break team symmetry.
        const statAcc: SideStatAcc = new Map();
        if (selections.player) applyLeaderForSide(player, enemy, selections.player, statAcc);
        if (selections.enemy) applyLeaderForSide(enemy, player, selections.enemy, statAcc);

        // Apply the accumulated stat math ONCE per recipient per stat (order-independent).
        for (const [unit, perStat] of statAcc) {
            for (const [stat, { pct, flat }] of perStat) {
                unit.stats[stat] = Math.max(0, unit.stats[stat] * (1 + pct / 100) + flat);
            }
        }
    };
}
