/**
 * Chimei R2's recipient filters — parse + ENGINE integration.
 *
 * Her third passive names two recipient rules, and the model carried NEITHER: both clauses parsed
 * as plain `all-allies` grants with no filter at all, so in the sim every ally was Stealthed and
 * every ally was repaired.
 *
 *   "At the end of the round, non-defender allies below 40% HP are granted Stealth for 1 turn."
 *   "At the start of the round, all allies with Stealth repairs 10% of this unit's max HP."
 *
 * Owner rulings 2026-08-30, each posed as an in-fight example:
 *   • A Defender at 20% HP, an Attacker at 30% and an Attacker at 80% — only the 30% Attacker
 *     comes away with the Stealth icon. BOTH qualifiers are real recipient gates.
 *   • R2 fires with exactly one ally Stealthed — only that ally's health bar moves.
 *
 * Both clauses are REACTIVE (`end-of-round` / `start-of-round`), so they drain through
 * triggers.ts and never touch the cast-path recipient seam — which is why the filter is applied in
 * `footprintFilteredRecipients` rather than in `recipientsFor`.
 *
 * NON-VACUITY. A Stealth-gated repair in a fixture where nobody is Stealthed heals nobody and
 * passes green while measuring nothing, so every case below is stated as a PAIR: the same fixture
 * with and without the qualifying state, asserting that the recipient set actually differs. The
 * helper's own axis rules (including what it does with a reader it cannot consult) are pinned
 * separately in `recipientFilter.test.ts`.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';
import { Ship } from '../../../types/ship';
import type { Ability } from '../../../types/abilities';
import type { ShipTypeName } from '../../../constants/shipTypes';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

function requireReferenceData(): void {
    if (!csvAvailable()) {
        throw new Error(
            'docs/ship-skills.csv is missing from this worktree (gitignored reference data) — ' +
                "this test resolves Chimei's real skill text from it."
        );
    }
}

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

const noopActive = (): Ability => ({
    id: 'noop',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 0 },
});

function chimeiSkills(): CombatEngineInput['shipSkills'] {
    const rec = loadShipSkillRecords().find((r) => r.name.toUpperCase() === 'CHIMEI');
    if (!rec) throw new Error('docs/ship-skills.csv: no record for "Chimei"');
    return buildShipAbilities({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({} as any),
        refits: [{}, {}, {}, {}],
        activeSkillText: rec.active,
        chargeSkillText: rec.charge,
        chargeSkillCharge: rec.chargeCharge,
        firstPassiveSkillText: rec.passives[0],
        secondPassiveSkillText: rec.passives[1],
        thirdPassiveSkillText: rec.passives[2],
    } as Ship);
}

const passiveAbilities = (): Ability[] =>
    chimeiSkills().slots.find((s) => s.slot === 'passive')?.abilities ?? [];

/** A permanent self-Stealth on the actor's OWN store: a passive-slot, self-targeted, recurring
 *  grant registers as an aura under that owner's id, which is one of the three status sources the
 *  filter's `hasStatus` axis reads. Stealth carries no `parsedEffects` — it is a name-only marker,
 *  which is precisely why the axis must be a NAME lookup. */
const stealthAura = (ownerId: string): Ability => ({
    id: `${ownerId}-stealth-aura`,
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName: 'Stealth',
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        duration: 'recurring',
    },
});

/** A same-side ally that only ever RECEIVES. `stealthed` gives it a permanent self-Stealth. */
const ally = (opts: {
    id: string;
    position: Position;
    role?: ShipTypeName;
    stealthed?: boolean;
    maxHp?: number;
}): TeamActorEngineInput =>
    ({
        id: opts.id,
        speed: 1, // acts after Chimei
        chargeCount: 0,
        startCharged: false,
        // NOT via `TeamActorInput.selfBuffs` — that field's own doc says those are buffs granted
        // to the ATTACKER, keyed to this actor's turns, so seeding Stealth there puts it on
        // Chimei and the fixture measures the wrong actor entirely (it did, first time round).
        // The status has to live in THIS actor's own store, so it is granted by a self-targeted
        // aura in its own passive slot — see `stealthAura`.
        selfBuffs: [],
        enemyDebuffs: [],
        position: opts.position,
        ...(opts.role ? { role: opts.role } : {}),
        target: parsedTarget('front'),
        pattern: basePattern(),
        walk: {
            shipSkills: {
                slots: [
                    { slot: 'active', abilities: [noopActive()] },
                    ...(opts.stealthed
                        ? [{ slot: 'passive' as const, abilities: [stealthAura(opts.id)] }]
                        : []),
                ],
            },
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 0,
                hp: opts.maxHp ?? 20_000,
            },
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
    }) as unknown as TeamActorEngineInput;

const chimeiFight = (
    teamActors: TeamActorEngineInput[],
    over: Partial<CombatEngineInput> = {}
): CombatEngineInput => ({
    attack: 10_000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: chimeiSkills(),
    numRounds: 2,
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
    hp: 100_000,
    healTargetId: 'attacker',
    mode: 'healing',
    position: 'M3',
    target: parsedTarget('front'),
    pattern: basePattern(),
    speed: 100,
    teamActors,
    enemyAttackers: [
        {
            id: 'dummy',
            stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 1 },
            chargeCount: 0,
            startCharged: false,
            position: 'M4',
            target: parsedTarget('front'),
            pattern: basePattern(),
            shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
        },
    ],
    ...over,
});

/**
 * A single heavy pre-round hit, landing on every ally before Chimei's own turn (speed 1000 beats
 * her 100), that exists ONLY to keep her ACTIVE repair from 100%-overhealing.
 *
 * `directHeal` is RAW and unclipped — an ally at full HP still books the full 9,000/10,000 — so an
 * ally starting at full HP was never the correctness problem for the threshold check below.
 * The problem is the #435 over-repair redirect: it scales off the CLIPPED overheal
 * (`heal-performed`/`reactive-heal-performed`'s `overheal`, not `directHeal`), and a full-HP ally
 * wastes 100% of whatever lands on it. With both allies at full HP, Chimei's active alone (9,000 x
 * 2 recipients) wastes 18,000, and the redirect lands that entire sum on the lowest-HP ally —
 * which then clears the 10,000 threshold even though NO passive repair (Stealth-gated) ever fired.
 * That is exactly the failure this fixture used to have: 'repairs NOBODY when no ally is
 * Stealthed' measured `['stealthed-ally', 'stealthed-ally']` instead of `[]`.
 *
 * Knocking every ally well below full HP first (missing 15,000, comfortably above the active's
 * 9,000) means the active can no longer waste anything, so the redirect's zero-sum guard (R4:
 * "a zero-sum redirect... resolves nobody") suppresses it — restoring the threshold check's
 * ability to isolate the passive. One round only (not `chimeiFight`'s default 2): a second
 * identical hit on an already-damaged ally risks overkilling it, which is irrelevant to what this
 * helper measures and would only add fixture-death bookkeeping to reason about.
 */
const PRE_DAMAGE_ATTACKER: CombatEngineInput['enemyAttackers'][number] = {
    id: 'pre-damage',
    stats: { attack: 15_000, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 1000 },
    chargeCount: 0,
    startCharged: false,
    position: 'M4',
    target: parsedTarget('all'),
    // A genuine AOE shape — `basePattern()`'s `{ shape: 'base', range: 0 }` resolves to a single
    // primary victim regardless of `target.selection`, which would leave the OTHER ally at full
    // HP and reintroduce exactly the false-positive this fixture exists to prevent.
    pattern: { raw: 'all', shape: 'all', range: 'all', modifiers: {} },
    shipSkills: {
        slots: [
            {
                slot: 'active',
                abilities: [
                    {
                        id: 'pre-damage-hit',
                        type: 'damage',
                        target: 'enemy',
                        trigger: 'on-cast',
                        conditions: [],
                        config: { type: 'damage', multiplier: 100 },
                    },
                ],
            },
        ],
    },
};

/**
 * Recipients of the PASSIVE 10%-of-max-HP repair.
 *
 * NOT read off `heal-performed`: that is the CAST path's event, and a reactive repair emits none
 * (the same asymmetry the reactive cleanse has with `cleanse-performed`). Reactive repairs land on
 * the per-RECIPIENT healing axis instead, which is populated only under `perRecipientHealApply` /
 * `mode: 'battle'` — hence the flag on the fixture.
 *
 * Chimei's own ACTIVE repair rides that axis too, so the two are separated by amount: her max HP
 * is 100,000 here, making the passive worth exactly 10,000 per recipient and the active 9,000.
 * `PRE_DAMAGE_ATTACKER` (see above) keeps that amount-based separation valid in the face of the
 * #435 over-repair redirect, which would otherwise inflate a plain active-only recipient's total
 * past the 10,000 line.
 */
function passiveRepairRecipients(teamActors: TeamActorEngineInput[]): string[] {
    const result = runCombat(
        chimeiFight(teamActors, {
            perRecipientHealApply: true,
            // Deliberately narrowed to one round — this helper only needs to isolate WHO the
            // passive repair reaches, not per-round recurrence. That's covered separately by
            // chimeiOverRepairRedirect.integration.test.ts's `for (const round of [1, 2])`
            // cardinality assertions.
            numRounds: 1,
            enemyAttackers: [PRE_DAMAGE_ATTACKER],
        })
    );
    const out: string[] = [];
    for (const round of result.healing?.rounds ?? []) {
        for (const [id, healing] of round.perRecipient ?? []) {
            // `directHeal` is the RAW credited amount. A recipient of the active alone books
            // 9,000; one that also took the passive books 19,000.
            if (healing.directHeal >= 10_000) out.push(id);
        }
    }
    return out;
}

describe('Chimei R2 — parsed recipient filters (mutation guard)', () => {
    beforeAll(requireReferenceData);

    it('the end-of-round Stealth grant carries the non-defender + below-40% filter', () => {
        const grant = passiveAbilities().find(
            (a) => a.config.type === 'buff' && a.config.buffName === 'Stealth'
        );
        expect(grant?.trigger).toBe('end-of-round');
        expect(grant?.target).toBe('all-allies');
        expect(grant?.recipientFilter).toEqual({ notRole: ['DEFENDER'], hpBelowPct: 40 });
    });

    it('the start-of-round repair carries the has-Stealth filter', () => {
        const repair = passiveAbilities().find((a) => a.config.type === 'heal');
        expect(repair?.trigger).toBe('start-of-round');
        expect(repair?.target).toBe('all-allies');
        expect(repair?.recipientFilter).toEqual({ hasStatus: 'Stealth' });
    });
});

describe('Chimei R2 — "all allies with Stealth repairs 10% of this unit\'s max HP"', () => {
    beforeAll(requireReferenceData);

    it('repairs ONLY the Stealthed ally', () => {
        const recipients = passiveRepairRecipients([
            ally({ id: 'stealthed-ally', position: 'M4', role: 'ATTACKER', stealthed: true }),
            ally({ id: 'plain-ally', position: 'M1', role: 'ATTACKER' }),
        ]);
        expect([...new Set(recipients)]).toEqual(['stealthed-ally']);
    });

    // The other half of the pair. Same fixture, Stealth removed: the repair must reach NOBODY —
    // and, read together with the case above, that proves the filter discriminates rather than
    // the fixture simply never producing a passive repair.
    it('repairs NOBODY when no ally is Stealthed', () => {
        expect(
            passiveRepairRecipients([
                ally({ id: 'stealthed-ally', position: 'M4', role: 'ATTACKER' }),
                ally({ id: 'plain-ally', position: 'M1', role: 'ATTACKER' }),
            ])
        ).toEqual([]);
    });
});

// ── The other clause, and the two axes the repair case does not exercise.
//
// Worth its own fixture even though `narrowByRecipientFilter`'s axis rules are unit-tested: those
// tests supply the readers directly, so they cannot see whether the ENGINE supplies them. If
// `ctx.roleOf` were absent at this seam, the filter's conservative direction would turn Chimei's
// Stealth grant from "everyone" straight to "nobody" — a silent regression a happy-path assertion
// on the repair would never catch.
const HURT_MAX_HP = 1_000_000;
const STURDY_MAX_HP = 100_000_000;
const ENEMY_HIT = 900_000; // takes a HURT_MAX_HP ally to 10%; a STURDY one stays above 99%.

function stealthRecipientsAfterDamage(): string[] {
    const bus = createEventBus();
    const applied: Extract<CombatEvent, { type: 'buff-applied' }>[] = [];
    bus.on('buff-applied', (e) => applied.push(e));
    runCombat({
        ...chimeiFight([
            ally({ id: 'hurt-attacker', position: 'M4', role: 'ATTACKER', maxHp: HURT_MAX_HP }),
            ally({ id: 'hurt-defender', position: 'M2', role: 'DEFENDER', maxHp: HURT_MAX_HP }),
            ally({
                id: 'sturdy-attacker',
                position: 'M1',
                role: 'ATTACKER',
                maxHp: STURDY_MAX_HP,
            }),
        ]),
        enemyAttackers: [
            {
                id: 'aoe',
                stats: {
                    attack: ENEMY_HIT,
                    crit: 0,
                    critDamage: 0,
                    defence: 0,
                    hp: 1_000_000_000,
                    speed: 1000, // acts FIRST, so the damage lands before the end-of-round grant
                },
                chargeCount: 0,
                startCharged: false,
                position: 'M4',
                target: parsedTarget('all'),
                pattern: basePattern(),
                shipSkills: {
                    slots: [
                        {
                            slot: 'active',
                            abilities: [
                                {
                                    id: 'aoe-hit',
                                    type: 'damage',
                                    target: 'enemy',
                                    trigger: 'on-cast',
                                    conditions: [],
                                    config: { type: 'damage', multiplier: 100 },
                                },
                            ],
                        },
                    ],
                },
            },
        ],
        bus,
    });
    return [...new Set(applied.filter((b) => b.buffName === 'Stealth').map((b) => b.actorId))];
}

describe('Chimei R2 — "non-defender allies below 40% HP are granted Stealth"', () => {
    beforeAll(requireReferenceData);

    it('Stealths the hurt ATTACKER — not the equally hurt DEFENDER, not the healthy attacker', () => {
        const recipients = stealthRecipientsAfterDamage();
        expect(recipients).toContain('hurt-attacker');
        expect(recipients).not.toContain('hurt-defender');
        expect(recipients).not.toContain('sturdy-attacker');
    });
});
