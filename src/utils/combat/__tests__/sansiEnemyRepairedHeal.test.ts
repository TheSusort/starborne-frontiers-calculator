/**
 * ship-kit W3 (Task 5) — combat-integration tests for Sansi's on-enemy-repaired self-heal with
 * reactive event-count scaling and a numeric per-round cap:
 *
 *   Sansi (2nd passive): "…when an enemy is directly repaired, limited to 3 times per Round, this
 *   Unit repairs 5% for every enemy repaired." — on-enemy-repaired, SELF-target heal whose amount
 *   scales by the number of enemies repaired by the triggering event (repairedEnemyIds.length),
 *   capped at 3 firing events per round.
 *
 * The Sansi heal is extracted through the REAL production path (`buildShipAbilities`) fed verbatim
 * skill text (the repair clause copied from docs/ship-skills.csv) — never a hand-built ability.
 * The surrounding cast (enemies/allies that merely need to perform a repair to generate the
 * triggering event) are minimal hand-built actors, following
 * `onEnemyRepairedReactivePromotion.integration.test.ts`'s harness style.
 *
 * The count-scaling bug is invisible in DPS/trace mode (the single dummy enemy → count always 1),
 * so every test here is a POSITIONAL team battle with multiple real enemies being repaired
 * (investigation appendix §E/§F). Reactive heals fire only in healing mode, so every run sets
 * `healTargetId` to the reacting Sansi's side.
 *
 * Non-vacuity: reverting the src changes (parser scaling/cap + heal-cascade branch + engine
 * count-scaling/cap consumer) turns the scaling (×2), cap (3-not-4), and no-repair (zero-fire)
 * assertions red — each isolates a distinct piece of the fix.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { Ship } from '../../../types/ship';
import { Ability, ShipSkills } from '../../../types/abilities';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

const SANSI_HP = 1_000_000;

function ship(over: Partial<Ship>): Ship {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ...({} as any), refits: [{}, {}, {}, {}], ...over } as Ship;
}

// A no-op active (0-multiplier hit) so a focus/team actor with no offensive purpose still takes a
// valid turn each round without ending combat early or erroring.
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

// A plain self-heal (10% of own max HP, unconditional) — the minimal "this actor performs a
// repair" trigger; each cast emits ONE heal-performed event whose targets = [that actor].
const selfHeal = (id: string): Ability => ({
    id,
    type: 'heal',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'heal', pct: 10, basis: 'target-hp' },
});

// An AoE heal ('all-allies') — a SINGLE cast that repairs EVERY same-side actor, emitting ONE
// heal-performed event whose `targets` lists all recipients. Used to exercise the
// repairedEnemyIds.length > 1 scaling (one repair event → Sansi heals per repaired enemy).
const healAllAllies = (id: string): Ability => ({
    id,
    type: 'heal',
    target: 'all-allies',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'heal', pct: 10, basis: 'target-hp' },
});

// Verbatim Sansi repair clause (docs/ship-skills.csv 2nd passive, tail sentence).
const SANSI_HEAL_CLAUSE =
    'Additionally, when an enemy is directly repaired, limited to 3 times per Round, this Unit <unit-damage>repairs 5%</unit-damage> for every enemy repaired.';

/** Extracts Sansi's on-enemy-repaired self-heal through the REAL parser/builder. */
function sansiHealAbility(): Ability {
    const abilities =
        buildShipAbilities(ship({ secondPassiveSkillText: SANSI_HEAL_CLAUSE })).slots.find(
            (s) => s.slot === 'passive'
        )?.abilities ?? [];
    const heal = abilities.find((a) => a.type === 'heal' && a.target === 'self');
    if (!heal) throw new Error('mutation guard: Sansi on-enemy-repaired self-heal not found');
    return heal;
}

// Sanity-check the extracted ability BEFORE using it as engine input — a mutation guard so a
// regression in the parser/builder wiring fails loudly here rather than silently no-op'ing below.
describe('Sansi heal — extracted ability shape (mutation guard)', () => {
    it('rides on-enemy-repaired, self-targeted, count-scaled (repaired-enemy-count), capped 3/round', () => {
        const heal = sansiHealAbility();
        expect(heal.trigger).toBe('on-enemy-repaired');
        expect(heal.target).toBe('self');
        expect(heal.config.type).toBe('heal');
        if (heal.config.type === 'heal') expect(heal.config.pct).toBe(5);
        expect(heal.scaling?.countSource).toBe('repaired-enemy-count');
        expect(heal.scaling?.perUnit).toBe(5);
        expect(heal.maxPerRound).toBe(3);
    });
});

function collectReactiveHeals(input: CombatEngineInput) {
    const bus = createEventBus();
    const reactiveHeals: Extract<CombatEvent, { type: 'reactive-heal-performed' }>[] = [];
    bus.on('reactive-heal-performed', (e) => reactiveHeals.push(e));
    runCombat({ ...input, bus });
    return reactiveHeals;
}

const sansiFocusSkills = (): ShipSkills => ({
    slots: [noopActiveSlot(), { slot: 'passive', abilities: [sansiHealAbility()] }],
});

// A player-side Sansi (focus 'attacker'), healing mode ON (healTargetId = 'attacker' → Sansi is
// its own heal target, so the reactive self-heal is credited & the reactive-heal-performed fires).
const playerSansiBase = (enemyAttackers: EnemyAttacker[]): CombatEngineInput => ({
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: sansiFocusSkills(),
    enemyDefense: 0,
    enemyHp: 1_000_000_000,
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
    hp: SANSI_HP,
    speed: 1, // slowest — every enemy repair lands before Sansi acts, waking the reactive
    healTargetId: 'attacker',
    mode: 'healing',
    enemyAttackers,
});

const enemyActor = (
    id: string,
    speed: number,
    abilities: Ability[],
    passives: Ability[] = []
): EnemyAttacker =>
    ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000, speed },
        chargeCount: 0,
        startCharged: false,
        shipSkills: {
            slots: [
                { slot: 'active', abilities },
                ...(passives.length ? [{ slot: 'passive' as const, abilities: passives }] : []),
            ],
        },
    }) as EnemyAttacker;

describe('Sansi (player-side) — reactive heal SCALES by the repaired-enemy count', () => {
    it('a SINGLE AoE repair of 2 enemies heals Sansi 5% × 2 (= 10% of max HP), not a flat 5%', () => {
        // One all-allies heal cast → ONE heal-performed event with targets [aoe-healer, def] →
        // repairedEnemyIds.length === 2 → Sansi heals 5% × 2.
        const aoeHealer = enemyActor('enemy-aoe-healer', 1000, [healAllAllies('aoe-heal')]);
        const def = enemyActor('enemy-def', 500, []);
        const reactiveHeals = collectReactiveHeals(playerSansiBase([aoeHealer, def])).filter(
            (e) => e.casterId === 'attacker'
        );

        expect(reactiveHeals).toHaveLength(1);
        // basisValue = Sansi max HP (no prior turn → owner.hp fallback); modifiers all 0.
        expect(reactiveHeals[0].amount).toBeCloseTo(SANSI_HP * 0.05 * 2, 5);
        // Discriminator: a flat (unscaled) heal would be 5% = 50_000, not 100_000.
        expect(reactiveHeals[0].amount).not.toBeCloseTo(SANSI_HP * 0.05, 5);
    });

    it('a repair of a SINGLE enemy heals Sansi the flat 5% (count 1) — scaling degenerates correctly', () => {
        const healer = enemyActor('enemy-healer', 1000, [selfHeal('h-heal')]);
        const reactiveHeals = collectReactiveHeals(playerSansiBase([healer])).filter(
            (e) => e.casterId === 'attacker'
        );
        expect(reactiveHeals).toHaveLength(1);
        expect(reactiveHeals[0].amount).toBeCloseTo(SANSI_HP * 0.05, 5);
    });
});

describe('Sansi (player-side) — per-round cap: at most 3 reactive heals per round, RESET each round', () => {
    it('4 enemy repairs per round over TWO rounds fire the heal 3 times EACH round (6 total) — the cap resets, it is not global', () => {
        // Four enemies each self-heal once PER round (on-cast active fires every round) → four
        // heal-performed events in round 1 AND four in round 2. Sansi's cap blocks the 4th reactive
        // fire within EACH round. Two rounds prove the counter RESETS per round: a global cap would
        // fire only 3 times total (all in round 1); a per-round cap fires 3 + 3 = 6.
        const enemies = [
            enemyActor('enemy-1', 1000, [selfHeal('h1')]),
            enemyActor('enemy-2', 900, [selfHeal('h2')]),
            enemyActor('enemy-3', 800, [selfHeal('h3')]),
            enemyActor('enemy-4', 700, [selfHeal('h4')]),
        ];
        const reactiveHeals = collectReactiveHeals({
            ...playerSansiBase(enemies),
            numRounds: 2,
        }).filter((e) => e.casterId === 'attacker');

        expect(reactiveHeals).toHaveLength(6);
        expect(reactiveHeals.filter((e) => e.round === 1)).toHaveLength(3);
        expect(reactiveHeals.filter((e) => e.round === 2)).toHaveLength(3);
    });
});

describe('Sansi (player-side) — no enemy repair → no reactive heal (was: fired every turn)', () => {
    it('does NOT fire on a round where no enemy is repaired', () => {
        // Enemies only take no-op actions — no heal-performed event ever occurs.
        const enemies = [
            enemyActor('enemy-a', 1000, [
                {
                    id: 'noop-a',
                    type: 'damage',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'damage', multiplier: 0 },
                },
            ]),
        ];
        const reactiveHeals = collectReactiveHeals(playerSansiBase(enemies)).filter(
            (e) => e.casterId === 'attacker'
        );
        expect(reactiveHeals).toHaveLength(0);
    });
});

describe('Sansi (enemy-side) — team symmetry: an enemy Sansi reacts to a PLAYER repair, count-scaled', () => {
    it('a player AoE repair of 2 allies heals the enemy Sansi 5% × 2', () => {
        const enemySansi: EnemyAttacker = {
            id: 'enemy-sansi',
            stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: SANSI_HP, speed: 1 },
            chargeCount: 0,
            startCharged: false,
            shipSkills: { slots: [{ slot: 'passive', abilities: [sansiHealAbility()] }] },
        } as EnemyAttacker;

        // A second player actor so the player's all-allies heal repairs TWO players (count 2).
        const otherAlly: TeamActor = {
            id: 'ally-2',
            speed: 40,
            chargeCount: 0,
            startCharged: false,
            selfBuffs: [],
            enemyDebuffs: [],
            walk: {
                shipSkills: { slots: [noopActiveSlot()] },
                stats: {
                    attack: 0,
                    crit: 0,
                    critDamage: 0,
                    defensePenetration: 0,
                    hacking: 0,
                    defence: 0,
                    hp: 20_000,
                },
                selfDotModifier: 0,
                defensePenetrationBuff: 0,
                affinityDamageModifier: 0,
                affinityCritCap: 100,
                affinityCritPenalty: 0,
                hasChargedSkill: false,
            },
        } as TeamActor;

        const input: CombatEngineInput = {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            // Player focus casts an all-allies repair (repairs attacker + ally-2 → 2 players).
            shipSkills: { slots: [{ slot: 'active', abilities: [healAllAllies('player-aoe')] }] },
            enemyDefense: 0,
            enemyHp: 1_000_000_000,
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
            hp: 1_000_000,
            speed: 200, // player acts first — its repair wakes the enemy Sansi's reactive same round
            healTargetId: 'attacker',
            mode: 'healing',
            teamActors: [otherAlly],
            enemyAttackers: [enemySansi],
        };

        const reactiveHeals = collectReactiveHeals(input).filter(
            (e) => e.casterId === 'enemy-sansi'
        );
        // Symmetry: the enemy-side Sansi fires its reactive heal exactly like a player-side one.
        expect(reactiveHeals).toHaveLength(1);
        // Count-scaled by the two repaired players: 5% × 2 of the enemy Sansi's max HP.
        expect(reactiveHeals[0].amount).toBeCloseTo(SANSI_HP * 0.05 * 2, 5);
    });
});
