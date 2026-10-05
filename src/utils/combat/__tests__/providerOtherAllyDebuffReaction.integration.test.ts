/**
 * #590 — Provider: "20% Shield Penetration. When another ally inflicts a debuff onto an enemy,
 * this unit deals 50% damage to that enemy that cannot critically hit [and inflict Crit Rate
 * Down II for 1 turn (R2+)]." The reaction:
 *  - fires PER DEBUFF LANDED (two debuffs from one cast = two hits);
 *  - hits EACH victim of an AoE debuff on several enemies;
 *  - counts an ally's landed DoT as a debuff;
 *  - counts a debuff an ally lands from a REACTION, not only its own cast;
 *  - EXCLUDES Provider's own debuffs (including her own reaction's output) — "another ally";
 *  - only counts a debuff that actually LANDED (a resisted one was never inflicted).
 *
 * Both halves (damage, and the R2+ Crit Rate Down II) parse onto the new owner-excluded
 * `on-other-ally-debuff-inflicted` trigger (buildShipAbilities.ts, skillTextParser.ts) and are
 * routed to the debuff's own victim via eventCtx.debuffVictimId (triggers.ts). This file has two
 * parts: a hand-rolled-bus unit test of the LISTENER (mirrors allyCritDot.test.ts's Task 2 —
 * precise, deterministic, and the only practical way to prove the AoE/chain-bound shapes without
 * fighting positional targeting), and engine-level integration tests of Provider's REAL parsed
 * kit (buildShipAbilities on the texts below) via `runCombat`.
 */
import { describe, expect, it } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { registerReactiveListeners, Intent, ReactiveAbility } from '../triggers';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { Ship } from '../../../types/ship';
import { Ability, ShipSkills } from '../../../types/abilities';
import { bareEnemy } from '../__testutils__/bareRosterFixture';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

function ship(over: Partial<Ship>): Ship {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ...({} as any), refits: [], ...over } as Ship;
}

// PROVIDER_ACTIVE is catalogue text (docs/ship-skills.csv); the passives are old-corpus wording
// (synthetic; the catalogue text differs).
const PROVIDER_ACTIVE =
    'This Unit deals <unit-damage>145% damage</unit-damage> and inflicts <unit-skill>Hacking Down II</unit-skill> and <unit-skill>Security Down I</unit-skill> for 1 turn.';
const PROVIDER_P0 =
    'This Unit has 20% Shield Penetration. When another ally inflicts a debuff onto an enemy, this unit deals <unit-damage>50% damage</unit-damage> to that enemy that cannot critically hit.';
const PROVIDER_P2 =
    'This Unit has 20% Shield Penetration. When another ally inflicts a debuff onto an enemy, this unit deals <unit-damage>50% damage</unit-damage> to that enemy that cannot critically hit and inflict <unit-skill>Crit Rate Down II</unit-skill> for 1 turn.';

/** Provider's built passive abilities (damage, + Crit Rate Down II debuff at R2+). */
function providerPassiveAbilities(refit: 0 | 2): Ability[] {
    const s =
        refit === 0
            ? ship({ firstPassiveSkillText: PROVIDER_P0 })
            : ship({ refits: [{}, {}] as Ship['refits'], secondPassiveSkillText: PROVIDER_P2 });
    return buildShipAbilities(s).slots.find((sl) => sl.slot === 'passive')?.abilities ?? [];
}

/** Provider's REAL built kit (active + passive), for the whole-ship tests. */
function providerSkills(refit: 0 | 2): ShipSkills {
    const s =
        refit === 0
            ? ship({ activeSkillText: PROVIDER_ACTIVE, firstPassiveSkillText: PROVIDER_P0 })
            : ship({
                  refits: [{}, {}] as Ship['refits'],
                  activeSkillText: PROVIDER_ACTIVE,
                  secondPassiveSkillText: PROVIDER_P2,
              });
    return { slots: buildShipAbilities(s).slots };
}

// A no-op active (0-multiplier hit, no debuff) so an actor with no offensive purpose of its own
// still takes a valid turn each round without ever inflicting a debuff itself.
const noopActiveSlot = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        {
            id: 'noop-atk',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'damage', multiplier: 0 },
        },
    ],
});

const debuffAbility = (buffName: string, application: 'apply' | 'inflict' = 'apply'): Ability => ({
    id: `deb-${buffName}`,
    type: 'debuff',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'debuff',
        buffName,
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        application,
        duration: 5,
    },
});

const dotAbility = (): Ability => ({
    id: 'dot-1',
    type: 'dot',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'dot', dotType: 'corrosion', tier: 3, stacks: 1, duration: 3 },
});

function collectReactiveDamage(input: CombatEngineInput) {
    const bus = createEventBus();
    const reactiveDamage: Extract<CombatEvent, { type: 'reactive-damage-performed' }>[] = [];
    const debuffsApplied: Extract<CombatEvent, { type: 'debuff-applied' }>[] = [];
    const debuffsResisted: Extract<CombatEvent, { type: 'debuff-resisted' }>[] = [];
    bus.on('reactive-damage-performed', (e) => reactiveDamage.push(e));
    bus.on('debuff-applied', (e) => debuffsApplied.push(e));
    bus.on('debuff-resisted', (e) => debuffsResisted.push(e));
    runCombat({ ...input, bus });
    return { reactiveDamage, debuffsApplied, debuffsResisted };
}

// =============================================================================
// Part 1 — hand-rolled-bus unit tests of the on-other-ally-debuff-inflicted LISTENER
// (mirrors allyCritDot.test.ts's Task 2: precise, deterministic engine-wiring checks).
// =============================================================================

describe('on-other-ally-debuff-inflicted — listener wiring', () => {
    function makeHandBus() {
        const listeners = new Map<string, ((e: CombatEvent) => void)[]>();
        return {
            on<T extends CombatEvent['type']>(
                type: T,
                listener: (event: Extract<CombatEvent, { type: T }>) => void
            ) {
                const existing = listeners.get(type) ?? [];
                listeners.set(type, [...existing, listener as unknown as (e: CombatEvent) => void]);
            },
            emit(event: CombatEvent) {
                for (const l of listeners.get(event.type) ?? []) l(event);
            },
        };
    }

    function registerOwner(handBus: ReturnType<typeof makeHandBus>, ownerId: string) {
        const enqueued: Intent[] = [];
        const dmgAbility: Ability = {
            id: `provider-dmg-${ownerId}`,
            type: 'damage',
            target: 'enemy',
            trigger: 'on-other-ally-debuff-inflicted',
            // Mirrors the real parsed kit: Provider's own clause reads "inflicts", so the parser
            // sets this — the hand-built fixture must carry it too, or the apply-exclusion tests
            // below have nothing to gate on.
            triggerApplicationFilter: 'inflict',
            conditions: [],
            config: { type: 'damage', multiplier: 50, noCrit: true },
        };
        const ra: ReactiveAbility = { ability: dmgAbility, sourceSlot: 'passive' };
        registerReactiveListeners({
            bus: handBus,
            perOwner: [{ ownerId, reactiveAbilities: [ra] }],
            enqueue: (intent) => enqueued.push(intent),
            isOpposing: (id) => id === 'enemy',
        });
        return enqueued;
    }

    it('enqueues once per landed debuff, stamping debuffVictimId with the victim', () => {
        const handBus = makeHandBus();
        const enqueued = registerOwner(handBus, 'provider');

        // Two debuffs landed by the SAME ally in one cast → two enqueues (fires per debuff landed).
        handBus.emit({
            type: 'debuff-applied',
            sourceId: 'curator',
            targetId: 'e1',
            round: 1,
            buffName: 'Attack Down III',
        });
        handBus.emit({
            type: 'debuff-applied',
            sourceId: 'curator',
            targetId: 'e1',
            round: 1,
            buffName: 'Crit Power Down III',
        });
        expect(enqueued).toHaveLength(2);
        expect(enqueued.every((i) => i.eventCtx?.debuffVictimId === 'e1')).toBe(true);
    });

    it('an AoE debuff landed on several enemies enqueues once PER victim', () => {
        const handBus = makeHandBus();
        const enqueued = registerOwner(handBus, 'provider');

        for (const targetId of ['e1', 'e2', 'e3']) {
            handBus.emit({
                type: 'debuff-applied',
                sourceId: 'curator',
                targetId,
                round: 1,
                buffName: 'Attack Down III',
            });
        }
        expect(enqueued).toHaveLength(3);
        expect(enqueued.map((i) => i.eventCtx?.debuffVictimId).sort()).toEqual(['e1', 'e2', 'e3']);
    });

    it('an ally DoT landing also enqueues, stamping debuffVictimId', () => {
        const handBus = makeHandBus();
        const enqueued = registerOwner(handBus, 'provider');

        handBus.emit({
            type: 'dot-applied',
            sourceId: 'curator',
            targetId: 'e1',
            round: 1,
            dotType: 'corrosion',
            stacks: 1,
        });
        expect(enqueued).toHaveLength(1);
        expect(enqueued[0].eventCtx?.debuffVictimId).toBe('e1');
    });

    it('the owner\'s OWN debuff infliction is excluded — "another ally" excludes the caster', () => {
        const handBus = makeHandBus();
        const enqueued = registerOwner(handBus, 'provider');

        handBus.emit({
            type: 'debuff-applied',
            sourceId: 'provider',
            targetId: 'e1',
            round: 1,
            buffName: 'Hacking Down II',
        });
        expect(enqueued).toHaveLength(0);
    });

    it('an opposing-side infliction is excluded', () => {
        const handBus = makeHandBus();
        const enqueued = registerOwner(handBus, 'provider');

        handBus.emit({
            type: 'debuff-applied',
            sourceId: 'enemy',
            targetId: 'e1',
            round: 1,
            buffName: 'Attack Down III',
        });
        expect(enqueued).toHaveLength(0);
    });

    it('a debuff-resisted event never enqueues (only debuff-applied/dot-applied do — a resisted debuff was never inflicted)', () => {
        const handBus = makeHandBus();
        const enqueued = registerOwner(handBus, 'provider');

        handBus.emit({
            type: 'debuff-resisted',
            sourceId: 'curator',
            targetId: 'e1',
            round: 1,
            buffName: 'Attack Down III',
            viaLandingRoll: true,
        });
        expect(enqueued).toHaveLength(0);
    });

    it('an applied debuff (no hacking roll — Concentrate Fire, Provoke) does not count as inflicted (#590 R3)', () => {
        const handBus = makeHandBus();
        const enqueued = registerOwner(handBus, 'provider');

        handBus.emit({
            type: 'debuff-applied',
            sourceId: 'curator',
            targetId: 'e1',
            round: 1,
            buffName: 'Concentrate Fire',
            application: 'apply',
        });
        expect(enqueued).toHaveLength(0);
    });

    it('an inflicted debuff (rolled) still counts — only the applied kind is excluded (#590 R3)', () => {
        const handBus = makeHandBus();
        const enqueued = registerOwner(handBus, 'provider');

        handBus.emit({
            type: 'debuff-applied',
            sourceId: 'curator',
            targetId: 'e1',
            round: 1,
            buffName: 'Attack Down III',
            application: 'inflict',
        });
        expect(enqueued).toHaveLength(1);
    });

    it('chain-bound — a debuff-applied event branded viaOtherAllyDebuffInflictedReaction is ignored regardless of source', () => {
        const handBus = makeHandBus();
        const enqueuedA = registerOwner(handBus, 'provider-a');
        const enqueuedB = registerOwner(handBus, 'provider-b');

        // Curator's real, non-reactive cast wakes BOTH Providers once.
        handBus.emit({
            type: 'debuff-applied',
            sourceId: 'curator',
            targetId: 'e1',
            round: 1,
            buffName: 'Attack Down III',
        });
        expect(enqueuedA).toHaveLength(1);
        expect(enqueuedB).toHaveLength(1);

        // Provider A's OWN reaction lands Crit Rate Down II, branded. Without the brand this
        // would wake Provider B a SECOND time (and B's own branded follow-up would wake A back —
        // an unbounded ping-pong). With the brand, neither reacts again.
        handBus.emit({
            type: 'debuff-applied',
            sourceId: 'provider-a',
            targetId: 'e1',
            round: 1,
            buffName: 'Crit Rate Down II',
            viaOtherAllyDebuffInflictedReaction: true,
        });
        expect(enqueuedA).toHaveLength(1);
        expect(enqueuedB).toHaveLength(1);
    });
});

// =============================================================================
// Part 2 — engine-level integration tests of Provider's REAL parsed kit.
// =============================================================================

describe('Provider (player-side) — real kit, security 0 guarantees every ally debuff lands', () => {
    const curatorAlly = (buffNames: string[]): TeamActorEngineInput => ({
        id: 'curator',
        speed: 130, // faster than Provider (100): acts first, lands before her reaction is measured
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        walk: {
            shipSkills: {
                slots: [
                    {
                        slot: 'active',
                        abilities: buffNames.map((n) => debuffAbility(n, 'inflict')),
                    },
                ],
            },
            stats: {
                attack: 100,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 100,
                defence: 0,
                hp: 10_000,
            },
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
    });

    const BASE = (): CombatEngineInput => ({
        enemyAttackers: bareEnemy({ stats: { security: 0, hp: 500_000 } }),
        attack: 100,
        crit: 100, // Provider CAN crit — proves noCrit holds by construction, not by accident
        critDamage: 150,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: providerSkills(0),
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
        hp: 1_000_000_000,
        speed: 90, // slower than Curator (130): Curator's debuffs land before Provider's turn
    });

    it('Curator lands 2 debuffs in one cast → Provider hits that enemy TWICE, never critting', () => {
        const { reactiveDamage } = collectReactiveDamage({
            ...BASE(),
            teamActors: [curatorAlly(['Attack Down III', 'Crit Power Down III'])],
        });
        const providerHits = reactiveDamage.filter((e) => e.sourceId === 'attacker');
        expect(providerHits).toHaveLength(2);
        for (const hit of providerHits) {
            expect(hit.didCrit).toBeFalsy();
        }
    });

    it('a weaker same-family debuff onto an ally-held stronger one never rolls — Provider hits once, not twice (#590 R1)', () => {
        const { reactiveDamage, debuffsApplied, debuffsResisted } = collectReactiveDamage({
            ...BASE(),
            teamActors: [curatorAlly(['Defense Down III', 'Defense Down II'])],
        });
        const providerHits = reactiveDamage.filter((e) => e.sourceId === 'attacker');
        expect(providerHits).toHaveLength(1);
        // Neither a landing NOR a resist for the outclassed weaker debuff — the whole
        // clause behaves as absent, not as a failed roll.
        expect(debuffsApplied.some((e) => e.buffName === 'Defense Down II')).toBe(false);
        expect(debuffsResisted.some((e) => e.buffName === 'Defense Down II')).toBe(false);
    });

    it('a same-tier re-land is a real re-application every cast — 3 casts land 2 debuffs each = 6 Provider hits (#590 R2)', () => {
        const { reactiveDamage, debuffsApplied } = collectReactiveDamage({
            ...BASE(),
            numRounds: 3,
            teamActors: [curatorAlly(['Attack Down III', 'Crit Power Down III'])],
        });
        const providerHits = reactiveDamage.filter((e) => e.sourceId === 'attacker');
        expect(providerHits).toHaveLength(6);
        expect(
            debuffsApplied.filter(
                (e) => e.sourceId === 'curator' && e.buffName === 'Attack Down III'
            )
        ).toHaveLength(3);
        expect(
            debuffsApplied.filter(
                (e) => e.sourceId === 'curator' && e.buffName === 'Crit Power Down III'
            )
        ).toHaveLength(3);
    });

    it('R2+: Crit Rate Down II also lands on the enemy Curator debuffed', () => {
        const { reactiveDamage, debuffsApplied } = collectReactiveDamage({
            ...BASE(),
            shipSkills: providerSkills(2),
            teamActors: [curatorAlly(['Attack Down III'])],
        });
        expect(reactiveDamage.filter((e) => e.sourceId === 'attacker')).toHaveLength(1);
        expect(
            debuffsApplied.filter(
                (e) => e.sourceId === 'attacker' && e.buffName === 'Crit Rate Down II'
            )
        ).toHaveLength(1);
    });

    it('an applied debuff (Concentrate Fire) does not fire Provider, an inflicted one in the same fight still does (#590 R3)', () => {
        const judgeAlly: TeamActorEngineInput = {
            ...curatorAlly([]),
            id: 'judge',
            walk: {
                ...curatorAlly([]).walk!,
                shipSkills: {
                    slots: [
                        {
                            slot: 'active',
                            abilities: [
                                debuffAbility('Concentrate Fire', 'apply'),
                                debuffAbility('Attack Down III', 'inflict'),
                            ],
                        },
                    ],
                },
            },
        };
        const { reactiveDamage, debuffsApplied } = collectReactiveDamage({
            ...BASE(),
            teamActors: [judgeAlly],
        });
        expect(
            debuffsApplied.some((e) => e.sourceId === 'judge' && e.buffName === 'Concentrate Fire')
        ).toBe(true);
        expect(
            debuffsApplied.some((e) => e.sourceId === 'judge' && e.buffName === 'Attack Down III')
        ).toBe(true);
        const providerHits = reactiveDamage.filter((e) => e.sourceId === 'attacker');
        expect(providerHits).toHaveLength(1);
    });

    // An AoE ally debuff hitting EACH victim is proven precisely and deterministically at the
    // LISTENER level above ("an AoE debuff landed on several enemies enqueues once PER victim") —
    // debuff-applied is emitted per-victim regardless of how the landing debuff was targeted
    // (playerTurn.ts's emitDebuffApplied takes one victimId per call), so the listener test
    // already covers the real mechanism without needing positional/pattern plumbing to force a
    // genuine 3-enemy AoE cast through the non-positional engine harness here.

    it('an ally DoT landing also fires the reaction', () => {
        const { reactiveDamage } = collectReactiveDamage({
            ...BASE(),
            teamActors: [
                {
                    ...curatorAlly([]),
                    walk: {
                        ...curatorAlly([]).walk!,
                        shipSkills: { slots: [{ slot: 'active', abilities: [dotAbility()] }] },
                    },
                },
            ],
        });
        expect(reactiveDamage.filter((e) => e.sourceId === 'attacker')).toHaveLength(1);
    });

    it("Provider's OWN active debuffs never trigger her own reaction", () => {
        const { reactiveDamage } = collectReactiveDamage({
            ...BASE(),
            numRounds: 3, // several of her own casts, still zero self-reactions
        });
        expect(reactiveDamage.filter((e) => e.sourceId === 'attacker')).toHaveLength(0);
    });

    it('a resisted ally debuff (security ≫ hacking) never fires the reaction', () => {
        const { reactiveDamage } = collectReactiveDamage({
            ...BASE(),
            enemyAttackers: bareEnemy({ stats: { security: 1000, hp: 500_000 } }),
            teamActors: [
                {
                    ...curatorAlly([]),
                    walk: {
                        ...curatorAlly([]).walk!,
                        stats: { ...curatorAlly([]).walk!.stats, hacking: 50 },
                        shipSkills: {
                            slots: [
                                {
                                    slot: 'active',
                                    abilities: [debuffAbility('Attack Down III', 'inflict')],
                                },
                            ],
                        },
                    },
                },
            ],
        });
        expect(reactiveDamage.filter((e) => e.sourceId === 'attacker')).toHaveLength(0);
    });

    it("a debuff an ally lands from a REACTION (not its own cast) also fires Provider's hit", () => {
        // The FOCUS actor (AllyReactor) holds a passive that fires when SHE is directly attacked
        // and inflicts a debuff back on the attacking enemy (an on-attacked counter-debuff, the
        // same shape as Warden's Out. Damage Down) — a non-positional run always routes the
        // enemy's plain attack at the FOCUS, so putting the reactor there (rather than on a team
        // actor) makes the enemy's hit land on her deterministically. Provider rides as a team
        // actor with her REAL passive (providerPassiveAbilities) and a no-op active, so her own
        // cast never inflicts anything and the only debuff she can react to is the enemy's
        // attack — not AllyReactor's own cast — landing AllyReactor's counter-debuff.
        const reactiveCounterDebuff: Ability = {
            id: 'ally-reactor-counter',
            type: 'debuff',
            target: 'enemy',
            trigger: 'on-attacked',
            conditions: [],
            config: {
                type: 'debuff',
                buffName: 'Retaliation Mark',
                parsedEffects: {},
                stacks: 1,
                isStackable: false,
                // 'inflict' (rolled, not a guaranteed apply) — this test's subject is REACTION
                // vs CAST timing, not #590 R3's apply/inflict distinction, and security 0 below
                // guarantees the roll lands.
                application: 'inflict',
                duration: 5,
            },
        };
        const providerTeamActor: TeamActorEngineInput = {
            id: 'provider-team',
            speed: 90,
            chargeCount: 0,
            startCharged: false,
            selfBuffs: [],
            enemyDebuffs: [],
            walk: {
                shipSkills: {
                    slots: [
                        noopActiveSlot(),
                        { slot: 'passive', abilities: providerPassiveAbilities(0) },
                    ],
                },
                stats: {
                    attack: 100,
                    crit: 0,
                    critDamage: 0,
                    defensePenetration: 0,
                    hacking: 100,
                    defence: 0,
                    hp: 1_000_000,
                },
                selfDotModifier: 0,
                defensePenetrationBuff: 0,
                affinityDamageModifier: 0,
                affinityCritCap: 100,
                affinityCritPenalty: 0,
                hasChargedSkill: false,
            },
        };
        const { reactiveDamage, debuffsApplied } = collectReactiveDamage({
            enemyAttackers: bareEnemy({ stats: { attack: 10_000, security: 0, hp: 500_000 } }),
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: {
                slots: [noopActiveSlot(), { slot: 'passive', abilities: [reactiveCounterDebuff] }],
            },
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
            hp: 1_000_000_000,
            speed: 100,
            teamActors: [providerTeamActor],
        });
        const counterDebuff = debuffsApplied.filter(
            (e) => e.sourceId === 'attacker' && e.buffName === 'Retaliation Mark'
        );
        expect(counterDebuff).toHaveLength(1);
        const providerHits = reactiveDamage.filter((e) => e.sourceId === 'provider-team');
        expect(providerHits).toHaveLength(1);
        expect(providerHits[0].targetId).toBe(counterDebuff[0].targetId);
    });

    it('a REACTIVE debuff onto an enemy already holding a stronger same-family one never rolls (#590 R1, reactive path)', () => {
        // AllyReactor (focus, speed 100 — acts before the enemy's speed-10 turn) casts her own
        // active, landing 'Defense Down III' unconditionally (application 'apply'). The enemy
        // then attacks her, firing her on-attacked reactive 'Defense Down II' (inflict) back onto
        // that SAME enemy — now outclassed by the III her own active just landed, so it should
        // never roll: no debuff-applied, no debuff-resisted for 'Defense Down II'.
        const ownActiveDebuff: Ability = {
            id: 'ally-reactor-active-debuff',
            type: 'debuff',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: {
                type: 'debuff',
                buffName: 'Defense Down III',
                parsedEffects: {},
                stacks: 1,
                isStackable: false,
                application: 'apply',
                duration: 5,
            },
        };
        const reactiveCounterDebuff: Ability = {
            id: 'ally-reactor-counter-weak',
            type: 'debuff',
            target: 'enemy',
            trigger: 'on-attacked',
            conditions: [],
            config: {
                type: 'debuff',
                buffName: 'Defense Down II',
                parsedEffects: {},
                stacks: 1,
                isStackable: false,
                application: 'inflict',
                duration: 5,
            },
        };
        const { debuffsApplied, debuffsResisted } = collectReactiveDamage({
            enemyAttackers: bareEnemy({ stats: { attack: 10_000, security: 0, hp: 500_000 } }),
            attack: 100,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: {
                slots: [
                    { slot: 'active', abilities: [ownActiveDebuff] },
                    { slot: 'passive', abilities: [reactiveCounterDebuff] },
                ],
            },
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
            hp: 1_000_000_000,
            speed: 100,
        });
        expect(debuffsApplied.some((e) => e.buffName === 'Defense Down III')).toBe(true);
        expect(debuffsApplied.some((e) => e.buffName === 'Defense Down II')).toBe(false);
        expect(debuffsResisted.some((e) => e.buffName === 'Defense Down II')).toBe(false);
    });
});

describe('Provider (enemy-side) — team symmetry mirror', () => {
    it('an enemy-side Curator waking an enemy-side Provider still hits the (player) victim', () => {
        const bus = createEventBus();
        const reactiveDamage: Extract<CombatEvent, { type: 'reactive-damage-performed' }>[] = [];
        bus.on('reactive-damage-performed', (e) => reactiveDamage.push(e));

        const enemyProvider: EnemyAttacker = {
            id: 'enemy-provider',
            stats: {
                attack: 100,
                crit: 0,
                critDamage: 0,
                defence: 0,
                hp: 1_000_000_000,
                speed: 50,
            },
            chargeCount: 0,
            startCharged: false,
            shipSkills: { slots: [{ slot: 'passive', abilities: providerPassiveAbilities(0) }] },
        };
        const enemyCurator: EnemyAttacker = {
            id: 'enemy-curator',
            stats: {
                attack: 100,
                crit: 0,
                critDamage: 0,
                defence: 0,
                hp: 1_000_000_000,
                speed: 130,
                hacking: 100,
            },
            chargeCount: 0,
            startCharged: false,
            shipSkills: {
                slots: [
                    { slot: 'active', abilities: [debuffAbility('Attack Down III', 'inflict')] },
                ],
            },
        };

        runCombat({
            enemyAttackers: [enemyProvider, enemyCurator],
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: { slots: [noopActiveSlot()] },
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
            hp: 1_000_000_000,
            security: 0, // the player focus's security — guarantees the enemy Curator's debuff lands
            speed: 10,
            bus,
        });

        const hits = reactiveDamage.filter((e) => e.sourceId === 'enemy-provider');
        expect(hits).toHaveLength(1);
        expect(hits[0].targetId).toBe('attacker');
    });
});

describe('Two Providers (chain-bound) — the reaction terminates without throwing', () => {
    it('Curator lands ONE debuff → exactly 2 reactive hits total (one per Provider), the chain does not run on', () => {
        const providerAAbilities = providerPassiveAbilities(2);
        const providerBAbilities = providerPassiveAbilities(2);

        const providerTeamActor = (id: string, abilities: Ability[]): TeamActorEngineInput => ({
            id,
            speed: 90,
            chargeCount: 0,
            startCharged: false,
            selfBuffs: [],
            enemyDebuffs: [],
            walk: {
                shipSkills: { slots: [noopActiveSlot(), { slot: 'passive', abilities }] },
                stats: {
                    attack: 100,
                    crit: 0,
                    critDamage: 0,
                    defensePenetration: 0,
                    hacking: 0,
                    defence: 0,
                    hp: 10_000,
                },
                selfDotModifier: 0,
                defensePenetrationBuff: 0,
                affinityDamageModifier: 0,
                affinityCritCap: 100,
                affinityCritPenalty: 0,
                hasChargedSkill: false,
            },
        });

        const curator: TeamActorEngineInput = {
            id: 'curator',
            speed: 130,
            chargeCount: 0,
            startCharged: false,
            selfBuffs: [],
            enemyDebuffs: [],
            walk: {
                shipSkills: {
                    slots: [
                        {
                            slot: 'active',
                            abilities: [debuffAbility('Attack Down III', 'inflict')],
                        },
                    ],
                },
                stats: {
                    attack: 100,
                    crit: 0,
                    critDamage: 0,
                    defensePenetration: 0,
                    hacking: 100,
                    defence: 0,
                    hp: 10_000,
                },
                selfDotModifier: 0,
                defensePenetrationBuff: 0,
                affinityDamageModifier: 0,
                affinityCritCap: 100,
                affinityCritPenalty: 0,
                hasChargedSkill: false,
            },
        };

        const { reactiveDamage } = collectReactiveDamage({
            enemyAttackers: bareEnemy({ stats: { security: 0, hp: 500_000 } }),
            attack: 100,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: {
                slots: [noopActiveSlot(), { slot: 'passive', abilities: providerAAbilities }],
            },
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
            hp: 1_000_000_000,
            speed: 89,
            teamActors: [providerTeamActor('provider-b', providerBAbilities), curator],
        });

        const hits = reactiveDamage.filter(
            (e) => e.sourceId === 'attacker' || e.sourceId === 'provider-b'
        );
        expect(hits).toHaveLength(2);
    });
});
