/**
 * Passive-slot support is NOT governed by the firing skill's targeting pattern.
 *
 * User-verified game rule (2026-07-31, Volk): a ship's targeting pattern belongs to its CAST.
 * Volk's active grants Crit Rate Up III / Attack Up II inside
 * `Pattern-Line-Support-from-centre-Range-1`, but its passive "repairs 30% of its Max HP to the
 * ally with the most missing health" reaches ANY ally — the pattern does not constrain it.
 *
 * The one exception is a clause that says so in so many words — "… all allies **within the
 * active pattern**" (Graphite R2/R4's charge grant; AEGIS's and Cultivator's ally-scoped
 * triggers). The parser marks those `Ability.patternScoped`, and they keep the footprint filter.
 *
 * Both halves are asserted in a SINGLE run so the split is unambiguous: the same caster's active
 * buff stays inside the footprint while its passive heal escapes it.
 */
import { describe, it, expect } from 'vitest';
import { parsePattern, parseTarget } from '../../targetingParser';
import { runCombat, type CombatEngineInput } from '../engine';
import type { Ability, ShipSkills } from '../../../types/abilities';
import { createEventBus, type CombatEvent } from '../events';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import type { Ship } from '../../../types/ship';

const supportPattern = () => parsePattern('Pattern-Line-Support-Range-1');
const alliesTarget = () => parseTarget('allies');

const noopAttack = (): Ability => ({
    id: 'noop',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 0, hits: 1 },
});

/** Volk's active half: an all-allies buff cast through the support pattern. */
const allAlliesBuff = (): Ability => ({
    id: 'support-buff',
    type: 'buff',
    target: 'all-allies',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName: 'Speed Up I',
        parsedEffects: { speed: 15 },
        stacks: 1,
        isStackable: false,
        duration: 2,
    },
});

/** Volk's passive half: a repair with no pattern of its own. */
const passiveHeal = (over: Partial<Ability> = {}): Ability => ({
    id: 'passive-heal',
    type: 'heal',
    target: 'all-allies',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'heal', pct: 10, basis: 'target-hp' },
    ...over,
});

const teamActor = (id: string, position: string, skills: ShipSkills, speed: number) =>
    ({
        id,
        speed,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position,
        target: alliesTarget(),
        pattern: supportPattern(),
        walk: {
            shipSkills: skills,
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 0,
                hp: 50_000,
            },
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;

const baseInput = (heal: Ability, bus: ReturnType<typeof createEventBus>): CombatEngineInput => ({
    attack: 1000,
    crit: 0,
    critDamage: 150,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [{ slot: 'active', abilities: [noopAttack()] }] },
    numRounds: 1,
    selfBuffs: [],
    enemyDebuffs: [],
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: 40_000,
    healTargetId: 'attacker',
    mode: 'battle',
    position: 'M1',
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    teamActors: [
        // The Volk stand-in: active all-allies buff (pattern-scoped) + passive heal (not).
        teamActor(
            'supporter',
            'M3',
            {
                slots: [
                    { slot: 'active', abilities: [allAlliesBuff()] },
                    { slot: 'passive', abilities: [heal] },
                ],
            },
            300
        ),
        teamActor(
            'inpattern',
            'M4',
            { slots: [{ slot: 'active', abilities: [noopAttack()] }] },
            100
        ),
        teamActor(
            'offpattern',
            'M2',
            { slots: [{ slot: 'active', abilities: [noopAttack()] }] },
            100
        ),
    ],
    enemyAttackers: [
        {
            id: 'e1',
            stats: { attack: 0, crit: 0, critDamage: 0, speed: 1, defence: 0, hp: 1_000_000 },
            chargeCount: 0,
            startCharged: false,
            position: 'M4',
            target: parseTarget('front'),
            pattern: parsePattern('Pattern-Base'),
            shipSkills: { slots: [{ slot: 'active', abilities: [noopAttack()] }] },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
    ],
    bus,
});

function run(heal: Ability) {
    const bus = createEventBus();
    const buffed: string[] = [];
    const healed: string[] = [];
    bus.on('buff-applied', (e: Extract<CombatEvent, { type: 'buff-applied' }>) => {
        if (e.buffName === 'Speed Up I') buffed.push(e.actorId);
    });
    bus.on('heal-performed', (e: Extract<CombatEvent, { type: 'heal-performed' }>) => {
        if (e.casterId === 'supporter') healed.push(...e.targets);
    });
    runCombat(baseInput(heal, bus));
    return { buffed, healed };
}

describe('passive-slot support vs the firing skill support footprint', () => {
    it('the cast buff stays inside the footprint while the passive heal reaches an off-pattern ally', () => {
        const { buffed, healed } = run(passiveHeal());

        // The ACTIVE half is unchanged — the pattern still governs the cast.
        expect(buffed).toContain('supporter');
        expect(buffed).toContain('inpattern');
        expect(buffed).not.toContain('offpattern');

        // The PASSIVE half escapes it.
        expect(healed).toContain('offpattern');
        expect(healed).toContain('inpattern');
    });

    it('a passive marked `patternScoped` ("within the active pattern") keeps the footprint filter', () => {
        const { healed } = run(passiveHeal({ id: 'scoped-heal', patternScoped: true }));

        expect(healed).toContain('inpattern');
        expect(healed).not.toContain('offpattern');
    });
});

// =============================================================================
// Parser guard — the flag must stay tied to the literal corpus wording, not to a slot.
// Skill texts copied verbatim from docs/ship-skills.csv (parser source of truth).
// =============================================================================

const VOLK_P1 =
    'At the start of its turn, this Unit <unit-damage>repairs 30%</unit-damage> of its Max HP to the ally with the most missing health.';
const GRAPHITE_P2 =
    '<br /><br />\nAt the start of the round, if an enemy Unit has <unit-skill>Stealth</unit-skill>, this Unit <unit-aid>adds 1 charges</unit-aid> to the charged skill of all allies within the active pattern.';

function passiveAbilities(text: string, refits: number) {
    const ship = {
        refits: Array.from({ length: refits }, () => ({})),
        ...(refits >= 2 ? { secondPassiveSkillText: text } : { firstPassiveSkillText: text }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any as Ship;
    return buildShipAbilities(ship).slots.flatMap((s) => s.abilities);
}

describe('patternScoped is set from the skill text, not the slot', () => {
    it("Volk's passive repair carries NO patternScoped flag (its clause never names the pattern)", () => {
        const heal = passiveAbilities(VOLK_P1, 0).find((a) => a.type === 'heal');
        expect(heal).toBeDefined();
        // Volk's clause NAMES its recipient ("the ally with the most missing
        // health"), so it carries the 'lowest-hp-ally' selector. Orthogonal to patternScoped —
        // and doubly unscoped, since a named selector is never footprint-narrowed either.
        expect(heal!.target).toBe('lowest-hp-ally');
        expect(heal!.patternScoped).toBeUndefined();
    });

    it('Graphite\'s ally charge grant IS marked patternScoped ("within the active pattern")', () => {
        const charge = passiveAbilities(GRAPHITE_P2, 2).find((a) => a.type === 'charge');
        expect(charge).toBeDefined();
        expect(charge!.target).toBe('all-allies');
        expect(charge!.patternScoped).toBe(true);
    });
});
