import { calculateDamageReduction } from '../autogear/priorityScore';
import { evaluateCondition, scaledBonus, conditionsMet } from '../abilities/evaluateConditions';
import { buildRoundContext } from '../abilities/roundContext';
import { Buff, EnemyBaseClass, SelectedGameBuff } from '../../types/calculator';
import { ShipSkills } from '../../types/abilities';
import {
    selectFiringSkill,
    damageInputsFromSkill,
    secondaryFromSkill,
    dotsFromSkill,
    chargeAbilitiesFromSkill,
    detonationsFromSkill,
    accumulatorsFromSkill,
    modifierTotalsFromAbilities,
    gateFiringAbilities,
} from '../abilities/applyAbilities';
import { makeRateGate } from '../calculators/rateAccumulator';
import { toSimBuffs, toEnemyModifiers, toEnemyDotModifier } from '../calculators/dpsBuffHelpers';
import type { RoundData } from '../calculators/dpsSimulator';
import { ActiveDoTStack, createActor, selectNextActor } from './state';
import { ActiveBuff, createStatusEngine } from './statusEngine';
import { CombatEventBus } from './events';

function calculateBuffTotals(buffs: Buff[]) {
    const attackBuff = buffs
        .filter((b) => b.stat === 'attack')
        .reduce((sum, b) => sum + b.value, 0);
    const critBuff = buffs.filter((b) => b.stat === 'crit').reduce((sum, b) => sum + b.value, 0);
    const critDamageBuff = buffs
        .filter((b) => b.stat === 'critDamage')
        .reduce((sum, b) => sum + b.value, 0);
    const outgoingDamageBuff = buffs
        .filter((b) => b.stat === 'outgoingDamage')
        .reduce((sum, b) => sum + b.value, 0);
    const defenceBuff = buffs
        .filter((b) => b.stat === 'defence')
        .reduce((sum, b) => sum + b.value, 0);
    const hpBuff = buffs.filter((b) => b.stat === 'hp').reduce((sum, b) => sum + b.value, 0);
    return { attackBuff, critBuff, critDamageBuff, outgoingDamageBuff, defenceBuff, hpBuff };
}

function tickDoTStacks(entries: ActiveDoTStack[], baseValue: number): number {
    return entries.reduce((sum, e) => sum + e.stacks * (e.tier / 100) * baseValue, 0);
}

function totalStacks(entries: ActiveDoTStack[]): number {
    return entries.reduce((sum, e) => sum + e.stacks, 0);
}

function expireStacks(entries: ActiveDoTStack[]): void {
    for (let i = entries.length - 1; i >= 0; i--) {
        entries[i].remainingRounds -= 1;
        if (entries[i].remainingRounds <= 0) {
            entries.splice(i, 1);
        }
    }
}

export interface CombatEngineInput {
    attack: number;
    crit: number;
    critDamage: number;
    defensePenetration: number;
    chargeCount: number;
    shipSkills: ShipSkills;
    enemyDefense: number;
    enemyHp: number;
    numRounds: number;
    /** Scheduled (manual + team) buffs — statusEngine input. */
    selfBuffs: SelectedGameBuff[];
    enemyDebuffs: SelectedGameBuff[];
    debuffLandingChance: number;
    selfDotModifier: number;
    defensePenetrationBuff: number;
    hasChargedSkill: boolean;
    startCharged: boolean;
    affinityDamageModifier: number;
    affinityCritCap: number;
    affinityCritPenalty: number;
    defence: number;
    hp: number;
    allyChargePerRound?: number;
    enemyType?: EnemyBaseClass;
    /** Emit-only event tap. Listeners must not read or mutate combat state. */
    bus?: CombatEventBus;
}

/**
 * The combat-engine turn loop. Phase 1 is attacker-only (combat-system.md §10):
 * exactly two actors, the attacker (speed 100, acts every turn) and the enemy
 * dummy (speed 0, never acts; carries the DoT containers that used to be loop
 * locals in runSinglePass). The math is a byte-identical relocation of the old
 * runSinglePass — events are write-only taps that never read or change a sim value.
 */
export function runCombat(input: CombatEngineInput): {
    rounds: RoundData[];
    rawTotals: {
        direct: number;
        corrosion: number;
        inferno: number;
        detonation: number;
        cumulative: number;
        totalSecondary: number;
        totalConditional: number;
    };
} {
    const {
        attack,
        crit,
        critDamage,
        defensePenetration,
        chargeCount,
        shipSkills,
        enemyDefense,
        enemyHp,
        numRounds,
        selfBuffs,
        enemyDebuffs,
        debuffLandingChance,
        selfDotModifier,
        defensePenetrationBuff,
        hasChargedSkill,
        startCharged,
        affinityDamageModifier,
        affinityCritCap,
        affinityCritPenalty,
        defence,
        hp,
        allyChargePerRound,
        enemyType,
        bus,
    } = input;

    // Actors. The attacker acts every turn (speed 100); the enemy is a speed-0
    // dummy that never acts but holds the DoT containers (previously loop-locals).
    const attacker = createActor({
        id: 'attacker',
        side: 'player',
        stats: { attack, crit, critDamage, defensePenetration, defence, hp, speed: 100 },
    });
    const enemy = createActor({
        id: 'enemy',
        side: 'enemy',
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            defence: enemyDefense,
            hp: enemyHp,
            speed: 0,
        },
    });

    // Incremental status machine — replaces the precomputed computeBuffTimeline array.
    const statusEngine = createStatusEngine({
        selfBuffs,
        enemyDebuffs,
        chargeCount: hasChargedSkill ? chargeCount : 0,
        startCharged,
        totalRounds: numRounds,
    });

    // Lookup maps (moved from simulateDPS) — expand the snapshot's buff names back
    // into the underlying SelectedGameBuff effects.
    const selfBuffLookup = new Map<string, SelectedGameBuff[]>();
    for (const b of selfBuffs) {
        const existing = selfBuffLookup.get(b.buffName) ?? [];
        selfBuffLookup.set(b.buffName, [...existing, b]);
    }
    const enemyDebuffLookup = new Map<string, SelectedGameBuff[]>();
    for (const b of enemyDebuffs) {
        const existing = enemyDebuffLookup.get(b.buffName) ?? [];
        enemyDebuffLookup.set(b.buffName, [...existing, b]);
    }

    // All mutable state declared fresh on every call
    let charges = startCharged ? chargeCount : 0;
    let cumulativeDamage = 0;
    // Deterministic event gates — replace Math.random / expected-value math so
    // identical inputs always produce identical output. Crit uses one gate PER
    // ACTION STREAM so the charged hit crits at exactly the crit rate regardless
    // of how the charge cadence aligns with the crit schedule (no aliasing).
    const activeCritGate = makeRateGate();
    const chargedCritGate = makeRateGate();
    const debuffLandingGate = makeRateGate();
    const extendChanceGate = makeRateGate();
    let totalDirectRaw = 0;
    let totalCorrosionRaw = 0;
    let totalInfernoRaw = 0;
    let totalDetonationRaw = 0;
    let totalSecondaryRaw = 0;
    let totalConditionalRaw = 0;
    // DoT containers live on the enemy actor (were loop-locals in runSinglePass).
    const corrosionEntries = enemy.corrosionEntries;
    const infernoEntries = enemy.infernoEntries;
    const pendingBombs = enemy.pendingBombs;
    const pendingAccumulators = enemy.pendingAccumulators;
    // hp-changed / ship-destroyed event tracking (emission-only, no sim effect).
    let lastEnemyHpPctInt = 100;
    let destroyedEmitted = false;

    const roundData: RoundData[] = [];

    for (let r = 1; r <= numRounds; r++) {
        // Turn-meter selection. Phase 1: always the attacker (enemy speed 0).
        const actor = selectNextActor([attacker, enemy]);
        bus?.emit({ type: 'turn-started', actorId: actor.id, round: r });

        // --- preTurn: action selection + charge consumption (old lines 263-273) ---
        let action: 'active' | 'charged';

        if (hasChargedSkill && charges >= chargeCount) {
            action = 'charged';
            charges = 0;
        } else {
            action = 'active';
            if (hasChargedSkill) {
                charges += 1;
            }
        }

        bus?.emit({ type: 'skill-fired', actorId: actor.id, round: r, slot: action });

        // Enemy HP% entering this round, derived from damage dealt so far. Floors at 0
        // once cumulative damage exceeds the pool (the sim keeps hitting the "dead" dummy).
        const enemyHpPct = enemyHp > 0 ? Math.max(0, 100 * (1 - cumulativeDamage / enemyHp)) : 100;

        const firingSkill = selectFiringSkill(shipSkills, action);
        // noCrit is read from the UNGATED skill: the flag is a property of the attack
        // itself and must be known before the ctx (and therefore the gate) exists.
        // Assumes one base-damage ability per skill (true for all parser output); a
        // gated-off first damage ability with a differently-flagged second one would
        // read the wrong flag — not representable from skill text today.
        const damageNoCrit = damageInputsFromSkill(firingSkill).noCrit;

        // Per-round buff totals from the status engine. step(r) decrements status at
        // the TOP of round r exactly like the old timeline[r-1] read — equivalent to a
        // post-turn decrement of round r-1 and parity-identical. Phase 2 moves this
        // decrement into the owner's Post Turn.
        const entry = statusEngine.step(r);

        const roundSelfBuffs = entry.activeSelfBuffs.flatMap((ab) => {
            const bufs = selfBuffLookup.get(ab.buffName) ?? [];
            // Accumulating buff: override static stacks with per-round count; skip when 0
            if (ab.stacks !== undefined) {
                return ab.stacks > 0 ? bufs.map((b) => ({ ...b, stacks: ab.stacks! })) : [];
            }
            return bufs;
        });
        let { attackBuff, critBuff, critDamageBuff, outgoingDamageBuff, defenceBuff, hpBuff } =
            calculateBuffTotals(toSimBuffs(roundSelfBuffs));

        const roundDebuffLanded = debuffLandingGate(debuffLandingChance);
        // Affinity-based ('apply') debuffs always hit EXCEPT at an affinity disadvantage,
        // where they are resisted (combat-system.md hit-check). affinityDamageModifier is
        // -25 only on a disadvantage matchup.
        const affinityDisadvantage = affinityDamageModifier < 0;
        const landedEnemyDebuffs: ActiveBuff[] = [];
        const resistedEnemyDebuffs: ActiveBuff[] = [];
        const roundEnemyDebuffs = entry.activeEnemyDebuffs.flatMap((ab) => {
            const bufs = enemyDebuffLookup.get(ab.buffName) ?? [];
            // 'apply' = affinity-based: guaranteed unless the attacker is at an affinity
            // disadvantage. 'inflict' (and unmarked) = hacking-based: gated by the
            // hacking-vs-security landing roll.
            const isApply = bufs.some((b) => b.application === 'apply');
            const lands = isApply ? !affinityDisadvantage : roundDebuffLanded;
            if (!lands) {
                resistedEnemyDebuffs.push(ab);
                bus?.emit({
                    type: 'debuff-resisted',
                    targetId: enemy.id,
                    round: r,
                    buffName: ab.buffName,
                });
                return [];
            }
            landedEnemyDebuffs.push(ab);
            bus?.emit({
                type: 'debuff-applied',
                targetId: enemy.id,
                round: r,
                buffName: ab.buffName,
            });
            if (ab.stacks !== undefined) {
                return ab.stacks > 0 ? bufs.map((b) => ({ ...b, stacks: ab.stacks! })) : [];
            }
            return bufs;
        });
        const { enemyDefenseModifier, incomingDamageModifier } =
            toEnemyModifiers(roundEnemyDebuffs);

        // Effective crit rate from a given crit-buff total, clamped by affinity.
        const cappedCrit = (critBuffTotal: number) =>
            Math.min(affinityCritCap, Math.max(0, crit + critBuffTotal - affinityCritPenalty));

        // Fold active passive modifiers (firing skill + passive slot) into the round's
        // buff totals so they affect damage exactly like an equivalent buff. Folded here,
        // after enemy modifiers are known but before the effective-stat computations consume
        // the buff totals. The PRE-modifier crit estimate (cappedCrit(critBuff)) is used only
        // for the rare self-crit-gated modifier condition, avoiding a self-referential gate.
        const modifierCtx = buildRoundContext({
            selfBuffNames: entry.activeSelfBuffs
                .filter((ab) => ab.stacks === undefined || ab.stacks > 0)
                .map((ab) => ab.buffName),
            landedEnemyDebuffCount: landedEnemyDebuffs.length,
            corrosionEntryCount: corrosionEntries.length,
            infernoEntryCount: infernoEntries.length,
            bombCount: pendingBombs.length,
            effectiveCritRate: cappedCrit(critBuff),
            enemyType,
            enemyHpPct,
        });
        const passiveSkill = shipSkills.slots.find((s) => s.slot === 'passive');
        const modifierAbilities = [
            ...(firingSkill?.abilities ?? []),
            ...(passiveSkill?.abilities ?? []),
        ];
        const modTotals = modifierTotalsFromAbilities(modifierAbilities, modifierCtx);
        attackBuff += modTotals.attack;
        critBuff += modTotals.crit;
        critDamageBuff += modTotals.critDamage;
        outgoingDamageBuff += modTotals.outgoingDamage;
        defenceBuff += modTotals.defence;
        hpBuff += modTotals.hp;

        const effectiveAttack = attack * (1 + attackBuff / 100);
        const effectiveCrit = cappedCrit(critBuff);
        const effectiveCritDamage = critDamage + critDamageBuff;
        // This round's binary crit outcome. A noCrit attack cannot crit and consumes
        // no crit chance (the gate does not advance). Decided AFTER the modifier
        // fold-in so the schedule uses the final effective crit rate; modifierCtx
        // above deliberately keeps the probability-based estimate (see spec).
        const roundCrit = damageNoCrit
            ? false
            : (action === 'charged' ? chargedCritGate : activeCritGate)(effectiveCrit / 100);
        const effectivePen =
            defensePenetration + defensePenetrationBuff + modTotals.defensePenetration;
        const effectiveDefense =
            enemyDefense * (1 + enemyDefenseModifier / 100) * (1 - effectivePen / 100);
        const damageReduction =
            effectiveDefense > 0 ? calculateDamageReduction(effectiveDefense) : 0;

        // Step 1: Calculate direct damage
        const enemyDotMod = toEnemyDotModifier(roundEnemyDebuffs);
        const dotMult = 1 + (selfDotModifier + enemyDotMod) / 100;
        const affinityMult = 1 + affinityDamageModifier / 100;
        const effectiveDefence = defence * (1 + defenceBuff / 100);
        const effectiveHp = hp * (1 + hpBuff / 100);

        // Per-round condition context for the Phase 1 condition engine. Built once
        // after landedEnemyDebuffs and effectiveCrit are known, but BEFORE Step 3
        // applies this round's fresh DoTs — so derivable counts read pre-Step-3 state,
        // matching the prior inline behaviour.
        const ctx = buildRoundContext({
            selfBuffNames: entry.activeSelfBuffs
                .filter((ab) => ab.stacks === undefined || ab.stacks > 0)
                .map((ab) => ab.buffName),
            landedEnemyDebuffCount: landedEnemyDebuffs.length,
            corrosionEntryCount: corrosionEntries.length,
            infernoEntryCount: infernoEntries.length,
            bombCount: pendingBombs.length,
            effectiveCritRate: effectiveCrit,
            enemyType,
            roundCrit,
            enemyHpPct,
        });

        // Hard gate: payload abilities whose conditions fail contribute nothing this
        // round. Walked in text order with a same-cast DoT overlay (see applyAbilities).
        const { gatedSkill, ctxFor } = gateFiringAbilities(firingSkill, ctx);
        const {
            multiplier: rawMultiplier,
            hits,
            scalingAbility,
        } = damageInputsFromSkill(gatedSkill);
        const effectiveMultiplier = rawMultiplier * hits;
        const secondary = secondaryFromSkill(gatedSkill);
        const dotsConfig = dotsFromSkill(gatedSkill);

        let secondaryStatValue = 0;
        if (secondary) {
            const source = secondary.stat === 'defense' ? effectiveDefence : effectiveHp;
            secondaryStatValue = source * (secondary.pct / 100);
        }

        // Conditional scaling bonus, folded additively into the skill multiplier.
        // Read from the firing skill's damage ability's own scaling rule. Derivable
        // conditions read this round's sim state (pre-Step-3 DoT arrays, so this
        // round's freshly-applied DoTs are not yet counted); manual conditions use
        // a static count. Threads the POSITIONAL context (ctxFor) so a damage ability
        // AFTER a same-cast dot scales with the fresh dot counted.
        const conditionalBonusPct = scalingAbility
            ? scaledBonus(scalingAbility, ctxFor.get(scalingAbility.id) ?? ctx)
            : 0;

        // Passive payload hit (Judge: "At the start of the round, this Unit deals 60%
        // damage to all enemies with less than 50% HP"). The always-active passive slot
        // can carry a gated damage ability; gate it per round against the same ctx and
        // add the passing hit as an extra damage instance. "Start of the round" matches
        // the entering-round enemyHpPct the gate evaluates. Uses the round's crit
        // outcome and defense math like the firing hit; its own noCrit is respected.
        const { gatedSkill: gatedPassive, ctxFor: passiveCtxFor } = gateFiringAbilities(
            passiveSkill,
            ctx
        );
        const passiveHit = damageInputsFromSkill(gatedPassive);
        const passiveScalingBonus = passiveHit.scalingAbility
            ? scaledBonus(
                  passiveHit.scalingAbility,
                  passiveCtxFor.get(passiveHit.scalingAbility.id) ?? ctx
              )
            : 0;
        const passiveMultiplier = passiveHit.multiplier * passiveHit.hits + passiveScalingBonus;

        // Charge manipulation: charges only accumulate on ACTIVE rounds. A charged
        // round fires the charged skill, which consumes all charges (reset to 0 at
        // the top of the loop) — nothing banks toward the next charge on that round.
        // Self + ally gains are added here and the total is capped at chargeCount,
        // since charges never exceed what the charged skill requires.
        if (hasChargedSkill && action === 'active') {
            let bonusCharges = 0;
            for (const ability of chargeAbilitiesFromSkill(gatedSkill)) {
                if (ability.config.type !== 'charge') continue;
                // Gating already happened in gateFiringAbilities (full AND/OR + thresholds).
                // A thresholded gate contributes the flat amount once; an unthresholded
                // count/probability condition still SCALES it (binary self-crit, per-count
                // subjects). No condition → flat amount.
                const primary = ability.conditions[0];
                const scale =
                    !primary || primary.countComparator != null
                        ? 1
                        : evaluateCondition(primary, ctxFor.get(ability.id) ?? ctx);
                bonusCharges += scale * ability.config.amount;
            }
            charges = Math.min(charges + bonusCharges + (allyChargePerRound ?? 0), chargeCount);
        }

        const preCritDamage =
            effectiveAttack * ((effectiveMultiplier + conditionalBonusPct) / 100) +
            secondaryStatValue;
        // A "cannot critically hit" attack forces roundCrit false (decided at the gate),
        // so this multiplier alone carries the crit effect.
        const damageCritMultiplier = roundCrit ? 1 + effectiveCritDamage / 100 : 1;
        // Crit-independent damage pipeline (defense, outgoing/incoming, affinity) — shared
        // by the firing hit and the passive hit, which may differ in crit treatment (noCrit).
        const nonCritFactor =
            (1 - damageReduction / 100) *
            (1 + outgoingDamageBuff / 100) *
            (1 + incomingDamageModifier / 100) *
            affinityMult;
        const postDefenseFactor = damageCritMultiplier * nonCritFactor;
        const passiveCritMultiplier = passiveHit.noCrit ? 1 : damageCritMultiplier;
        const passiveDamage =
            effectiveAttack * (passiveMultiplier / 100) * passiveCritMultiplier * nonCritFactor;
        const directDamage = preCritDamage * postDefenseFactor + passiveDamage;
        const secondaryDamage = secondaryStatValue * postDefenseFactor;
        const conditionalDamage = effectiveAttack * (conditionalBonusPct / 100) * postDefenseFactor;

        // ability-performed: ONE event for the firing damage hit, full directDamage.
        bus?.emit({
            type: 'ability-performed',
            actorId: actor.id,
            targetId: enemy.id,
            round: r,
            abilityType: 'damage',
            damage: directDamage,
            didCrit: roundCrit,
            didHit: true,
        });

        // Step 2.9: Extend active ticking DoTs (Corrosion/Inferno) by extend-dot abilities —
        // applied BEFORE this round's new DoTs so only pre-existing ones grow. Bombs are
        // excluded (delaying a one-shot detonation adds nothing). Each ability is gated by its
        // conditions (using ctx with binary roundCrit); a `chanceFromCritPower` extension
        // (Valerian) fires at exactly critPowerFactor frequency via the deterministic
        // extendChanceGate schedule. Sourced from BOTH the firing skill and the
        // always-active passive slot (Valerian's extension is a passive).
        for (const ab of [...(firingSkill?.abilities ?? []), ...(passiveSkill?.abilities ?? [])]) {
            if (ab.config.type !== 'extend-dot') continue;
            if (!conditionsMet(ab.conditions, ctx)) continue;
            if (ab.config.chanceFromCritPower) {
                const critPowerFactor = Math.min(1, effectiveCritDamage / 100);
                if (!extendChanceGate(critPowerFactor)) continue;
            }
            for (const e of corrosionEntries) e.remainingRounds += ab.config.turns;
            for (const e of infernoEntries) e.remainingRounds += ab.config.turns;
        }

        // Step 2.95: Detonate active DoTs of a type — consume them and deal their full remaining
        // damage at once, scaled by powerPct. Done BEFORE this round's new DoTs apply, so a skill
        // that detonates and re-applies the same type (e.g. Incinerator) doesn't eat its own new
        // stack. The payout is DETONATION damage (the game category that also covers Bomb bursts).
        let detonationDamage = 0;
        for (const det of detonationsFromSkill(gatedSkill)) {
            const pct = det.powerPct / 100;
            if (det.dotType === 'inferno') {
                detonationDamage +=
                    infernoEntries.reduce(
                        (sum, e) =>
                            sum + e.stacks * (e.tier / 100) * effectiveAttack * e.remainingRounds,
                        0
                    ) *
                    dotMult *
                    affinityMult *
                    pct;
                infernoEntries.length = 0;
            } else if (det.dotType === 'corrosion') {
                const baseHp = Math.min(enemyHp, 500_000);
                detonationDamage +=
                    corrosionEntries.reduce(
                        (sum, e) => sum + e.stacks * (e.tier / 100) * baseHp * e.remainingRounds,
                        0
                    ) *
                    dotMult *
                    affinityMult *
                    pct;
                corrosionEntries.length = 0;
            } else if (det.dotType === 'bomb') {
                detonationDamage +=
                    pendingBombs.reduce((sum, b) => sum + b.stacks * b.damagePerStack, 0) *
                    affinityMult *
                    pct;
                pendingBombs.length = 0;
            }
        }

        // Step 3: Apply new DoT stacks from this round's skill (subject to landing roll)
        const dotsLanded = roundDebuffLanded;
        if (dotsLanded) {
            for (const dot of dotsConfig) {
                if (dot.stacks <= 0 || dot.tier <= 0) continue;
                if (dot.type === 'corrosion') {
                    corrosionEntries.push({
                        stacks: dot.stacks,
                        tier: dot.tier,
                        remainingRounds: dot.duration,
                    });
                    bus?.emit({
                        type: 'dot-applied',
                        targetId: enemy.id,
                        round: r,
                        dotType: 'corrosion',
                        stacks: dot.stacks,
                    });
                } else if (dot.type === 'inferno') {
                    infernoEntries.push({
                        stacks: dot.stacks,
                        tier: dot.tier,
                        remainingRounds: dot.duration,
                    });
                    bus?.emit({
                        type: 'dot-applied',
                        targetId: enemy.id,
                        round: r,
                        dotType: 'inferno',
                        stacks: dot.stacks,
                    });
                } else if (dot.type === 'bomb') {
                    pendingBombs.push({
                        countdown: Math.max(1, dot.duration),
                        damagePerStack: effectiveAttack * (dot.tier / 100),
                        stacks: dot.stacks,
                        tier: dot.tier,
                    });
                    bus?.emit({
                        type: 'dot-applied',
                        targetId: enemy.id,
                        round: r,
                        dotType: 'bomb',
                        stacks: dot.stacks,
                    });
                }
            }
        }

        // Step 3b: Apply Echoing Burst-style accumulators inflicted by this round's skill
        // (gated by the same landing roll as inflicted debuffs). Each starts gathering this
        // round's direct damage in Step 6b below.
        if (dotsLanded) {
            for (const acc of accumulatorsFromSkill(gatedSkill)) {
                pendingAccumulators.push({
                    roundsRemaining: Math.max(1, acc.turns),
                    pct: acc.pct,
                    accumulated: 0,
                });
            }
        }

        // Step 4: Tick corrosion (scales with enemy HP, capped at 5000 dmg per 1%)
        const corrosionBaseHp = Math.min(enemyHp, 500_000);
        const corrosionDamage =
            tickDoTStacks(corrosionEntries, corrosionBaseHp) * dotMult * affinityMult;
        if (corrosionDamage > 0) {
            bus?.emit({
                type: 'dot-ticked',
                targetId: enemy.id,
                round: r,
                dotType: 'corrosion',
                damage: corrosionDamage,
            });
        }

        // Step 5: Tick inferno (scales with attacker's effective attack, no outgoing buff)
        const infernoDamage =
            tickDoTStacks(infernoEntries, effectiveAttack) * dotMult * affinityMult;
        if (infernoDamage > 0) {
            bus?.emit({
                type: 'dot-ticked',
                targetId: enemy.id,
                round: r,
                dotType: 'inferno',
                damage: infernoDamage,
            });
        }

        // Expire DoT stacks after ticking
        expireStacks(corrosionEntries);
        expireStacks(infernoEntries);

        // Step 6: Process bombs — their burst is detonation damage (same category as Step 2.95).
        let bombBurst = 0;
        for (let i = pendingBombs.length - 1; i >= 0; i--) {
            pendingBombs[i].countdown -= 1;
            if (pendingBombs[i].countdown <= 0) {
                bombBurst += pendingBombs[i].stacks * pendingBombs[i].damagePerStack;
                pendingBombs.splice(i, 1);
            }
        }
        detonationDamage += bombBurst * affinityMult;

        // Step 6b: Echoing Burst accumulators gather this round's direct damage, then detonate
        // for pct% of the accumulated total on expiry (game-categorised as detonation damage).
        // directDamage already includes affinity, so no extra affinity multiplier is applied.
        let accumulatorBurst = 0;
        for (let i = pendingAccumulators.length - 1; i >= 0; i--) {
            pendingAccumulators[i].accumulated += directDamage;
            pendingAccumulators[i].roundsRemaining -= 1;
            if (pendingAccumulators[i].roundsRemaining <= 0) {
                accumulatorBurst +=
                    pendingAccumulators[i].accumulated * (pendingAccumulators[i].pct / 100);
                pendingAccumulators.splice(i, 1);
            }
        }
        detonationDamage += accumulatorBurst;

        if (detonationDamage > 0) {
            bus?.emit({
                type: 'dot-detonated',
                targetId: enemy.id,
                round: r,
                damage: detonationDamage,
            });
        }

        const totalRoundDamage = directDamage + corrosionDamage + infernoDamage + detonationDamage;
        cumulativeDamage += totalRoundDamage;
        totalDirectRaw += directDamage;
        totalSecondaryRaw += secondaryDamage;
        totalConditionalRaw += conditionalDamage;
        totalCorrosionRaw += corrosionDamage;
        totalInfernoRaw += infernoDamage;
        totalDetonationRaw += detonationDamage;

        // Track the enemy's remaining HP and emit hp-changed / ship-destroyed taps
        // (emission-only; the sim keeps hitting the dead dummy regardless).
        enemy.currentHp = Math.max(0, enemyHp - cumulativeDamage);
        const newEnemyHpPctInt =
            enemyHp > 0 ? Math.round(Math.max(0, 100 * (1 - cumulativeDamage / enemyHp))) : 100;
        if (newEnemyHpPctInt !== lastEnemyHpPctInt) {
            bus?.emit({
                type: 'hp-changed',
                targetId: enemy.id,
                round: r,
                oldPct: lastEnemyHpPctInt,
                newPct: newEnemyHpPctInt,
            });
            lastEnemyHpPctInt = newEnemyHpPctInt;
        }
        if (!destroyedEmitted && enemy.currentHp <= 0) {
            bus?.emit({ type: 'ship-destroyed', actorId: enemy.id, round: r });
            destroyedEmitted = true;
        }

        // Report stacks after expiry (state going into next round)
        roundData.push({
            round: r,
            action,
            charges: Math.round(charges),
            chargeCount: hasChargedSkill ? chargeCount : 0,
            didCrit: roundCrit,
            enemyHpPct: Math.round(enemyHpPct),
            directDamage: Math.round(directDamage),
            corrosionDamage: Math.round(corrosionDamage),
            infernoDamage: Math.round(infernoDamage),
            detonationDamage: Math.round(detonationDamage),
            totalRoundDamage: Math.round(totalRoundDamage),
            cumulativeDamage: Math.round(cumulativeDamage),
            activeCorrosionStacks: totalStacks(corrosionEntries),
            activeInfernoStacks: totalStacks(infernoEntries),
            activeBombCount: pendingBombs.length,
            activeSelfBuffs: entry.activeSelfBuffs,
            activeEnemyDebuffs: landedEnemyDebuffs,
            resistedEnemyDebuffs,
            appliedDoTs: dotsConfig,
            dotsLanded,
            activeDoTStates: [
                ...corrosionEntries.map((e) => ({
                    type: 'corrosion' as const,
                    tier: e.tier,
                    stacks: e.stacks,
                    ticksRemaining: e.remainingRounds,
                })),
                ...infernoEntries.map((e) => ({
                    type: 'inferno' as const,
                    tier: e.tier,
                    stacks: e.stacks,
                    ticksRemaining: e.remainingRounds,
                })),
                ...pendingBombs.map((b) => ({
                    type: 'bomb' as const,
                    tier: b.tier,
                    stacks: b.stacks,
                    ticksRemaining: b.countdown,
                })),
            ],
        });

        // --- postTurn: turn-meter reset. Status decrement stays inside
        // statusEngine.step (top-of-next-round ≡ this round's post-turn — see note
        // above; Phase 2 moves it into the owner's Post Turn). ---
        attacker.turnMeter = 0;

        bus?.emit({ type: 'turn-ended', actorId: actor.id, round: r });
    }

    return {
        rounds: roundData,
        rawTotals: {
            direct: totalDirectRaw,
            corrosion: totalCorrosionRaw,
            inferno: totalInfernoRaw,
            detonation: totalDetonationRaw,
            cumulative: cumulativeDamage,
            totalSecondary: totalSecondaryRaw,
            totalConditional: totalConditionalRaw,
        },
    };
}
