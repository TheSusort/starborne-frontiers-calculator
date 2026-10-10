/**
 * A DoT carries the verb its source text states (`dot-applied.application`), and every
 * debuff-inflicted-family listener's DoT arm reads it through `passesApplicationFilter` — the same
 * #593 split the debuff arms already read. Only the Burner gear set's "Applies Inferno 1 for 2
 * turns." says "applies"; every corpus DoT clause says "inflicts" and carries no stamp (an inflict).
 *
 * Part 1 is a hand-rolled-bus unit of the three DoT arms (precise per-arm wiring). Part 2 runs
 * Hemlock's real parsed passive ("gains 1 charge … after it inflicts a debuff") with 4-piece
 * Burner through `runCombat`, on both sides.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { registerReactiveListeners, Intent, ReactiveAbility } from '../triggers';
import { buildEquipmentAbilities } from '../../abilities/buildEquipmentAbilities';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import type { Ability, AbilityTrigger, ShipSkills } from '../../../types/abilities';
import type { GearPiece } from '../../../types/gear';
import type { Ship } from '../../../types/ship';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

// =============================================================================================
// Part 1 — the three DoT arms
// =============================================================================================
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

function register(
    trigger: AbilityTrigger,
    filter: 'inflict' | 'apply'
): {
    bus: ReturnType<typeof makeHandBus>;
    enqueued: Intent[];
} {
    const bus = makeHandBus();
    const enqueued: Intent[] = [];
    const ability: Ability = {
        id: `react-${trigger}`,
        type: 'damage',
        target: 'enemy',
        trigger,
        triggerApplicationFilter: filter,
        conditions: [],
        config: { type: 'damage', multiplier: 50 },
    };
    const ra: ReactiveAbility = { ability, sourceSlot: 'passive' };
    registerReactiveListeners({
        bus,
        perOwner: [{ ownerId: 'owner', reactiveAbilities: [ra] }],
        enqueue: (intent) => enqueued.push(intent),
        isOpposing: (id) => id === 'enemy',
    });
    return { bus, enqueued };
}

const dot = (sourceId: string, application?: 'inflict' | 'apply'): CombatEvent => ({
    type: 'dot-applied',
    sourceId,
    targetId: 'enemy',
    round: 1,
    dotType: 'inferno',
    stacks: 1,
    ...(application ? { application } : {}),
});

// The DoT's source: the owner itself for on-debuff-inflicted, another same-side ally for the two
// ally triggers (on-other-ally-debuff-inflicted excludes the owner).
const ARMS: [AbilityTrigger, string][] = [
    ['on-debuff-inflicted', 'owner'],
    ['on-ally-debuff-inflicted', 'ally'],
    ['on-other-ally-debuff-inflicted', 'ally'],
];

describe.each(ARMS)('%s — a DoT arm reads the DoT’s own verb', (trigger, source) => {
    it("an 'inflict' reaction: an applied DoT wakes nothing; an unstamped or inflicted one does", () => {
        const { bus, enqueued } = register(trigger, 'inflict');
        bus.emit(dot(source, 'apply'));
        expect(enqueued).toHaveLength(0);
        bus.emit(dot(source));
        expect(enqueued).toHaveLength(1);
        bus.emit(dot(source, 'inflict'));
        expect(enqueued).toHaveLength(2);
    });

    it("an 'apply' reaction: only an applied DoT wakes it", () => {
        const { bus, enqueued } = register(trigger, 'apply');
        bus.emit(dot(source));
        bus.emit(dot(source, 'inflict'));
        expect(enqueued).toHaveLength(0);
        bus.emit(dot(source, 'apply'));
        expect(enqueued).toHaveLength(1);
    });
});

// =============================================================================================
// Part 2 — Hemlock + 4-piece Burner, real parsed passive (verbatim from docs/ship-skills.csv)
// =============================================================================================
const HEMLOCK_PASSIVE_R0 =
    'This Unit <unit-aid>gains 1 charge</unit-aid> to its charged skill after it inflicts a <unit-aid>debuff</unit-aid>.';

const burner = (): Ability[] => {
    const gear: Record<string, string> = {};
    const pieces: Record<string, GearPiece> = {};
    (['weapon', 'hull', 'generator', 'sensor'] as const).forEach((slot, i) => {
        gear[slot] = `burn-${i}`;
        pieces[`burn-${i}`] = {
            id: `burn-${i}`,
            slot,
            rarity: 'legendary',
            setBonus: 'BURNER',
        } as GearPiece;
    });
    const built = buildEquipmentAbilities(
        { implants: {}, equipment: gear } as unknown as Ship,
        (id) => pieces[id]
    );
    if (!built.some((a) => a.config.type === 'dot')) throw new Error('Burner missing');
    return built;
};

const hit = (): Ability => ({
    id: 'plain-hit',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100, hits: 1 },
});
const inflictDebuff = (): Ability => ({
    id: 'cast-seed',
    type: 'debuff',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'debuff',
        buffName: 'Seed Down',
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        application: 'inflict',
        duration: 2,
    },
});

/** Hemlock's parsed passive + Burner; the active hits, and inflicts Seed Down when asked. */
const hemlockSkills = (inflicts: boolean): ShipSkills => {
    const passive =
        buildShipAbilities({
            refits: [],
            firstPassiveSkillText: HEMLOCK_PASSIVE_R0,
        } as unknown as Ship).slots.find((s) => s.slot === 'passive')?.abilities ?? [];
    if (!passive.some((a) => a.config.type === 'charge')) throw new Error('Hemlock charge missing');
    return {
        slots: [
            { slot: 'active', abilities: inflicts ? [hit(), inflictDebuff()] : [hit()] },
            { slot: 'passive', abilities: [...passive, ...burner()] },
        ],
    };
};

const frontTarget = (): ParsedTarget => ({ raw: 'front', side: 'enemy', selection: 'front' });
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

const BASE = (over: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    enemyAttackers: [
        {
            id: 'foe',
            stats: {
                attack: 1000,
                crit: 0,
                critDamage: 0,
                defence: 0,
                hp: 1e12,
                speed: 1,
                security: 0,
            },
            chargeCount: 0,
            startCharged: false,
            position: 'M4',
            shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
        },
    ],
    attack: 100,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 6,
    shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
    numRounds: 1,
    selfBuffs: [],
    enemyDebuffs: [],
    hasChargedSkill: true,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: 1e12,
    hacking: 200,
    speed: 100,
    healTargetId: 'attacker',
    mode: 'healing',
    position: 'M4',
    target: frontTarget(),
    pattern: basePattern(),
    ...over,
});

const enemyHemlock = (inflicts: boolean): EnemyAttacker => ({
    id: 'hemlock',
    stats: { attack: 100, crit: 0, critDamage: 0, defence: 0, hp: 1e12, speed: 200, hacking: 200 },
    chargeCount: 6,
    startCharged: false,
    position: 'M4',
    target: frontTarget(),
    pattern: basePattern(),
    shipSkills: hemlockSkills(inflicts),
});

const run = (input: CombatEngineInput) => {
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    for (const type of ['charge-changed', 'dot-applied'] as const)
        bus.on(type, (e) => events.push(e as CombatEvent));
    runCombat({ ...input, bus });
    return events;
};
/** Charges Hemlock's passive granted (every 'manip' gain on these boards is hers). */
const passiveCharges = (events: CombatEvent[], actorId: string) =>
    events.filter(
        (e) =>
            e.type === 'charge-changed' &&
            e.actorId === actorId &&
            e.reason === 'manip' &&
            e.newCharge > e.oldCharge
    ).length;
const infernos = (events: CombatEvent[], sourceId: string) =>
    events.filter(
        (e) => e.type === 'dot-applied' && e.sourceId === sourceId && e.dotType === 'inferno'
    ).length;

beforeEach(() => {
    setupKeyedRng(5);
});

describe('Hemlock + Burner — "after it inflicts a debuff" does not see Burner’s applied Inferno', () => {
    it('player side: a plain hit lands Burner’s Inferno and gains no charge; an inflicted debuff gains one', () => {
        let events = run(BASE({ shipSkills: hemlockSkills(false) }));
        expect(infernos(events, 'attacker')).toBe(1);
        expect(passiveCharges(events, 'attacker')).toBe(0);

        events = run(BASE({ shipSkills: hemlockSkills(true) }));
        expect(infernos(events, 'attacker')).toBe(1);
        expect(passiveCharges(events, 'attacker')).toBe(1);
    });

    it('enemy side: the same', () => {
        const board = (inflicts: boolean) =>
            BASE({ attack: 0, speed: 1, security: 0, enemyAttackers: [enemyHemlock(inflicts)] });
        let events = run(board(false));
        expect(infernos(events, 'hemlock')).toBe(1);
        expect(passiveCharges(events, 'hemlock')).toBe(0);

        events = run(board(true));
        expect(infernos(events, 'hemlock')).toBe(1);
        expect(passiveCharges(events, 'hemlock')).toBe(1);
    });
});
