/**
 * SP-E, Task E4 — Belladonna's "When an ally inflicts Corrosion, this Unit has a chance to
 * convert the Corrosion into Acidic Decay of the same level, with the chance scaling at 1% per
 * 10 Hacking. Upon converting Corrosion, this Unit extends the newly applied Acidic Decay status
 * for 1 turn, with the chance to equal to its crit power." (docs/ship-skills.csv, second passive,
 * verbatim — matches the SP-E triage probe in modelCompletenessTriage.test.ts).
 *
 * The convert-dot ability is extracted through the REAL production path (buildShipAbilities),
 * mirroring allyDebuffReactivePromotion.integration.test.ts's Oleander/Hayyan harness: a
 * mutation-guard test on the extracted ability's shape, then engine-integration tests that drive
 * a real `runCombat` round and assert on the live CombatActor state via `__testTapActors`.
 *
 * Non-vacuity: reverting the Task E4 src changes (skillTextParser.ts / buildShipAbilities.ts /
 * triggers.ts / engine.ts) turns the "converts" assertions red (the auto-filled bare debuff
 * never retags anything) — verified by construction (the conversion only exists because of this
 * task's `convert-dot` executor).
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { Ship } from '../../../types/ship';
import { Ability, ShipSkills } from '../../../types/abilities';
import { CombatActor } from '../state';
import { dotFamilyCounts } from '../../abilities/roundContext';
import { bareEnemy, BARE_ENEMY_ID } from '../__testutils__/bareRosterFixture';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

function ship(over: Partial<Ship>): Ship {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ...({} as any), refits: [{}, {}, {}, {}], ...over } as Ship;
}

// Verbatim from docs/ship-skills.csv (second_passive_skill_text field) — matches
// modelCompletenessTriage.test.ts's BELLADONNA_P2 constant exactly.
const BELLADONNA_P2 =
    'When an ally inflicts <unit-skill>Corrosion</unit-skill>, this Unit has a chance to convert the <unit-skill>Corrosion</unit-skill> into <unit-skill>Acidic Decay</unit-skill> of the same level, with the chance scaling at 1% per 10 Hacking.<br /><br />Upon converting <unit-skill>Corrosion</unit-skill>, this Unit extends the newly applied <unit-skill>Acidic Decay</unit-skill> status for 1 turn, with the chance to equal to its crit power.';

/** Extracts Belladonna's convert-dot ability through the REAL parser/builder (production routing). */
function belladonnaConvertDot(): Ability {
    const abilities =
        buildShipAbilities(ship({ secondPassiveSkillText: BELLADONNA_P2 })).slots.find(
            (s) => s.slot === 'passive'
        )?.abilities ?? [];
    const conv = abilities.find((a) => a.config.type === 'convert-dot');
    if (!conv) throw new Error('mutation guard: Belladonna convert-dot ability not found');
    return conv;
}

describe('Belladonna convert-dot ability — extracted shape (mutation guard)', () => {
    it('rides on-ally-debuff-inflicted, targets enemy, and carries the parsed conversion config', () => {
        const conv = belladonnaConvertDot();
        expect(conv.trigger).toBe('on-ally-debuff-inflicted');
        expect(conv.target).toBe('enemy');
        expect(conv.config.type).toBe('convert-dot');
        if (conv.config.type !== 'convert-dot') throw new Error('unreachable');
        expect(conv.config.fromDotType).toBe('corrosion');
        expect(conv.config.buffName).toBe('Acidic Decay');
        expect(conv.config.chanceFromStat).toEqual({ stat: 'hacking', pctPerPoint: 0.1 });
        expect(conv.config.extendTurns).toBe(1);
        expect(conv.config.extendChanceFromCritPower).toBe(true);
    });

    it('does not ALSO emit a redundant standalone extend-dot ability for the same row', () => {
        const abilities =
            buildShipAbilities(ship({ secondPassiveSkillText: BELLADONNA_P2 })).slots.find(
                (s) => s.slot === 'passive'
            )?.abilities ?? [];
        expect(abilities.some((a) => a.config.type === 'extend-dot')).toBe(false);
    });
});

// A no-op active (0-multiplier hit) so a focus/team actor with no offensive purpose still takes
// a valid turn each round without ending combat early or erroring.
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

const belladonnaFocusSkills = (): ShipSkills => ({
    slots: [noopActiveSlot(), { slot: 'passive', abilities: [belladonnaConvertDot()] }],
});

// Corrosion II (tier 6 per DOT_TIER_MAP) for 3 turns — hand-built like allyDebuffReactivePromotion's
// dotEnemy fixture (no parser round-trip needed; the DoT config shape is well established).
const corrosionAbility = (): Ability => ({
    id: 'ally-corrosion',
    type: 'dot',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'dot', dotType: 'corrosion', tier: 6, stacks: 1, duration: 3 },
});

describe('Belladonna (player-side) — converts an ally-inflicted Corrosion into an unremovable Acidic Decay of the same tier', () => {
    const corrosionAlly = (): TeamActor => ({
        id: 'ally-corrosion',
        speed: 130,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        walk: {
            shipSkills: { slots: [{ slot: 'active', abilities: [corrosionAbility()] }] },
            stats: {
                attack: 100,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 200,
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

    const BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
        // A real opponent for the ally-inflicted Corrosion to land on. The DEFAULT
        // 500k HP is deliberate and safe here: corrosion MAGNITUDE scales with the victim's own
        // `recipientMaxHp` in the per-victim positional tick, but this fixture asserts only the
        // entry's family/tier/unremovable/remainingRounds — never a damage number — so the HP
        // choice cannot move any assertion. The focus has attack 0 and the ally 100 over a single
        // round, so the opponent trivially survives.
        enemyAttackers: bareEnemy(),
        attack: 0,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: belladonnaFocusSkills(),
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
        teamActors: [corrosionAlly()],
        ...overrides,
    });

    it('high Hacking (~100% convert) + high crit power (~100% extend): the enemy ends with 0 plain corrosion and 1 Acidic Decay entry (same tier), and enemyDotFamilyCounts sees it', () => {
        let enemyActor: CombatActor | undefined;
        runCombat(
            BASE({
                hacking: 1000, // rate = min(1, 0.1*1000/100) = 1 → guaranteed conversion
                critDamage: 1000, // critPowerFactor = min(1, 1000/100) = 1 → guaranteed extend
                __testTapActors: (actors) => {
                    enemyActor = actors.find((a) => a.id === BARE_ENEMY_ID);
                },
            })
        );
        if (!enemyActor) throw new Error('__testTapActors never handed out the enemy actor');

        expect(enemyActor.corrosionEntries).toHaveLength(1);
        const entry = enemyActor.corrosionEntries[0];
        expect(entry.family).toBe('Acidic Decay');
        expect(entry.unremovable).toBe(true);
        expect(entry.tier).toBe(6); // "of the same level" — tier untouched by the conversion
        // 3 (cast duration) − 1 (this round's own tick decrement) + 1 (the paired crit-power
        // extend, folded into the SAME executor) = 3. Compared against the un-extended plain
        // case below (2) to isolate the extend's effect.
        expect(entry.remainingRounds).toBe(3);

        // SP-D key-match proof: the retagged family is countable under the EXACT key the
        // charge-skill's "3+ Acidic Decay -> Stasis" gate reads via enemyDotFamilyCounts.
        expect(
            dotFamilyCounts(
                enemyActor.corrosionEntries,
                enemyActor.infernoEntries,
                enemyActor.genericDoTEntries
            )
        ).toEqual({ 'Acidic Decay': 1 });
    });

    it('0 Hacking → 0% conversion chance: the ally-inflicted Corrosion stays plain (deterministic gate)', () => {
        let enemyActor: CombatActor | undefined;
        runCombat(
            BASE({
                hacking: 0,
                critDamage: 0,
                __testTapActors: (actors) => {
                    enemyActor = actors.find((a) => a.id === BARE_ENEMY_ID);
                },
            })
        );
        if (!enemyActor) throw new Error('__testTapActors never handed out the enemy actor');

        expect(enemyActor.corrosionEntries).toHaveLength(1);
        const entry = enemyActor.corrosionEntries[0];
        expect(entry.family).toBeUndefined();
        expect(entry.unremovable).toBeUndefined();
        // 3 (cast duration) − 1 (this round's own tick decrement), no extend (conversion never
        // fired, so the paired extend never runs either) — one less than the converted case above.
        expect(entry.remainingRounds).toBe(2);
    });
});

describe("Belladonna (enemy-side) — team symmetry: an enemy Belladonna converts an enemy ally's Corrosion on a player ship", () => {
    it('the player focus actor ends up with the Acidic Decay stack, not the opposing roster', () => {
        const enemyBelladonna: EnemyAttacker = {
            id: 'enemy-belladonna',
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 1000,
                hacking: 1000,
                defence: 0,
                hp: 1_000_000_000,
                speed: 10,
            },
            chargeCount: 0,
            startCharged: false,
            shipSkills: { slots: [{ slot: 'passive', abilities: [belladonnaConvertDot()] }] },
        };

        const enemyCorrosionAlly: EnemyAttacker = {
            id: 'enemy-corrosion-ally',
            stats: {
                attack: 100,
                crit: 0,
                critDamage: 0,
                defence: 0,
                hp: 1_000_000_000,
                speed: 200,
            },
            chargeCount: 0,
            startCharged: false,
            shipSkills: { slots: [{ slot: 'active', abilities: [corrosionAbility()] }] },
        };

        const input: CombatEngineInput = {
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
            speed: 1, // player acts last — the enemy ally's Corrosion lands before/independent of it
            healTargetId: 'attacker',
            mode: 'healing',
            enemyAttackers: [enemyCorrosionAlly, enemyBelladonna],
        };

        let playerActor: CombatActor | undefined;
        let opposingActors: CombatActor[] = [];
        runCombat({
            ...input,
            __testTapActors: (actors) => {
                playerActor = actors.find((a) => a.id === 'attacker');
                // The negative control used to be the vestigial `enemy` sink (the focus's
                // only offensive target back when no roster was supplied). Now that the roster is
                // real, the control is the roster ITSELF — and it is looked up by id so a typo or a
                // renamed actor fails loudly instead of resolving to `undefined` and letting a
                // `?? []` default make the assertion vacuously true.
                opposingActors = ['enemy-corrosion-ally', 'enemy-belladonna'].map((id) => {
                    const a = actors.find((x) => x.id === id);
                    if (!a) throw new Error(`negative control actor '${id}' is not in the run`);
                    return a;
                });
            },
        });
        if (!playerActor) throw new Error('__testTapActors never handed out the player actor');

        expect(playerActor.corrosionEntries).toHaveLength(1);
        const entry = playerActor.corrosionEntries[0];
        expect(entry.family).toBe('Acidic Decay');
        expect(entry.unremovable).toBe(true);
        expect(entry.tier).toBe(6);

        // Neither opposing actor (the player's OWN offensive target among them, untouched by this
        // scenario) receives the conversion — proves the executor resolved the REAL victim (the
        // player actor), not the fixed ctx.enemy/corrosionEntries closures.
        expect(opposingActors).toHaveLength(2);
        for (const a of opposingActors) {
            expect(a.corrosionEntries).toHaveLength(0);
        }
    });
});
