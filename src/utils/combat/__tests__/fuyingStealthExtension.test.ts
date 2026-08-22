/**
 * #363 Gap 4 — Fuying's charged skill "...and extends Stealth by 1 turn".
 *
 * Her charged text is: "This Unit cleanses 1 debuff for every 50% crit power this Unit has and
 * extends <unit-skill>Stealth</unit-skill> by 1 turn." The cleanse half was fixed in an earlier
 * task; the extend half produced NO ability at all — `parseExtendStatus`'s two existing arms both
 * require a literal 'buffs'/'debuffs' token, and Fuying's clause names a STATUS, not that token.
 *
 * OWNER RULING (2026-08-22), ground truth: the extension reaches every ally in her active
 * pattern, FACTION-BLIND — unlike her active Stealth grant, which is Tianchao-scoped. Her text
 * names no faction in this clause, so the built ability carries NO `factionFilter`.
 *
 * This is `extend-status` (Sokol/Ripper/Lev's existing generic mechanic), not a new ability
 * type: it only needed an optional `buffName` on the config plus a name filter in
 * `StatusEngine.extendAllBuffsDuration`, so Sokol/Ripper/Lev (which never pass a name) are
 * untouched by construction.
 *
 * Structure:
 *  1. Parser unit tests — the named arm matches Fuying, the generic arms are unaffected.
 *  2. Corpus sweep — the named arm fires on Fuying alone across the whole ship-skills corpus.
 *  3. StatusEngine unit tests — the `buffName` filter in isolation.
 *  4. Build-site test — `buildShipAbilities` on Fuying's REAL kit produces the right ability
 *     shape, with no `factionFilter`.
 *  5. Production-routing engine test — Fuying's REAL built ability (never hand-written) fired
 *     through the real `runPlayerTurn` executor, over a REAL footprint (her actual
 *     `Pattern-Wings-Support-Not-Self-Range-2`), proving the extension both ways (in/out of
 *     pattern), faction-blind, and name-scoped (leaves a sibling buff's duration untouched).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { parseExtendStatus } from '../../skillTextParser';
import { createStatusEngine, RegisteredAbilityStatus, StatusEngine } from '../statusEngine';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { supportFootprintAllyIds } from '../supportFootprint';
import { parsePattern } from '../../targetingParser';
import { runPlayerTurn, PlayerActorRuntime, PlayerTurnArgs } from '../playerTurn';
import { createActor, CombatActor } from '../state';
import { createEventBus } from '../events';
import { makeRateGate } from '../../calculators/rateAccumulator';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { Position } from '../../../types/encounters';
import type { AffinityName } from '../../../types/ship';

// `docs/` is gitignored reference data and a fresh worktree does not have it — fail loudly
// rather than silently collect nothing (pattern from fuyingFactionScope.integration.test.ts).
function requireReferenceData(): void {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'docs/ship-skills.csv and/or docs/ship-data.json are missing from this worktree ' +
                '(gitignored reference data) — needed to resolve real ship skill text/stats.'
        );
    }
}
beforeAll(requireReferenceData);

const FUYING_CHARGED =
    'This Unit <unit-aid>cleanses 1 debuff</unit-aid> for every 50% crit power this Unit has ' +
    'and extends <unit-skill>Stealth</unit-skill> by 1 turn.';

// ---------------------------------------------------------------------------
// 1. Parser
// ---------------------------------------------------------------------------
describe('parseExtendStatus — named arm (#363)', () => {
    it('parses Fuying’s named clause', () => {
        expect(parseExtendStatus(FUYING_CHARGED)).toEqual({
            turns: 1,
            statusKind: 'buff',
            buffName: 'Stealth',
        });
    });

    it('leaves the generic active-voice arm alone (Ripper)', () => {
        expect(parseExtendStatus('All allies extend their active Buffs by 1 turn.')).toEqual({
            turns: 1,
            statusKind: 'buff',
        });
    });

    it('leaves the generic active-voice debuff arm alone (Sokol)', () => {
        expect(
            parseExtendStatus('This Unit deals 150% damage and extends active Debuffs by 1 turn.')
        ).toEqual({ turns: 1, statusKind: 'debuff' });
    });

    it('leaves the generic passive-voice arm alone (Lev)', () => {
        expect(
            parseExtendStatus(
                'When a critical hit occurs, all hit enemies have their debuffs extended by 1 turn ' +
                    'and all allies are granted Crit Power Up II for 2 turns.'
            )
        ).toEqual({ turns: 1, statusKind: 'debuff' });
    });

    it('does not match a status name separated from "extends" by other words (Belladonna/Wisteria shape)', () => {
        // "extends the newly applied <unit-skill>X</unit-skill> ... for/by N turn(s)" — the tag is
        // NOT adjacent to the verb, so the named arm (which requires immediate adjacency) must not
        // fire, and the generic arms (which require a literal buffs/debuffs token) must not either.
        expect(
            parseExtendStatus(
                'this Unit extends the newly applied <unit-skill>Acidic Decay</unit-skill> status ' +
                    'for 1 turn, with the chance to equal to its crit power.'
            )
        ).toBeNull();
    });

    it('returns null with no extend clause at all', () => {
        expect(parseExtendStatus('This Unit deals 100% damage.')).toBeNull();
    });
});

describe('parseExtendStatus — corpus sweep (non-vacuity + non-disturbance)', () => {
    it('the named arm fires on Fuying alone across the whole ship-skills corpus', () => {
        const named: string[] = [];
        for (const record of loadShipSkillRecords()) {
            for (const text of [record.active, record.charge, ...record.passives]) {
                if (!text) continue;
                const r = parseExtendStatus(text);
                if (r?.buffName !== undefined) named.push(`${record.name}:${r.buffName}`);
            }
        }
        expect(named).toEqual(['Fuying:Stealth']);
    });

    it('every OTHER extend-status match in the corpus still has no buffName (Sokol/Ripper/Lev unmoved)', () => {
        const generic: { name: string; result: ReturnType<typeof parseExtendStatus> }[] = [];
        for (const record of loadShipSkillRecords()) {
            for (const text of [record.active, record.charge, ...record.passives]) {
                if (!text) continue;
                const r = parseExtendStatus(text);
                if (r && r.buffName === undefined) generic.push({ name: record.name, result: r });
            }
        }
        // Sokol (charged debuff), Ripper (passive buff), Lev (charged debuff) — exactly 3 rows.
        expect(generic.map((g) => g.name).sort()).toEqual(['Lev', 'Ripper', 'Sokol']);
        for (const g of generic) expect(g.result?.buffName).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// 2. StatusEngine — the buffName filter, in isolation
// ---------------------------------------------------------------------------
function timedSelfStatus(
    buffName: string,
    duration: number
): Extract<RegisteredAbilityStatus, { kind: 'timed' }> {
    return {
        kind: 'timed',
        side: 'self',
        sourceSlot: 'active',
        conditions: [],
        duration,
        payload: { buffName, stacks: 1, parsedEffects: {} },
    };
}

const selfBuffTurns = (eng: StatusEngine, ownerId: string, buffName: string): number | undefined =>
    eng.timedAbilityStatuses('self', ownerId).find((s) => s.payload.buffName === buffName)?.active
        .turnsRemaining as number | undefined;

describe('StatusEngine.extendAllBuffsDuration — buffName filter (#363)', () => {
    it('extends ONLY the named buff, leaving a sibling buff untouched', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        eng.applyTimedAbilityStatus(1, timedSelfStatus('Stealth', 1), 'a');
        eng.applyTimedAbilityStatus(1, timedSelfStatus('Security Up III', 2), 'a');

        const affected = eng.extendAllBuffsDuration('a', 1, 'Stealth');

        expect(affected).toBe(1);
        expect(selfBuffTurns(eng, 'a', 'Stealth')).toBe(2);
        expect(selfBuffTurns(eng, 'a', 'Security Up III')).toBe(2); // unchanged
    });

    it('with no buffName, extends everything (Ripper unchanged)', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        eng.applyTimedAbilityStatus(1, timedSelfStatus('Stealth', 1), 'a');
        eng.applyTimedAbilityStatus(1, timedSelfStatus('Security Up III', 2), 'a');

        const affected = eng.extendAllBuffsDuration('a', 1);

        expect(affected).toBe(2);
        expect(selfBuffTurns(eng, 'a', 'Stealth')).toBe(2);
        expect(selfBuffTurns(eng, 'a', 'Security Up III')).toBe(3);
    });

    it('a named extension for a buff the actor does not hold affects nothing', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        eng.applyTimedAbilityStatus(1, timedSelfStatus('Security Up III', 2), 'a');

        const affected = eng.extendAllBuffsDuration('a', 1, 'Stealth');

        expect(affected).toBe(0);
        expect(selfBuffTurns(eng, 'a', 'Security Up III')).toBe(2);
    });

    it('PROVE THE INSTRUMENT: without the buffName filter this fixture would be vacuous', () => {
        // Same setup as the first test, but calling the OLD 2-arg shape (no name) proves the
        // sibling buff DOES grow when nothing restricts it — i.e. the filter above is doing real
        // work, not just failing to break anything.
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        eng.applyTimedAbilityStatus(1, timedSelfStatus('Stealth', 1), 'a');
        eng.applyTimedAbilityStatus(1, timedSelfStatus('Security Up III', 2), 'a');

        eng.extendAllBuffsDuration('a', 1);

        expect(selfBuffTurns(eng, 'a', 'Security Up III')).toBe(3); // grew — the filter is what stops this
    });

    // #363 hardening (item 2): `s.buffName !== buffName` is EXACT-name equality. A substring
    // rewrite (`s.buffName.includes(buffName)`) would leave every test above green, because none
    // of them seed a status name that collides with "Stealth" as a sub/superstring. These two
    // pin exactness in both directions.
    it('does NOT extend a SUPERSTRING-colliding buff ("Greater Stealth" must not move when extending "Stealth")', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        eng.applyTimedAbilityStatus(1, timedSelfStatus('Stealth', 1), 'a');
        eng.applyTimedAbilityStatus(1, timedSelfStatus('Greater Stealth', 2), 'a');

        // PRE-CONDITION: both statuses are actually present before the extension runs.
        expect(selfBuffTurns(eng, 'a', 'Stealth')).toBe(1);
        expect(selfBuffTurns(eng, 'a', 'Greater Stealth')).toBe(2);

        const affected = eng.extendAllBuffsDuration('a', 1, 'Stealth');

        expect(affected).toBe(1);
        expect(selfBuffTurns(eng, 'a', 'Stealth')).toBe(2);
        // A `.includes` rewrite would match here too ("Greater Stealth".includes("Stealth")) and
        // wrongly grow this to 3.
        expect(selfBuffTurns(eng, 'a', 'Greater Stealth')).toBe(2);
    });

    it('does NOT extend when the named filter is a SUBSTRING of the held buff ("Steal" must not reach "Stealth")', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        eng.applyTimedAbilityStatus(1, timedSelfStatus('Stealth', 1), 'a');

        // PRE-CONDITION.
        expect(selfBuffTurns(eng, 'a', 'Stealth')).toBe(1);

        // "Steal" names no real status — the point is purely that "Stealth".includes("Steal")
        // would be true under a substring rewrite, in the OPPOSITE direction from the test above.
        const affected = eng.extendAllBuffsDuration('a', 1, 'Steal');

        expect(affected).toBe(0);
        expect(selfBuffTurns(eng, 'a', 'Stealth')).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// 3. Build site — buildShipAbilities on Fuying's REAL kit
// ---------------------------------------------------------------------------
/** The REAL corpus Ship. `buildTraceShip` defaults to refitLevel 4. */
const fuyingShip = () => {
    const s = buildTraceShip('Fuying');
    if (!s) throw new Error('Fuying missing from the corpus');
    return s;
};

/** Fuying's real extend-status ability, exactly as `buildShipAbilities` emits it — never
 *  hand-written. Throws (rather than returning undefined) so every consumer fails loudly if the
 *  build site ever stops emitting it. */
function fuyingStealthExtendAbility(): Ability {
    const built = buildShipAbilities(fuyingShip());
    const ability = built.slots
        .flatMap((s) => s.abilities)
        .find(
            (a) =>
                a.type === 'extend-status' &&
                a.config.type === 'extend-status' &&
                a.config.buffName === 'Stealth'
        );
    if (!ability) throw new Error('Fuying built no named Stealth extend-status ability');
    return ability;
}

describe('buildShipAbilities — Fuying’s named Stealth extension (#363)', () => {
    it('builds an all-allies, on-cast extend-status with buffName Stealth and turns 1, through PRODUCTION slot routing', () => {
        const ability = fuyingStealthExtendAbility();
        expect(ability.target).toBe('all-allies');
        expect(ability.trigger).toBe('on-cast');
        expect(ability.config).toMatchObject({
            type: 'extend-status',
            statusKind: 'buff',
            turns: 1,
            buffName: 'Stealth',
        });
    });

    it('carries NO factionFilter — owner ruling: this clause is faction-blind, unlike her active grant', () => {
        const ability = fuyingStealthExtendAbility();
        expect(ability.factionFilter).toBeUndefined();
    });

    it('sits on the charged slot (her charged skill is the one with this clause)', () => {
        const built = buildShipAbilities(fuyingShip());
        const chargedSlot = built.slots.find((s) => s.slot === 'charged');
        expect(chargedSlot?.abilities).toContainEqual(fuyingStealthExtendAbility());
    });

    it('does not disturb her cleanse ability on the same charged slot', () => {
        const built = buildShipAbilities(fuyingShip());
        const chargedSlot = built.slots.find((s) => s.slot === 'charged');
        const cleanse = chargedSlot?.abilities.find((a) => a.config.type === 'cleanse');
        expect(cleanse).toBeDefined();
        expect(cleanse?.config).toMatchObject({ type: 'cleanse', countScaling: { per: 50 } });
    });

    it('her active-slot Stealth grant is unaffected (still faction-filtered, unlike the extension)', () => {
        const built = buildShipAbilities(fuyingShip());
        const grant = built.slots
            .flatMap((s) => s.abilities)
            .find((a) => a.config.type === 'buff' && a.config.buffName === 'Stealth');
        expect(grant?.factionFilter).toEqual(['TIANCHAO']);
    });
});

// ---------------------------------------------------------------------------
// 4. Engine wiring — Fuying's REAL ability, fired through the REAL executor, over her REAL
//    footprint (Pattern-Wings-Support-Not-Self-Range-2 @ T2 → {M2, M3, B1, B2, B3} per the
//    already-verified geometry table in fuyingFactionScope.integration.test.ts).
// ---------------------------------------------------------------------------
const ATTACKER_AFFINITY: AffinityName = 'thermal';

const baseStats = () => ({
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    shieldPenetration: 0,
    defence: 0,
    hp: 1_000_000_000,
    speed: 100,
});

function makeFuyingRuntime(ability: Ability, position: Position): PlayerActorRuntime {
    const actor = createActor({
        id: 'fuying',
        side: 'player',
        kind: 'attacker',
        stats: baseStats(),
        position,
        chargeCount: 0, // charges >= 0 always true → charged fires immediately
        startCharged: true,
    });
    const skills: ShipSkills = { slots: [{ slot: 'charged', abilities: [ability] }] };
    return {
        actor,
        focus: true,
        castSkills: skills,
        reactiveAbilities: [],
        timedSelfBySlot: [],
        timedEnemyBySlot: [],
        hasChargedSkill: true,
        attack: 0,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        defence: 0,
        hp: 1_000_000_000,
        healModifier: 0,
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        affinityDisadvantage: false,
        attackerAffinity: ATTACKER_AFFINITY,
        activeCritGate: () => false,
        chargedCritGate: () => false,
        activeHealCritGate: () => false,
        chargedHealCritGate: () => false,
        debuffLandingGate: makeRateGate(),
        extendChanceGate: makeRateGate(),
        landsTimedEnemyApplication: () => true,
        selfBuffLookup: new Map(),
        enemyDebuffLookup: new Map(),
    };
}

function makeAlly(id: string, position: Position): CombatActor {
    return createActor({
        id,
        side: 'player',
        kind: 'team',
        stats: baseStats(),
        position,
    });
}

function makeHarmlessEnemy(): CombatActor {
    return createActor({
        id: 'enemy1',
        side: 'enemy',
        kind: 'enemy',
        stats: { ...baseStats(), attack: 0, hp: 1_000_000_000 },
        position: 'M1' as Position,
    });
}

/** Seeds a timed self-buff for an ally directly on the shared StatusEngine, exactly as an
 *  earlier grant would have (mirrors extendStatusCastPath.test.ts's seedSelfBuff). */
function seedSelfBuff(
    statusEngine: StatusEngine,
    ownerId: string,
    buffName: string,
    duration: number,
    round = 1
): void {
    const status: Extract<RegisteredAbilityStatus, { kind: 'timed' }> = {
        kind: 'timed',
        side: 'self',
        sourceSlot: 'active',
        conditions: [],
        duration,
        payload: { buffName, stacks: 1, parsedEffects: {} },
    };
    statusEngine.applyTimedAbilityStatus(round, status, ownerId);
}

describe('Fuying’s named Stealth extension — production engine wiring (#363)', () => {
    // Fuying at T2, her REAL activePattern. Footprint (human-verified in
    // fuyingFactionScope.integration.test.ts): {M2, M3, B1, B2, B3}. M1 is OUTSIDE.
    const FUYING_POSITION: Position = 'T2';
    const activePattern = () => {
        const ship = fuyingShip();
        if (!ship.activePattern) throw new Error('Fuying has no activePattern');
        expect(ship.activePattern).toBe('Pattern-Wings-Support-Not-Self-Range-2');
        expect(ship.chargedPattern).toBeUndefined(); // confirms the charged slot INHERITS the active pattern
        return parsePattern(ship.activePattern);
    };

    it('PRE-CONDITION: the footprint from her real pattern includes M2/M3 and excludes M1', () => {
        const fuying = createActor({
            id: 'fuying',
            side: 'player',
            kind: 'attacker',
            stats: baseStats(),
            position: FUYING_POSITION,
        });
        const allyM1 = makeAlly('ally-outside', 'M1' as Position);
        const allyM2 = makeAlly('ally-xaoc', 'M2' as Position);
        const allyM3 = makeAlly('ally-tianchao', 'M3' as Position);
        const footprint = supportFootprintAllyIds({
            pattern: activePattern(),
            anchor: fuying.position,
            sameSideLiving: [fuying, allyM1, allyM2, allyM3],
        });
        expect(footprint).toBeDefined();
        expect(new Set(footprint)).toEqual(new Set(['ally-xaoc', 'ally-tianchao']));
        expect(footprint).not.toContain('ally-outside');
        expect(footprint).not.toContain('fuying'); // Not-Self: she is never her own recipient
    });

    it('scopes both ways, faction-blind, and by name — all in one production-routed cast', () => {
        const ability = fuyingStealthExtendAbility();
        const fuyingRuntime = makeFuyingRuntime(ability, FUYING_POSITION);
        const allyOutside = makeAlly('ally-outside', 'M1' as Position); // Tianchao-eligible position, OUTSIDE footprint
        const allyXaoc = makeAlly('ally-xaoc', 'M2' as Position); // INSIDE footprint, NON-Tianchao
        const allyTianchao = makeAlly('ally-tianchao', 'M3' as Position); // INSIDE footprint

        const statusEngine = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        statusEngine.beginRound(1);
        seedSelfBuff(statusEngine, 'ally-outside', 'Stealth', 1);
        seedSelfBuff(statusEngine, 'ally-xaoc', 'Stealth', 1);
        seedSelfBuff(statusEngine, 'ally-tianchao', 'Stealth', 1);
        seedSelfBuff(statusEngine, 'ally-tianchao', 'Security Up III', 2); // sibling buff — must NOT move

        // PRE-CONDITION (non-vacuity): every watched ally actually holds Stealth before the cast,
        // and the ability that is about to fire is really Fuying's real built ability.
        expect(selfBuffTurns(statusEngine, 'ally-outside', 'Stealth')).toBe(1);
        expect(selfBuffTurns(statusEngine, 'ally-xaoc', 'Stealth')).toBe(1);
        expect(selfBuffTurns(statusEngine, 'ally-tianchao', 'Stealth')).toBe(1);
        expect(selfBuffTurns(statusEngine, 'ally-tianchao', 'Security Up III')).toBe(2);
        expect(ability.config.type).toBe('extend-status');
        expect(fuyingRuntime.actor.charges).toBeGreaterThanOrEqual(0);

        const enemy = makeHarmlessEnemy();
        const args: PlayerTurnArgs = {
            runtime: fuyingRuntime,
            enemy,
            statusEngine,
            corrosionEntries: [],
            infernoEntries: [],
            genericDoTEntries: [],
            pendingBombs: [],
            pendingAccumulators: [],
            enemyDefense: 0,
            enemyHp: enemy.currentHp,
            enemyType: undefined,
            bus: createEventBus(),
            round: 1,
            targetId: undefined, // the buff branch needs no enemy target
            activePattern: activePattern(),
            sameSideLiving: [fuyingRuntime.actor, allyOutside, allyXaoc, allyTianchao],
        } as PlayerTurnArgs;

        // PRE-CONDITION: her charged skill actually fires this turn (charges >= chargeCount(0)).
        expect(fuyingRuntime.hasChargedSkill && fuyingRuntime.actor.charges >= 0).toBe(true);

        runPlayerTurn(args);

        // Requirement 1: N -> N+1 for an ally the extension reaches.
        expect(selfBuffTurns(statusEngine, 'ally-tianchao', 'Stealth')).toBe(2);

        // Requirement 2: scoped both ways — outside the pattern gets nothing...
        expect(selfBuffTurns(statusEngine, 'ally-outside', 'Stealth')).toBe(1);
        // ...and faction-blind — a NON-Tianchao ally INSIDE the pattern DOES get it (this is what
        // distinguishes this clause from her active Tianchao-scoped grant).
        expect(selfBuffTurns(statusEngine, 'ally-xaoc', 'Stealth')).toBe(2);

        // Requirement 3: the name filter — the sibling buff on the SAME extended ally is untouched.
        expect(selfBuffTurns(statusEngine, 'ally-tianchao', 'Security Up III')).toBe(2);
    });
});
