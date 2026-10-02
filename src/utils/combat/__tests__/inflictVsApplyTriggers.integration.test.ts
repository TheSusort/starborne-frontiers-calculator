/**
 * Owner ruling (2026-10-01): a skill text that reacts to a debuff being "inflicted" reacts ONLY
 * to a successful hacking-roll infliction, never to an unconditional "apply" (Provoke,
 * Concentrate Fire, Disable). The literal verb is read the other way too — "applying" reacts only
 * to an apply. Warden (`on-debuff-inflicted`) is covered in wave7WardenDebuffInflicted; this file
 * covers the remaining corpus members of the family: Oleander (`on-ally-debuff-inflicted`),
 * Hayyan (`on-ally-debuffed` — her own clause reads "inflicted" despite the trigger's name), and
 * Yuyan, the sole "apply"-literal member (`on-debuff-inflicted` with `triggerApplicationFilter:
 * 'apply'`).
 *
 * Each ability is the REAL parsed kit (buildShipAbilities on verbatim docs/ship-skills.csv text),
 * registered directly via registerReactiveListeners and driven with synthetic debuff-applied
 * events — the same hand-rolled-bus pattern as providerOtherAllyDebuffReaction's Part 1, which
 * proves the LISTENER wiring precisely without fighting positional targeting/landing rolls.
 */
import { describe, it, expect } from 'vitest';
import { registerReactiveListeners, Intent, ReactiveAbility } from '../triggers';
import { CombatEvent } from '../events';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import type { Ship } from '../../../types/ship';
import type { Ability } from '../../../types/abilities';

function ship(over: Partial<Ship>): Ship {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ...({} as any), refits: [], ...over } as Ship;
}

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

function registerSingle(
    handBus: ReturnType<typeof makeHandBus>,
    ownerId: string,
    ability: Ability,
    opts: { isOpposing: (id: string) => boolean }
): Intent[] {
    const enqueued: Intent[] = [];
    const ra: ReactiveAbility = { ability, sourceSlot: 'passive' };
    registerReactiveListeners({
        bus: handBus,
        perOwner: [{ ownerId, reactiveAbilities: [ra] }],
        enqueue: (intent) => enqueued.push(intent),
        isOpposing: opts.isOpposing,
    });
    return enqueued;
}

// Verbatim from docs/ship-skills.csv.
const OLEANDER_P2 =
    "When an ally inflicts a debuff, this Unit <unit-aid>adds 1 charge</unit-aid> to it's Charged Skill and then, once per ally per round, grants <unit-skill>Repair Over Time II</unit-skill> to that Ally for 2 turns.";
const HAYYAN_P2 =
    "When <unit-aid>cleansing a</unit-aid> Debuff from an Ally, this Unit <unit-damage>repairs the ally for 4%</unit-damage> of this Unit's Max HP.<br /><br />When a debuff is inflicted on an ally, this Unit <unit-damage>repairs the ally for 6%</unit-damage> of this Unit's Max HP.";
const YUYAN_P2 =
    'This Unit gains <unit-skill>Stealth</unit-skill> for 2 turns and <unit-skill>Tianchao Precision II</unit-skill> for 3 turns when applying a debuff.';

function abilitiesFor(ship_: Ship): Ability[] {
    return buildShipAbilities(ship_)
        .slots.filter((s) => s.slot === 'passive')
        .flatMap((s) => s.abilities);
}

describe('Oleander — on-ally-debuff-inflicted gated on the clause\'s own "inflicts" verb', () => {
    const oleander = ship({
        refits: [{}, {}] as Ship['refits'],
        secondPassiveSkillText: OLEANDER_P2,
    });
    const abilities = abilitiesFor(oleander);
    const chargeAbility = abilities.find((a) => a.type === 'charge')!;
    const rotAbility = abilities.find((a) => a.type === 'buff')!;

    it('parses both abilities with triggerApplicationFilter: inflict', () => {
        expect(chargeAbility.triggerApplicationFilter).toBe('inflict');
        expect(rotAbility.triggerApplicationFilter).toBe('inflict');
    });

    it('an ally applying Concentrate Fire gives her nothing (no charge, no Repair Over Time II)', () => {
        const handBus = makeHandBus();
        const enqueuedCharge = registerSingle(handBus, 'oleander', chargeAbility, {
            isOpposing: (id) => id === 'enemy',
        });
        const enqueuedRot = registerSingle(handBus, 'oleander', rotAbility, {
            isOpposing: (id) => id === 'enemy',
        });
        handBus.emit({
            type: 'debuff-applied',
            sourceId: 'judge',
            targetId: 'e1',
            round: 1,
            buffName: 'Concentrate Fire',
            application: 'apply',
        });
        expect(enqueuedCharge).toHaveLength(0);
        expect(enqueuedRot).toHaveLength(0);
    });

    it("an ally's inflicted debuff charges her Charged Skill and grants Repair Over Time II", () => {
        const handBus = makeHandBus();
        const enqueuedCharge = registerSingle(handBus, 'oleander', chargeAbility, {
            isOpposing: (id) => id === 'enemy',
        });
        const enqueuedRot = registerSingle(handBus, 'oleander', rotAbility, {
            isOpposing: (id) => id === 'enemy',
        });
        handBus.emit({
            type: 'debuff-applied',
            sourceId: 'judge',
            targetId: 'e1',
            round: 1,
            buffName: 'Attack Down III',
            application: 'inflict',
        });
        expect(enqueuedCharge).toHaveLength(1);
        expect(enqueuedRot).toHaveLength(1);
    });
});

describe('Hayyan — on-ally-debuffed gated on her OWN "inflicted" wording', () => {
    const hayyan = ship({
        refits: [{}, {}] as Ship['refits'],
        secondPassiveSkillText: HAYYAN_P2,
    });
    const repairAbility = abilitiesFor(hayyan).find((a) => a.trigger === 'on-ally-debuffed')!;

    it('parses with triggerApplicationFilter: inflict', () => {
        expect(repairAbility).toBeDefined();
        expect(repairAbility.triggerApplicationFilter).toBe('inflict');
    });

    it('an enemy applying Provoke to her ally gives her nothing', () => {
        const handBus = makeHandBus();
        const enqueued = registerSingle(handBus, 'hayyan', repairAbility, {
            isOpposing: (id) => id === 'enemy',
        });
        handBus.emit({
            type: 'debuff-applied',
            sourceId: 'enemy',
            targetId: 'ally-1',
            round: 1,
            buffName: 'Provoke',
            application: 'apply',
        });
        expect(enqueued).toHaveLength(0);
    });

    it('an inflicted debuff on her ally repairs the ally', () => {
        const handBus = makeHandBus();
        const enqueued = registerSingle(handBus, 'hayyan', repairAbility, {
            isOpposing: (id) => id === 'enemy',
        });
        handBus.emit({
            type: 'debuff-applied',
            sourceId: 'enemy',
            targetId: 'ally-1',
            round: 1,
            buffName: 'Defense Down II',
            application: 'inflict',
        });
        expect(enqueued).toHaveLength(1);
        expect(enqueued[0].eventCtx?.damagedAllyId).toBe('ally-1');
    });

    it('enemy-side mirror: an enemy-side Hayyan only repairs off an INFLICTED debuff on her enemy-side ally', () => {
        const handBus = makeHandBus();
        // Enemy-registration convention: isOpposing flips to the PLAYER side.
        const enqueued = registerSingle(handBus, 'hayyan-enemy', repairAbility, {
            isOpposing: (id) => id === 'player-1',
        });
        handBus.emit({
            type: 'debuff-applied',
            sourceId: 'player-1',
            targetId: 'ally-enemy-1',
            round: 1,
            buffName: 'Provoke',
            application: 'apply',
        });
        expect(enqueued).toHaveLength(0);
        handBus.emit({
            type: 'debuff-applied',
            sourceId: 'player-1',
            targetId: 'ally-enemy-1',
            round: 1,
            buffName: 'Attack Down II',
            application: 'inflict',
        });
        expect(enqueued).toHaveLength(1);
    });
});

describe('Yuyan — on-debuff-inflicted gated on her OWN "applying" verb (apply-only)', () => {
    const yuyan = ship({
        refits: [{}, {}] as Ship['refits'],
        secondPassiveSkillText: YUYAN_P2,
    });
    const stealthAbility = abilitiesFor(yuyan).find(
        (a) => a.type === 'buff' && a.trigger === 'on-debuff-inflicted'
    )!;

    it('parses with triggerApplicationFilter: apply', () => {
        expect(stealthAbility).toBeDefined();
        expect(stealthAbility.triggerApplicationFilter).toBe('apply');
    });

    it('her applied Concentrate Fire grants Stealth', () => {
        const handBus = makeHandBus();
        const enqueued = registerSingle(handBus, 'yuyan', stealthAbility, {
            isOpposing: (id) => id === 'enemy',
        });
        handBus.emit({
            type: 'debuff-applied',
            sourceId: 'yuyan',
            targetId: 'e1',
            round: 1,
            buffName: 'Concentrate Fire',
            application: 'apply',
        });
        expect(enqueued).toHaveLength(1);
    });

    it('her inflicted Defense Down II alone does not grant Stealth', () => {
        const handBus = makeHandBus();
        const enqueued = registerSingle(handBus, 'yuyan', stealthAbility, {
            isOpposing: (id) => id === 'enemy',
        });
        handBus.emit({
            type: 'debuff-applied',
            sourceId: 'yuyan',
            targetId: 'e1',
            round: 1,
            buffName: 'Defense Down II',
            application: 'inflict',
        });
        expect(enqueued).toHaveLength(0);
    });
});

// User ruling (2026-10-02): Yuyan's "when applying a debuff" Stealth comes only from her ACTIVE
// ("applies Concentrate Fire"); her charged "inflicts Disable" does not trigger it. The catalogue
// texts carry that split in their verbs, so the parse alone decides it: each debuff's own
// `application` comes from its clause's verb, and the Stealth reaction only accepts an apply.
describe('Yuyan (catalogue text) — the active applies, the charged inflicts, only the apply grants Stealth', () => {
    const yuyan = ship({
        activeSkillText:
            'This Unit deals <unit-damage>170% damage</unit-damage>, applies <unit-skill>Concentrate Fire</unit-skill> for 1 turn, and inflicts <unit-skill>Defense Down II</unit-skill> for 2 turns.',
        chargeSkillText:
            'This Unit deals <unit-damage>210% damage</unit-damage>, and inflicts <unit-skill>Disable</unit-skill> for 1 turn.',
        chargeSkillCharge: 4,
        firstPassiveSkillText:
            "This Unit's attacks ignore <unit-skill>Taunt</unit-skill> and <unit-skill>Provoke</unit-skill> effects.<br /><br />This Unit gains <unit-skill>Stealth</unit-skill> for 2 turns when applying a <unit-aid>debuff</unit-aid>.",
    });
    const slots = buildShipAbilities(yuyan).slots;
    const debuffIn = (slotName: 'active' | 'charged', buffName: string) =>
        slots
            .find((s) => s.slot === slotName)!
            .abilities.find((a) => a.config.type === 'debuff' && a.config.buffName === buffName)!;
    const applicationOf = (a: Ability) =>
        a.config.type === 'debuff' ? a.config.application : undefined;
    const concentrateFire = debuffIn('active', 'Concentrate Fire');
    const disable = debuffIn('charged', 'Disable');
    const stealthAbility = abilitiesFor(yuyan).find(
        (a) => a.type === 'buff' && a.trigger === 'on-debuff-inflicted'
    )!;

    it('parses the active Concentrate Fire as an apply, the charged Disable as an inflict', () => {
        expect(applicationOf(concentrateFire)).toBe('apply');
        expect(applicationOf(disable)).toBe('inflict');
        expect(applicationOf(debuffIn('active', 'Defense Down II'))).toBe('inflict');
        expect(stealthAbility.triggerApplicationFilter).toBe('apply');
    });

    it('the active Concentrate Fire grants Stealth; the charged Disable does not', () => {
        const handBus = makeHandBus();
        const enqueued = registerSingle(handBus, 'yuyan', stealthAbility, {
            isOpposing: (id) => id === 'enemy',
        });
        handBus.emit({
            type: 'debuff-applied',
            sourceId: 'yuyan',
            targetId: 'e1',
            round: 1,
            buffName: 'Disable',
            application: applicationOf(disable),
        });
        expect(enqueued).toHaveLength(0);
        handBus.emit({
            type: 'debuff-applied',
            sourceId: 'yuyan',
            targetId: 'e1',
            round: 1,
            buffName: 'Concentrate Fire',
            application: applicationOf(concentrateFire),
        });
        expect(enqueued).toHaveLength(1);
    });
});
