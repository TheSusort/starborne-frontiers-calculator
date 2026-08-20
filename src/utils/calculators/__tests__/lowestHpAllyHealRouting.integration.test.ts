/**
 * SP-4e Task 3 — the BEHAVIOUR this rung changes, on REAL kits.
 *
 * Task 3 flips one parser regex, and that flip is the whole reason the healing calculator stops
 * routing a text-named worst-HP repair to the user's chosen focus ship. Nothing in the existing
 * golden suites can see it:
 *
 *   • `realKitFingerprints.test.ts` runs all three ships but is deliberately STRUCTURAL — it
 *     records the token `heal`, never the recipient — so a recipient change is invisible to it.
 *   • `healingGoldenParity.test.ts` is the numeric referee, but its "Tithonus/Pallas shape"
 *     (scenario 10) and "Valkyrie shape" (scenario 11) fixtures HAND-WRITE `target: 'all-allies'`
 *     / `target: 'ally'`. They pin the shape, never what the ships' own text parses to, so they
 *     are structurally immune to the flip.
 *
 * So this file is the missing coverage. Every case is TWO-ARMED: the same real kit is run once as
 * parsed (`'lowest-hp-ally'`) and once with the recipient rewound to `'ally'` — the exact and only
 * field Task 3 changed, i.e. the pre-Task-3 production value. A test that only asserted the new
 * arm could go quietly vacuous if the fixture stopped healing at all; asserting BOTH arms means
 * the delta itself is pinned, and the legacy arm doubles as documentation of the defect.
 *
 * Reference data (docs/ship-data.json, docs/ship-skills.csv) is gitignored dev-only, so these skip
 * on a clean checkout.
 */
import { describe, it, expect } from 'vitest';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import {
    simulateHealing,
    type EnemyAttackerInput,
    type HealerStats,
    type HealingSimulationInput,
} from '../healingEngineAdapter';
import { createEventBus } from '../../combat/events';
import { setupKeyedTestRng } from '../rateAccumulator';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { ShipSkills } from '../../../types/abilities';
import type { TeamActorInput } from '../../../types/calculator';

const REFERENCE_DATA = csvAvailable() && shipDataAvailable();

/** The user's configured heal target — the "focus" the calculator used to route everything to. */
const FOCUS = 'ally-focus';
/** A second ally, deliberately at a LOWER HP fraction than the focus for the whole window. */
const WORST = 'ally-worst';

const HEALER: HealerStats = {
    hp: 50_000,
    attack: 10_000,
    defence: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    healModifier: 0,
    hacking: 200,
    speed: 300,
};

const ally = (id: string, position: 'M3' | 'M4', hp: number): TeamActorInput => ({
    id,
    speed: 10,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    shipSkills: { slots: [] },
    stats: {
        attack: 0,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        hacking: 200,
        defence: 0,
        hp,
    },
    position,
});

/**
 * The enemy is FAST (speed 900 vs the healer's 300) so it strikes before the first repair — the
 * round-1 board is already asymmetric, rather than a full-HP tie the selector would resolve by
 * source order (which is the focus, making round 1 blind to the change).
 */
const foe = (): EnemyAttackerInput => ({
    id: 'enemy-1',
    stats: {
        attack: 3_000,
        crit: 0,
        critDamage: 0,
        speed: 900,
        defence: 0,
        hp: 5_000_000,
        security: 100,
    },
    chargeCount: 0,
    startCharged: false,
    position: 'M4' as const,
    target: parseTarget('all'),
    pattern: parsePattern('Pattern-Circle-Range-1'),
});

/**
 * Equal absolute intake, unequal max HP → WORST sits at a strictly lower HP FRACTION every round
 * while both stay alive. Both halves matter: a dead ally would leave the selector one candidate
 * and mask the change, and an equal FRACTION would make the two arms agree by tie-break.
 */
const FOCUS_MAX_HP = 100_000;
const WORST_MAX_HP = 20_000;

/** The real ship's kit; `arm: 'legacy'` rewinds the parsed selector to its pre-Task-3 value. */
function kitFor(shipName: string, arm: 'legacy' | 'selector'): ShipSkills {
    const ship = buildTraceShip(shipName);
    if (!ship) throw new Error(`buildTraceShip returned nothing for ${shipName}`);
    const skills = buildShipAbilities(ship);
    if (arm === 'legacy')
        for (const slot of skills.slots)
            for (const a of slot.abilities) if (a.target === 'lowest-hp-ally') a.target = 'ally';
    return skills;
}

interface Observed {
    /** `heal-performed` recipient ids, in emission order, deduped per cast. */
    recipients: string[];
    /** Recipients with a non-zero effective total, from the summary's per-recipient report. */
    healedIds: string[];
}

function runHealing(
    shipName: string,
    arm: 'legacy' | 'selector',
    team: TeamActorInput[]
): Observed {
    setupKeyedTestRng(4242);
    const skills = kitFor(shipName, arm);
    const recipients: string[] = [];
    const bus = createEventBus();
    bus.on('heal-performed', (e) => {
        const ev = e as unknown as {
            perTarget?: { targetId: string }[];
            targets?: string[];
        };
        for (const id of ev.perTarget?.map((p) => p.targetId) ?? ev.targets ?? []) {
            if (!recipients.includes(id)) recipients.push(id);
        }
    });
    const input: HealingSimulationInput = {
        healer: HEALER,
        chargeCount: 0,
        shipSkills: skills,
        selfBuffs: [],
        healTargetId: team.length > 0 ? FOCUS : 'attacker',
        enemies: [foe()],
        rounds: 4,
        healerPosition: 'M2',
        healerTargeting: {
            active: { target: parseTarget('all'), pattern: parsePattern('Pattern-Base') },
        },
        teamActors: team,
        bus,
    };
    const result = simulateHealing(input);
    const per = result.summary.perRecipient ?? {};
    return {
        recipients,
        healedIds: Object.entries(per)
            .filter(([, v]) => (v as { totalEffectiveHealing: number }).totalEffectiveHealing > 0)
            .map(([id]) => id)
            .sort(),
    };
}

const fullTeam = () => [ally(FOCUS, 'M3', FOCUS_MAX_HP), ally(WORST, 'M4', WORST_MAX_HP)];

describe('SP-4e: a text-named worst-HP repair reaches the worst-HP ally, not the configured focus', () => {
    // Pallas: ACTIVE slot, "The other ally with the lowest current health percentage heals for
    // 20% of the damage dealt".
    it.skipIf(!REFERENCE_DATA)('Pallas moves off the heal target onto the worst-HP ally', () => {
        const legacy = runHealing('Pallas', 'legacy', fullTeam());
        const selector = runHealing('Pallas', 'selector', fullTeam());
        // LEGACY: `mode: 'healing'` means teamBattle === false, so a plain-'ally' heal based on
        // `[healing.targetId]` — the user's chosen focus. This is defect D3.
        expect(legacy.recipients).toEqual([FOCUS]);
        expect(legacy.healedIds).toEqual([FOCUS]);
        // SELECTOR: her own text names the recipient, so the run-mode flag stops deciding it.
        expect(selector.recipients).toEqual([WORST]);
        expect(selector.healedIds).toEqual([WORST]);
    });

    // Volk: PASSIVE slot, "repairs 30% of its Max HP to the ally with the most missing health"
    // — loose phrasing for lowest HP PERCENTAGE, the same selector.
    it.skipIf(!REFERENCE_DATA)('Volk moves off the heal target onto the worst-HP ally', () => {
        const legacy = runHealing('Volk', 'legacy', fullTeam());
        const selector = runHealing('Volk', 'selector', fullTeam());
        expect(legacy.recipients).toContain(FOCUS);
        expect(legacy.recipients).not.toContain(WORST);
        expect(selector.recipients).toContain(WORST);
        expect(selector.recipients).not.toContain(FOCUS);
    });

    // "The OTHER ally" — with nobody else alive there is no recipient, and the pre-4e
    // `?? actor.id` tail made that a self-heal her text forbids.
    it.skipIf(!REFERENCE_DATA)('Pallas heals NOBODY when she is the only living ally', () => {
        const legacy = runHealing('Pallas', 'legacy', []);
        const selector = runHealing('Pallas', 'selector', []);
        // LEGACY: the self-fallback fires — the caster repairs itself.
        expect(legacy.recipients).toEqual(['attacker']);
        // SELECTOR: no recipient at all. Anti-vacuity is the legacy arm above: the fixture
        // demonstrably CAN produce a heal here, so an empty list is a routing answer, not a
        // fixture that never cast.
        expect(selector.recipients).toEqual([]);
    });
});
