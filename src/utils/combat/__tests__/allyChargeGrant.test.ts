import { describe, it, expect } from 'vitest';
import {
    simulateDPS,
    DPSSimulationInput,
    deriveTeamEngineActors,
} from '../../calculators/dpsSimulator';
import { runCombat, CombatEngineInput } from '../engine';
import { TeamActorInput, CombatStatBlock } from '../../../types/calculator';
import { Ability, ShipSkills } from '../../../types/abilities';

// --- Fixture builders (mirrors teamWalk.test.ts) ---------------------------

const damageAbility = (multiplier: number, id = 'dmg'): Ability => ({
    id,
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier },
});

/** An ally-targeted charge ability (target 'all-allies') — bumps every player actor. */
const allyChargeAbility = (amount: number, id = 'ac'): Ability => ({
    id,
    type: 'charge',
    target: 'all-allies',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'charge', amount },
});

/** A self-targeted charge ability (no reach to the attacker) — the control. */
const selfChargeAbility = (amount: number, id = 'sc'): Ability => ({
    id,
    type: 'charge',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'charge', amount },
});

const teamStats = (overrides: Partial<CombatStatBlock> = {}) => ({
    attack: 15000,
    crit: 0,
    critDamage: 150,
    defensePenetration: 0,
    hacking: 250,
    defence: 0,
    hp: 0,
    ...overrides,
});

const walkedTeam = (
    shipSkills: ShipSkills,
    overrides: Partial<TeamActorInput> = {}
): TeamActorInput => ({
    id: 't1',
    speed: 150, // faster than the attacker (100) → acts first each round
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    shipSkills,
    stats: teamStats(),
    ...overrides,
});

const baseInput = (overrides: Partial<DPSSimulationInput> = {}): DPSSimulationInput => ({
    attack: 15000,
    crit: 0,
    critDamage: 150,
    defensePenetration: 0,
    chargeCount: 0,
    enemyDefense: 0,
    enemyHp: 100_000_000,
    rounds: 6,
    selfBuffs: [],
    enemyDebuffs: [],
    shipSkills: { slots: [{ slot: 'active', abilities: [damageAbility(100)] }] },
    hacking: 250,
    enemySecurity: 100,
    ...overrides,
});

// The Hayyan pattern: the ally-charge grant rides the CHARGED skill (not the active one).
// A team ship started charged fires its charged skill round 1; that skill's all-allies charge
// ability must grant charges to the attacker on that charged turn. Before the gate
// generalization the cast-path ally-charge grant only fired on `action === 'active'`, so a
// charged-skill grant never reached anyone.
describe('ally-charge grant on a charged turn (Hayyan)', () => {
    // Hayyan-shaped granter: startCharged so its CHARGED skill fires round 1; the charged slot
    // carries an all-allies +charge ability. High chargeCount so it only fires charged once
    // (the round-1 grant is the signal). Attacker: chargeCount 3 + a charged damage ability —
    // its charged round should arrive a round EARLIER with the round-1 ally-charge grant.
    const attackerCharged: ShipSkills = {
        slots: [
            { slot: 'active', abilities: [damageAbility(50, 'aa')] },
            { slot: 'charged', abilities: [damageAbility(400, 'ac')] },
        ],
    };

    const hayyan = (chargedGrant: Ability): TeamActorInput =>
        walkedTeam(
            {
                slots: [
                    { slot: 'active', abilities: [damageAbility(50, 'ha')] },
                    { slot: 'charged', abilities: [damageAbility(50, 'hc'), chargedGrant] },
                ],
            },
            {
                id: 'thayyan',
                speed: 150,
                chargeCount: 5,
                startCharged: true, // charged skill fires round 1
            }
        );

    // The attacker's first charged round (directDamage > 2× the active hit) arrives EARLIER
    // when Hayyan's charged-skill all-allies grant fires on round 1.
    const firstChargedRound = (rounds: { directDamage: number }[]): number =>
        rounds.findIndex((r) => r.directDamage > rounds[0].directDamage * 2);

    it("fires the all-allies charge grant on Hayyan's charged turn, advancing the attacker's charge", () => {
        // +2 to all allies on round 1 → attacker (chargeCount 3) reaches charged a round sooner.
        const withGrant = simulateDPS(
            baseInput({
                shipSkills: attackerCharged,
                chargeCount: 3,
                teamActors: [hayyan(allyChargeAbility(2, 'hgrant'))],
                rounds: 8,
            })
        );
        // Control: identical Hayyan ship but the charged-skill grant is SELF-only (no reach to
        // the attacker) → the attacker charges at its natural cadence.
        const withoutGrant = simulateDPS(
            baseInput({
                shipSkills: attackerCharged,
                chargeCount: 3,
                teamActors: [hayyan(selfChargeAbility(2, 'hself'))],
                rounds: 8,
            })
        );

        expect(firstChargedRound(withGrant.rounds)).toBeGreaterThanOrEqual(0);
        expect(firstChargedRound(withoutGrant.rounds)).toBeGreaterThanOrEqual(0);
        expect(firstChargedRound(withGrant.rounds)).toBeLessThan(
            firstChargedRound(withoutGrant.rounds)
        );
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 1 — PLAYER-side Graphite gate + single-grant-per-round.
//
// Graphite-shaped player supporter: a `start-of-round`, `all-allies`, type-charge grant
// gated on the enemy having Stealth (`{subject:'enemy-buff', buffName:'Stealth',
// derivable:true}`). The player-side `enemy-buff` gate reads `playerEnemyBuffNames()` =
// the UNION of the enemy ATTACKERS' live self-buffs, so the gate is exercised through
// `runCombat` with an enemy attacker that does / does not hold Stealth.
//
// Why runCombat (not simulateDPS): the `simulateDPS` input has no way to stand up an enemy
// holding Stealth (it bombs a single passive HP pool). The gate's enemy-buff source is real
// enemy attackers. So we reuse the `simulateDPS` walk derivation (`deriveTeamEngineActors`)
// to build the player team, then call `runCombat` directly with `enemyAttackers` — exactly
// the live enemy-buff pattern enemyBuffSelfDebuffGate.test.ts (item 11) uses.
//
// Observable: the FOCUS attacker's own outgoing `directDamage` series (result.rounds). The
// focus carries a charged damage skill; an extra +charge each round pulls its charged burst
// (directDamage > 2× the active hit) into an EARLIER round. Gate OFF → no acceleration;
// gate ON → acceleration. Single, isolated variable per pair: whether the enemy holds Stealth.
// ─────────────────────────────────────────────────────────────────────────────
describe('player-side Graphite gate + single-grant-per-round', () => {
    type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

    // The Graphite condition shape verbatim from Task 1.
    const STEALTH_GATE: Ability['conditions'] = [
        { subject: 'enemy-buff', buffName: 'Stealth', derivable: true },
    ];

    // Graphite's grant: start-of-round, all-allies, +charge — gated on enemy-has-Stealth.
    const graphiteGrant = (amount: number): Ability => ({
        id: 'graphite-grant',
        type: 'charge',
        target: 'all-allies',
        trigger: 'start-of-round',
        conditions: STEALTH_GATE,
        config: { type: 'charge', amount },
    });

    // The focus attacker (heal target + observable): active + charged damage slots, partial
    // charges so an extra +charge each round pulls the charged burst sooner. Speed 100.
    const focusAttackerSkills: ShipSkills = {
        slots: [
            { slot: 'active', abilities: [damageAbility(50, 'fa')] },
            { slot: 'charged', abilities: [damageAbility(400, 'fc')] },
        ],
    };

    // The Graphite teammate (speed 150 → acts first; start-of-round fires at the round head
    // regardless). chargeCount 0 → it banks nothing itself; its only job is the grant.
    const graphiteTeammate = (amount: number): TeamActorInput => ({
        id: 'graphite',
        speed: 150,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        shipSkills: { slots: [{ slot: 'passive', abilities: [graphiteGrant(amount)] }] },
        stats: teamStats(),
    });

    // An enemy attacker that grants ITSELF a 99-turn Stealth self-buff at cast (turns the gate
    // ON: playerEnemyBuffNames() returns ['Stealth']). attack 1 so its hits don't kill the
    // focus; speed 1 → it acts after the focus, but Stealth persists into later rounds' heads.
    const stealthEnemy = (): EnemyAttacker => ({
        id: 'e-stealth',
        stats: { attack: 1, crit: 0, critDamage: 0, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        {
                            id: 'es-buff',
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
                                duration: 99,
                            },
                        },
                    ],
                },
            ],
        } as ShipSkills,
    });

    // A plain enemy with NO Stealth (gate stays OFF). Same stats so the focus survives.
    const plainEnemy = (): EnemyAttacker => ({
        id: 'e-plain',
        stats: { attack: 1, crit: 0, critDamage: 0, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        {
                            id: 'ep-hit',
                            type: 'damage',
                            target: 'enemy',
                            trigger: 'on-cast',
                            conditions: [],
                            config: { type: 'damage', multiplier: 100 },
                        },
                    ],
                },
            ],
        } as ShipSkills,
    });

    // runCombat input: focus attacker with partial charges + the Graphite teammate + one enemy.
    const buildInput = (
        amount: number,
        enemy: EnemyAttacker,
        focusChargeCount: number
    ): CombatEngineInput => ({
        attack: 15000,
        crit: 0,
        critDamage: 150,
        defensePenetration: 0,
        chargeCount: focusChargeCount,
        shipSkills: focusAttackerSkills,
        enemyDefense: 0,
        enemyHp: 100_000_000,
        numRounds: 8,
        selfBuffs: [],
        enemyDebuffs: [],
        debuffLandingChance: 1,
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        hasChargedSkill: focusChargeCount >= 1,
        startCharged: false,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        defence: 0,
        hp: 1_000_000_000, // huge focus HP so the enemy's attack-1 pokes never destroy it
        speed: 100,
        healTargetId: 'attacker', // required for enemyAttackers; the focus is the heal target
        teamActors: deriveTeamEngineActors([graphiteTeammate(amount)], 100, undefined),
        enemyAttackers: [enemy],
    });

    // The focus' first charged round: directDamage exceeds 2× the round-1 (active) hit.
    const firstChargedRound = (rounds: { directDamage: number }[]): number =>
        rounds.findIndex((r) => r.directDamage > rounds[0].directDamage * 2);

    it('gate OFF (no enemy Stealth): the start-of-round grant does NOT accelerate the focus', () => {
        // Gate ON reference (enemy holds Stealth) vs gate OFF (plain enemy). Same +2 grant,
        // same focus chargeCount — only the enemy's Stealth presence differs.
        const gateOn = runCombat(buildInput(2, stealthEnemy(), 3));
        const gateOff = runCombat(buildInput(2, plainEnemy(), 3));

        const onCharged = firstChargedRound(gateOn.rounds);
        const offCharged = firstChargedRound(gateOff.rounds);

        // Both runs eventually reach a charged burst.
        expect(onCharged).toBeGreaterThanOrEqual(0);
        expect(offCharged).toBeGreaterThanOrEqual(0);

        // Gate OFF → no grant reaches the focus → it charges at its NATURAL cadence (strictly
        // later than the gate-ON run). i.e. the grant is dormant without enemy Stealth.
        expect(offCharged).toBeGreaterThan(onCharged);
    });

    it('gate ON (enemy holds Stealth): the start-of-round grant accelerates the focus', () => {
        // Control: identical scenario but the SAME ability is self-targeted (no reach to the
        // focus), isolating the all-allies routing from the gate. The enemy still holds Stealth
        // in both, so the gate is ON in both — only the grant's REACH differs.
        const allAlliesGrant = runCombat(buildInput(2, stealthEnemy(), 3));

        const selfTeammate: TeamActorInput = {
            ...graphiteTeammate(2),
            shipSkills: {
                slots: [
                    {
                        slot: 'passive',
                        abilities: [
                            {
                                ...graphiteGrant(2),
                                id: 'graphite-self',
                                target: 'self',
                            },
                        ],
                    },
                ],
            },
        };
        const selfControl = runCombat({
            ...buildInput(2, stealthEnemy(), 3),
            teamActors: deriveTeamEngineActors([selfTeammate], 100, undefined),
        });

        const grantCharged = firstChargedRound(allAlliesGrant.rounds);
        const selfCharged = firstChargedRound(selfControl.rounds);

        expect(grantCharged).toBeGreaterThanOrEqual(0);
        expect(selfCharged).toBeGreaterThanOrEqual(0);

        // With the gate ON, the all-allies grant reaches the focus → charged burst arrives
        // strictly EARLIER than the self-only control (which never reaches the focus).
        expect(grantCharged).toBeLessThan(selfCharged);
    });

    it('fires the start-of-round grant exactly ONCE per round (no cast-path double-grant)', () => {
        // Single-grant mechanism (how established): a `start-of-round` charge ability is
        // partitioned OUT of the cast path (partitionReactiveAbilities → charge is a reactive
        // type and start-of-round is a live trigger), so the cast-path `gatedSkill` charge loop
        // (runPlayerTurn) never sees it; it fires ONLY via the reactive drain, which enqueues
        // exactly one start-of-round intent per round (round-started → one enqueue per owner).
        //
        // We pin "exactly the configured amount per round (not double)" through the focus'
        // charge cadence: the focus needs N charges, gains +1 naturally per round, and the
        // grant adds `amount`. If the grant fired TWICE (cast + drain) the per-round gain would
        // be 1 + 2*amount and the charged burst would land even sooner than the +amount-once
        // prediction. We bracket the gated (amount-once) outcome between two control cadences:
        //   - "+1 amount once"  prediction → exact round R the burst should land.
        //   - a STRONGER grant (2*amount)  → lands no later, and strictly sooner when R moves.
        // Concretely: with focus chargeCount 4 and natural +1/round:
        //   no grant:        charges 0→1→2→3→4  → charged on round 5.
        //   +1/round (amt 1): 0→2→4(+cap)       → charged on round 3.
        //   if double-grant: 0→3→6(cap)         → charged on round 2.
        // So amount-1 landing on round index 2 (round 3) — NOT index 1 — proves single-grant.
        const amt1 = runCombat(buildInput(1, stealthEnemy(), 4));
        const noGrant = runCombat(buildInput(1, plainEnemy(), 4)); // gate OFF → natural cadence

        const amt1Charged = firstChargedRound(amt1.rounds);
        const naturalCharged = firstChargedRound(noGrant.rounds);

        // Natural cadence: chargeCount 4, +1/round → charged on round index 4 (round 5).
        expect(naturalCharged).toBe(4);
        // Single +1 grant per round: 0→2→4 → charged on round index 2 (round 3). A double-grant
        // would reach 4 by round index 1 (0→3→6cap → charged round index 1). index===2 (not 1)
        // pins exactly-one grant per round.
        expect(amt1Charged).toBe(2);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2 — ENEMY-side Hayyan acceleration (healing harness).
//
// Mirror of the player Hayyan test on the ENEMY team. A Hayyan-shaped enemy SUPPORTER whose
// CHARGED skill carries an all-allies +charge grant (started charged → fires round 1) plus a
// plain enemy ATTACKER that HAS a charged damage skill. The supporter acts first (higher
// speed). With the grant, the attacker's charged burst lands sooner → more total incoming
// damage to the heal target. Control: the SAME supporter but its charge grant is self-only
// (no reach to the attacker), so the attacker bursts at its natural cadence.
//
// Observable: total incoming damage to the heal target (healing.rounds[].incomingDamage),
// summed. enemyTeamRouting.test.ts harness style. Single isolated variable: the grant's reach.
// ─────────────────────────────────────────────────────────────────────────────
describe('enemy-side Hayyan ally-charge acceleration', () => {
    type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

    const enemyDamage = (multiplier: number, id: string): Ability => ({
        id,
        type: 'damage',
        target: 'enemy',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'damage', multiplier },
    });

    const enemyCharge = (amount: number, target: Ability['target'], id: string): Ability => ({
        id,
        type: 'charge',
        target,
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'charge', amount },
    });

    // Hayyan-shaped enemy supporter: started charged so its CHARGED skill fires round 1; the
    // charged slot carries the charge grant (all-allies or self) + a small hit. High chargeCount
    // so it only fires charged once. Speed 80 → acts before the attacker.
    const hayyanEnemy = (grant: Ability): EnemyAttacker => ({
        id: 'e-hayyan',
        stats: { attack: 2000, crit: 0, critDamage: 0, speed: 80 },
        chargeCount: 5,
        startCharged: true,
        shipSkills: {
            slots: [
                { slot: 'active', abilities: [enemyDamage(50, 'eh-a')] },
                { slot: 'charged', abilities: [enemyDamage(50, 'eh-c'), grant] },
            ],
        } as ShipSkills,
    });

    // A plain enemy attacker with a CHARGED damage skill: chargeCount 3, +1/round natural; an
    // extra +charge from Hayyan pulls its big charged burst (400%) sooner. Speed 40 → acts last.
    const chargedAttackerEnemy = (): EnemyAttacker => ({
        id: 'e-attacker',
        stats: { attack: 5000, crit: 0, critDamage: 0, speed: 40 },
        chargeCount: 3,
        startCharged: false,
        shipSkills: {
            slots: [
                { slot: 'active', abilities: [enemyDamage(50, 'ea-a')] },
                { slot: 'charged', abilities: [enemyDamage(400, 'ea-c')] },
            ],
        } as ShipSkills,
    });

    const BASE = (enemyAttackers: EnemyAttacker[]): CombatEngineInput => ({
        attack: 1000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: { slots: [] },
        enemyDefense: 0,
        enemyHp: 1_000_000_000,
        numRounds: 6,
        selfBuffs: [],
        enemyDebuffs: [],
        debuffLandingChance: 1,
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        hasChargedSkill: false,
        startCharged: false,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        defence: 0,
        hp: 1_000_000_000, // huge tank HP so it survives and incoming damage stays observable
        healTargetId: 'attacker',
        enemyAttackers,
    });

    const totalIncoming = (r: ReturnType<typeof runCombat>): number =>
        r.healing!.rounds.reduce((sum, round) => sum + round.incomingDamage, 0);

    it("an enemy Hayyan's all-allies charge grant makes the enemy attacker burst sooner", () => {
        // WITH grant: supporter's charged skill (round 1) bumps the attacker's charges → its
        // 400% charged burst lands a round earlier → more incoming damage to the tank overall.
        const withGrant = runCombat(
            BASE([hayyanEnemy(enemyCharge(2, 'all-allies', 'eh-grant')), chargedAttackerEnemy()])
        );
        // CONTROL: identical supporter but the grant is SELF-only (no reach to the attacker) →
        // the attacker charges at its natural cadence.
        const withoutGrant = runCombat(
            BASE([hayyanEnemy(enemyCharge(2, 'self', 'eh-self')), chargedAttackerEnemy()])
        );

        // The grant accelerates the attacker's charged burst → strictly more total incoming.
        expect(totalIncoming(withGrant)).toBeGreaterThan(totalIncoming(withoutGrant));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 3 — ENEMY-side Graphite (dormant case).
//
// The enemy Graphite's grant uses a `start-of-round` trigger, so it is a LIVE trigger that
// routes through the reactive DRAIN (engine.ts ~2136 → triggers.ts ~591), never the enemy CAST
// walk. In that drain `enemyAttackerIds` is hardcoded to `enemyAttackerActorIds` for BOTH sides
// (a pre-existing PR1/PR2 drain-wiring detail), so an enemy actor's `enemy-buff` gate reads the
// ENEMY ATTACKERS' OWN buffs — not the player team's. (The player-self-buff source,
// enemyEnemyBuffNames(), is only wired into the enemy cast walk at engine.ts ~2722, which a
// start-of-round ability never reaches.) In this healing harness no enemy attacker holds
// Stealth, so the gate is DORMANT — the enemy attacker gets no acceleration from the grant.
//
// We assert the DORMANT case only: an enemy Graphite with the Stealth-gated grant produces the
// SAME total incoming as a control whose grant is absent (self-targeted). The gate-ON direction
// is covered by the PLAYER-side gate test (Test 1, which exercises the SAME
// `{enemy-buff, Stealth, derivable}` condition through the shared executeIntent charge branch).
//
// Observable: total incoming damage to the heal target. Single isolated variable: whether the
// (dormant) grant is present. Equal totals → the gate never fired.
// ─────────────────────────────────────────────────────────────────────────────
describe('enemy-side Graphite (dormant — no player Stealth)', () => {
    type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

    const STEALTH_GATE: Ability['conditions'] = [
        { subject: 'enemy-buff', buffName: 'Stealth', derivable: true },
    ];

    const enemyDamage = (multiplier: number, id: string): Ability => ({
        id,
        type: 'damage',
        target: 'enemy',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'damage', multiplier },
    });

    // Enemy Graphite: start-of-round, all-allies / self, +charge grant gated on enemy-Stealth.
    const enemyGraphiteGrant = (
        amount: number,
        target: Ability['target'],
        id: string
    ): Ability => ({
        id,
        type: 'charge',
        target,
        trigger: 'start-of-round',
        conditions: STEALTH_GATE,
        config: { type: 'charge', amount },
    });

    const enemyGraphite = (grant: Ability): EnemyAttacker => ({
        id: 'e-graphite',
        stats: { attack: 2000, crit: 0, critDamage: 0, speed: 80 },
        chargeCount: 0,
        startCharged: false,
        shipSkills: {
            slots: [
                { slot: 'active', abilities: [enemyDamage(50, 'eg-a')] },
                { slot: 'passive', abilities: [grant] },
            ],
        } as ShipSkills,
    });

    const chargedAttackerEnemy = (): EnemyAttacker => ({
        id: 'e-attacker',
        stats: { attack: 5000, crit: 0, critDamage: 0, speed: 40 },
        chargeCount: 3,
        startCharged: false,
        shipSkills: {
            slots: [
                { slot: 'active', abilities: [enemyDamage(50, 'ea-a')] },
                { slot: 'charged', abilities: [enemyDamage(400, 'ea-c')] },
            ],
        } as ShipSkills,
    });

    const BASE = (enemyAttackers: EnemyAttacker[]): CombatEngineInput => ({
        attack: 1000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: { slots: [] },
        enemyDefense: 0,
        enemyHp: 1_000_000_000,
        numRounds: 6,
        selfBuffs: [],
        enemyDebuffs: [],
        debuffLandingChance: 1,
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        hasChargedSkill: false,
        startCharged: false,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        defence: 0,
        hp: 1_000_000_000,
        healTargetId: 'attacker',
        enemyAttackers,
    });

    const totalIncoming = (r: ReturnType<typeof runCombat>): number =>
        r.healing!.rounds.reduce((sum, round) => sum + round.incomingDamage, 0);

    it('an enemy Graphite Stealth gate stays DORMANT with no player Stealth (no acceleration)', () => {
        // WITH the all-allies Stealth-gated grant — but no player holds Stealth → gate dormant.
        const gated = runCombat(
            BASE([
                enemyGraphite(enemyGraphiteGrant(2, 'all-allies', 'eg-grant')),
                chargedAttackerEnemy(),
            ])
        );
        // CONTROL: the SAME grant but self-targeted (never reaches the attacker either). Since
        // the gate is dormant in BOTH, the attacker bursts at the same cadence → equal totals.
        const control = runCombat(
            BASE([enemyGraphite(enemyGraphiteGrant(2, 'self', 'eg-self')), chargedAttackerEnemy()])
        );

        // Gate dormant → no acceleration → byte-identical incoming totals.
        expect(totalIncoming(gated)).toBe(totalIncoming(control));
    });
});
