/**
 * #435 Task 3 — an `overheal`-basis HEAL with an explicit `lowest-hp-ally` target.
 *
 * Abundant Renewal's semantics are per-recipient fan-out: each over-repaired recipient gets its
 * own shield — the caster included, per the owner ruling of 2026-08-31 — sized from its OWN
 * clipped excess, and the executor OVERRIDES ability.target to do it.
 * Chimei's redirect is the opposite shape — ONE repair, on the lowest current HP% ally, sized
 * from the SUM of everything the triggering repair wasted (owner ruling R4, 2026-08-30).
 *
 * So an explicit `lowest-hp-ally` target must opt OUT of the override. Abundant Renewal carries
 * no such target and keeps the override arm — asserted here so the two cannot drift apart.
 */
import { describe, it, expect } from 'vitest';
import { executeIntent, Intent, IntentExecContext } from '../triggers';
import { createEventBus } from '../events';
import { createStatusEngine } from '../statusEngine';
import type { CombatActor } from '../state';
import type { Ability } from '../../../types/abilities';

const OWNER_ID = 'chimei';
const ALLY_A = 'ally-a'; // over-repaired by 3,000
const ALLY_B = 'ally-b'; // over-repaired by 2,000
const LOWEST = 'ally-lowest'; // the engine-resolved lowest current HP% ally
const MAX_HP = 50_000;

const redirect = (): Ability => ({
    id: 'ab-redirect',
    type: 'heal',
    target: 'lowest-hp-ally',
    trigger: 'on-own-repair-to-ally',
    conditions: [],
    config: { type: 'heal', pct: 100, basis: 'overheal' },
});

const abundantRenewal = (): Ability => ({
    id: 'ab-abundant-renewal',
    type: 'shield',
    target: 'ally',
    trigger: 'on-own-repair-to-ally',
    conditions: [],
    config: { type: 'shield', pct: 50, basis: 'overheal' },
});

function run(args: {
    ability: Ability;
    /**
     * Per-recipient clipped over-repair of the triggering repair, keyed by recipient — the map the
     * listener stamps. Since the owner rulings of 2026-08-31 it INCLUDES the caster's own entry,
     * so a test models "the caster wasted repair on herself" by keying OWNER_ID here.
     */
    overhealByRecipient?: Record<string, number>;
    /** Legacy single-target emit: no per-recipient breakdown, only the aggregate. */
    overhealAmount?: number;
    lowestHpAllyId?: string | undefined;
}) {
    const bus = createEventBus();
    const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
    const heals: { rid: string; raw: number }[] = [];
    const shields: { rid: string; raw: number }[] = [];

    const healing = {
        targetId: ALLY_A,
        credit: () => {},
        creditRecipient: () => {},
        creditPerformed: () => {},
        perRecipientApply: true,
        applyHealToTarget: (raw: number, actor: CombatActor) => {
            heals.push({ rid: actor.id, raw });
            return { reversed: false as const, consumed: raw, overheal: 0 };
        },
        grantShieldToTarget: (raw: number, actor: CombatActor) => {
            shields.push({ rid: actor.id, raw });
            return { applied: raw, overshield: 0 };
        },
        recipientMaxHp: () => MAX_HP,
        recipientIncomingHealPct: () => 0,
        recipientActor: (id: string) => ({ id }) as unknown as CombatActor,
    } as unknown as IntentExecContext['healing'];

    // The aggregate, exactly as the listener computes it: the per-recipient breakdown's sum when
    // present, else the legacy single-target figure.
    const aggregate = args.overhealByRecipient
        ? Object.values(args.overhealByRecipient).reduce((sum, v) => sum + v, 0)
        : (args.overhealAmount ?? 5_000);

    const intent: Intent = {
        ownerId: OWNER_ID,
        ability: args.ability,
        sourceSlot: 'passive',
        eventCtx: {
            repairedAllyIds: [ALLY_A, ALLY_B],
            overhealAmount: aggregate,
            ...(args.overhealByRecipient ? { overhealByRecipient: args.overhealByRecipient } : {}),
        },
    } as unknown as Intent;

    // #435 Task 3 harness note: `IntentExecContext` requires more than the brief's original
    // cast covered — `executeIntent` throws on a missing owner runtime, and reads
    // corrosionEntries/infernoEntries/pendingBombs/lastTurnCtxByActor unconditionally. The
    // owner runtime shape is copied from `reactiveOverhealShield.test.ts`'s `makeShieldCtx`,
    // with every modifier field left at its neutral (0 / 100) value — the open heal-modifier
    // ruling (R-open) must not be smuggled into this fixture as a decided answer.
    const ctx = {
        bus,
        round: 1,
        statusEngine: se,
        healing,
        corrosionEntries: [],
        infernoEntries: [],
        pendingBombs: [],
        runtimes: new Map([
            [
                OWNER_ID,
                {
                    actor: {
                        id: OWNER_ID,
                        currentHp: MAX_HP,
                        chargeCount: 0,
                        charges: 0,
                    } as unknown as CombatActor,
                    attack: 10000,
                    defence: 0,
                    hp: MAX_HP,
                    healModifier: 0,
                    selfDotModifier: 0,
                    defensePenetrationBuff: 0,
                    affinityDamageModifier: 0,
                    affinityCritCap: 100,
                    affinityCritPenalty: 0,
                    affinityDisadvantage: false,
                    selfBuffLookup: new Map(),
                    enemyDebuffLookup: new Map(),
                } as never,
            ],
        ]),
        lastTurnCtxByActor: new Map(),
        playerIds: [OWNER_ID, ALLY_A, ALLY_B, LOWEST],
        lowestHpAllyIdFor: () => args.lowestHpAllyId,
    } as unknown as IntentExecContext;

    executeIntent(intent, ctx);
    return { heals, shields };
}

describe('#435 Task 3 — explicit lowest-hp-ally on an overheal basis', () => {
    it('repairs ONE ally, the engine-resolved lowest current HP% one (R3)', () => {
        const { heals } = run({
            ability: redirect(),
            overhealByRecipient: { [ALLY_A]: 3_000, [ALLY_B]: 2_000 },
            lowestHpAllyId: LOWEST,
        });
        expect(heals.map((h) => h.rid)).toEqual([LOWEST]);
    });

    it('sizes the repair from the SUM of the cast’s over-repair, not per ally (R4)', () => {
        const { heals } = run({
            ability: redirect(),
            overhealByRecipient: { [ALLY_A]: 3_000, [ALLY_B]: 2_000 },
            lowestHpAllyId: LOWEST,
        });
        expect(heals).toHaveLength(1);
        expect(heals[0].raw).toBe(5_000);
    });

    it('sizes from a legacy single-target emit that carries no per-ally breakdown', () => {
        const { heals } = run({
            ability: redirect(),
            overhealAmount: 4_000,
            lowestHpAllyId: LOWEST,
        });
        expect(heals).toEqual([{ rid: LOWEST, raw: 4_000 }]);
    });

    // Owner ruling 2026-08-31: "Chimei's overheal redirect is fed by all heal targets, himself
    // included." Her active is `target: 'all-allies'`, so a cast that repairs damaged allies
    // cleanly and wastes only HER OWN share still redirects, sized by that share. This INVERTS
    // 94515b6e, whose test asserted exactly the opposite here.
    it('counts the caster’s OWN over-repair even when no ALLY was over-repaired', () => {
        const { heals } = run({
            ability: redirect(),
            overhealByRecipient: { [OWNER_ID]: 4_000 },
            lowestHpAllyId: LOWEST,
        });
        expect(heals).toEqual([{ rid: LOWEST, raw: 4_000 }]);
    });

    // ... and she is never the RECIPIENT of her own redirect (R3, screenshot-confirmed: Chimei
    // shows the base heal, the redirect lands on someone else). The engine's `lowest-hp-ally`
    // selector excludes the owner; asserted here so the sizing inversion above cannot be misread
    // as making the caster a candidate.
    it('never redirects onto the caster herself', () => {
        const { heals } = run({
            ability: redirect(),
            overhealByRecipient: { [OWNER_ID]: 4_000 },
            lowestHpAllyId: LOWEST,
        });
        expect(heals).toHaveLength(1);
        expect(heals[0].rid).not.toBe(OWNER_ID);
    });

    // The R4 zero-sum guard still stands, now over the SELF-INCLUSIVE sum: a repair that wasted
    // nothing on anyone redirects to nobody rather than healing someone for 0.
    it('redirects nobody when the triggering repair wasted nothing at all', () => {
        const { heals } = run({
            ability: redirect(),
            overhealAmount: 0,
            lowestHpAllyId: LOWEST,
        });
        expect(heals).toEqual([]);
    });

    it('repairs nobody when the caster is alone (the selector resolves to nobody)', () => {
        const { heals } = run({
            ability: redirect(),
            overhealByRecipient: { [ALLY_A]: 3_000 },
            lowestHpAllyId: undefined,
        });
        expect(heals).toEqual([]);
    });

    // Abundant Renewal must be untouched: no explicit lowest-hp-ally target, so it KEEPS the
    // per-ally override — one shield per over-repaired ally, each from its own excess.
    it('leaves Abundant Renewal’s per-ally fan-out unchanged', () => {
        const { shields } = run({
            ability: abundantRenewal(),
            overhealByRecipient: { [ALLY_A]: 3_000, [ALLY_B]: 2_000 },
            lowestHpAllyId: LOWEST,
        });
        expect(shields).toEqual([
            { rid: ALLY_A, raw: 1_500 },
            { rid: ALLY_B, raw: 1_000 },
        ]);
    });

    // Owner ruling 2026-08-31, the second half: a ship that over-repairs ITSELF while healing
    // the team does earn Abundant Renewal's shield. So the caster is a recipient of the fan-out
    // like any other, sized off its OWN waste — 4,000 wasted on itself becomes a 2,000 shield on
    // itself, alongside the ally shields, not instead of them. Before this ruling the caster was
    // filtered out of the map entirely and got nothing (94515b6e).
    it('shields the CASTER off its own over-repair, alongside the allies', () => {
        const { shields } = run({
            ability: abundantRenewal(),
            overhealByRecipient: { [ALLY_A]: 3_000, [ALLY_B]: 2_000, [OWNER_ID]: 4_000 },
            lowestHpAllyId: LOWEST,
        });
        expect(shields).toEqual([
            { rid: ALLY_A, raw: 1_500 },
            { rid: ALLY_B, raw: 1_000 },
            { rid: OWNER_ID, raw: 2_000 },
        ]);
    });
});
