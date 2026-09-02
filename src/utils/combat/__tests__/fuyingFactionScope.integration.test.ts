/**
 * #363 Gap 1 — Fuying's Stealth grant honours its Tianchao recipient scope.
 *
 * Her active reads "grants Tianchao allies Stealth for 1 turn", but the faction word was
 * discarded: the ability built with `target: 'all-allies'` and reached every ally. Stealth is a
 * TARGETING-IMMUNITY status, so the over-grant did not merely inflate a number — it made allies
 * unselectable who should be selectable.
 *
 * ⚠️ THE GAP-1 SECTIONS DELIBERATELY ASSERT NOTHING ABOUT FUYING'S OWN REACH. Nothing above the
 * Gap-2 banner asserts how MANY allies she reaches, WHICH ones, or whether she is her own
 * recipient. Those all depend on her support footprint
 * (`Pattern-Wings-Support-Not-Self-Range-2`), which is a SEPARATE axis owned by a separate change
 * — an assertion about it there would pass today and read as a regression caused by that change
 * tomorrow. What is pinned instead: the parser's answer, the built ability's `factionFilter`, the
 * pure resolver's intersection against a SYNTHETIC faction map, and (at the engine level) a
 * synthetic non-positional kit where NO footprint exists, so faction narrowing is the only
 * narrowing in play and cannot be confounded by anyone's pattern.
 *
 * The Gap-2 section BELOW is the change that owns that axis, so it does assert the footprint — see
 * its own banner.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { detectGrantFactionScope } from '../../skillTextParser';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { resolveSupportRecipients } from '../supportRecipients';
import { allyScopedIncomingRecipients, incomingReductionForHit } from '../incomingEffects';
import { runCombat, type CombatEngineInput } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { lazyFixture } from '../__testutils__/lazyFixture';
import { bareEnemy } from '../__testutils__/bareRosterFixture';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { BUFFS } from '../../../constants/buffs';
import type { FactionKey } from '../../../constants/factions';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedPattern, ParsedTarget } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { ActiveDoTStack, CombatActor } from '../state';
import type { Ship } from '../../../types/ship';

// `docs/` is gitignored reference data and a fresh worktree does not have it. Without this guard
// the file fails to COLLECT rather than reporting a readable skip reason — copy the pattern from
// realKitFingerprints.test.ts.
function requireReferenceData(): void {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'docs/ship-skills.csv and/or docs/ship-data.json are missing from this worktree ' +
                '(gitignored reference data) — needed to resolve real ship skill text/stats.'
        );
    }
}
beforeAll(requireReferenceData);

/** The corpus Ship builder. `refitLevel` defaults to 4, so this is the R4 refit-active passive. */
const fuyingShip = () => {
    const s = buildTraceShip('Fuying');
    if (!s) throw new Error('Fuying missing from the corpus');
    return s;
};

const FUYING_ACTIVE =
    'This Unit <unit-aid>cleanses 1 debuff</unit-aid>, grants ' +
    '<unit-skill>Security Up III</unit-skill> for 2 turns and grants Tianchao allies ' +
    '<unit-skill>Stealth</unit-skill> for 1 turn.';

describe('Fuying faction-scoped Stealth grant (#363) — parser', () => {
    it('reads Tianchao off the RECIPIENT phrase', () => {
        expect(detectGrantFactionScope(FUYING_ACTIVE, 'Stealth')).toEqual(['TIANCHAO']);
    });

    it('does NOT read a faction out of a faction-NAMED buff', () => {
        // Anjian's shape: the faction word belongs to the buff name, not to a recipient.
        const anjian =
            'This Unit grants <unit-skill>Tianchao Precision I</unit-skill> for 2 turns.';
        expect(detectGrantFactionScope(anjian, 'Tianchao Precision I')).toBeUndefined();
    });

    it('does NOT read a faction-NAMED buff plus a team receiver as a faction scope', () => {
        // Los's shape: "XAOC Swiftness III" (a NAME) granted "to all allies" (a receiver). Both a
        // faction word and "allies" are present, but not ADJACENT — the discriminator this
        // detector rests on. Reading it as a scope would silence a real team-wide grant.
        const los =
            'This Unit grants <unit-skill>XAOC Swiftness III</unit-skill> to all allies for ' +
            '2 turns and deals <unit-damage>100%</unit-damage> damage.';
        expect(detectGrantFactionScope(los, 'XAOC Swiftness III')).toBeUndefined();
    });

    it('scopes to the buff’s OWN clause span, not the whole sentence', () => {
        // Fuying's sibling grant sits in the SAME sentence as the Tianchao one. Reading the whole
        // text (rather than `buffGrantSpan`'s span) would leak Tianchao onto it and silently mute
        // a grant that really does reach every ally.
        expect(detectGrantFactionScope(FUYING_ACTIVE, 'Security Up III')).toBeUndefined();
    });
});

describe('Fuying faction-scoped Stealth grant (#363) — build', () => {
    it('builds the Stealth grant with factionFilter, through PRODUCTION slot routing', () => {
        const built = buildShipAbilities(fuyingShip());
        const stealth = built.slots
            .flatMap((s) => s.abilities)
            .find((a) => a.config.type === 'buff' && a.config.buffName === 'Stealth');
        expect(stealth).toBeDefined();
        expect(stealth!.target).toBe('all-allies'); // unchanged — the target was never the bug
        expect(stealth!.factionFilter).toEqual(['TIANCHAO']);
    });

    it('leaves her co-cast Security Up III grant unfiltered', () => {
        const built = buildShipAbilities(fuyingShip());
        const security = built.slots
            .flatMap((s) => s.abilities)
            .find((a) => a.config.type === 'buff' && a.config.buffName === 'Security Up III');
        expect(security).toBeDefined();
        expect(security!.factionFilter).toBeUndefined();
    });
});

describe('Fuying faction-scoped Stealth grant (#363) — recipient resolution', () => {
    it('narrows recipients to the matching faction, and drops unknown-faction actors', () => {
        const factions: Record<string, FactionKey> = {
            fuying: 'TIANCHAO',
            anjian: 'TIANCHAO',
            grif: 'XAOC',
        };
        const got = resolveSupportRecipients({
            target: 'all-allies',
            casterId: 'fuying',
            baseRecipients: ['fuying', 'anjian', 'grif', 'manual'],
            factionFilter: ['TIANCHAO'],
            factionOf: (id) => factions[id],
        });
        // 'grif' is the wrong faction; 'manual' has NO faction and is dropped per the
        // owner-approved conservative rule (unknown never matches).
        expect(got).toEqual(['fuying', 'anjian']);
    });

    it('composes with footprint narrowing rather than replacing it', () => {
        // The pattern says which allies the cast reaches; the faction says which of those qualify.
        // A caller supplying BOTH must get the intersection, not either one alone.
        const factions: Record<string, FactionKey> = {
            a: 'TIANCHAO',
            b: 'TIANCHAO',
            c: 'XAOC',
        };
        expect(
            resolveSupportRecipients({
                target: 'all-allies',
                casterId: 'a',
                baseRecipients: ['a', 'b', 'c'],
                footprintAllyIds: ['b', 'c'], // 'a' is off-pattern
                factionFilter: ['TIANCHAO'],
                factionOf: (id) => factions[id],
            })
        ).toEqual(['b']);
    });

    it('matches nobody when a filter is present but no faction reader is', () => {
        // The conservative answer, and the same one an all-unknown roster gets: a filter with no
        // way to read factions must not silently degrade to "reach everyone".
        expect(
            resolveSupportRecipients({
                target: 'all-allies',
                casterId: 'a',
                baseRecipients: ['a', 'b'],
                factionFilter: ['TIANCHAO'],
            })
        ).toEqual([]);
    });

    it('is inert when no factionFilter is present', () => {
        const base = ['a', 'b', 'c'];
        expect(
            resolveSupportRecipients({
                target: 'all-allies',
                casterId: 'a',
                baseRecipients: base,
                factionOf: () => undefined,
            })
        ).toEqual(base);
    });

    it('treats an EMPTY factionFilter as absent (canonical-absent convention)', () => {
        const base = ['a', 'b', 'c'];
        expect(
            resolveSupportRecipients({
                target: 'all-allies',
                casterId: 'a',
                baseRecipients: base,
                factionFilter: [],
                factionOf: () => undefined,
            })
        ).toEqual(base);
    });
});

describe('Fuying faction-scoped Stealth grant (#363) — corpus inertness', () => {
    it('matches exactly the recipient-scoped clauses, and none of the faction-NAMED ones', () => {
        // Guards the ONE thing this detector must get right: a faction inside a buff NAME is not
        // a recipient scope. Measured over all 149 ships (2026-08-22): 4 recipient-scoped clauses
        // (Fuying's active Stealth grant + the three refit tiers of her damage-reduction aura,
        // which repeat the same "All Tianchao allies with Stealth" phrase) vs 31 clauses where a
        // faction word is part of a buff name. The task brief predicted 3/31+1 — it counted two
        // aura tiers where the corpus has three; the 35-clause total is the same either way.
        const scoped =
            loadShipSkillRecords()
                .flatMap((r) => [r.active, r.charge, ...r.passives])
                .join('\n')
                .match(
                    /\b(?:Tianchao|XAOC|Binderburg|Everliving|Gelecek|Marauders|MPL|Atlas Syndicate|Frontier Legion|Terran Combine)\s+all(?:y|ies)\b/gi
                ) ?? [];
        expect(scoped).toHaveLength(4);
    });

    it('fires on Fuying alone across all 149 ships', () => {
        // The end the previous test cannot reach: that the DETECTOR (not just the phrase) is inert
        // for the other 148 ships. Every (row, buff-name) pair in the corpus, exactly the pairs
        // `mergeBuff` puts through it in production.
        const hits: string[] = [];
        for (const record of loadShipSkillRecords()) {
            for (const text of [record.active, record.charge, ...record.passives]) {
                if (!text) continue;
                for (const buff of BUFFS) {
                    if (!text.includes(buff.name)) continue;
                    if (detectGrantFactionScope(text, buff.name)) {
                        hits.push(`${record.name}:${buff.name}`);
                    }
                }
            }
        }
        expect([...new Set(hits)]).toEqual(['Fuying:Stealth']);
    });
});

// ---------------------------------------------------------------------------
// Engine wiring — SYNTHETIC kit, no positions, no patterns.
//
// Why synthetic rather than Fuying herself: with no `position`/`pattern` anywhere, the engine's
// support footprint is `undefined` ("do not narrow"), so the faction intersection is the ONLY
// narrowing in play. A test built on Fuying's real kit would instead measure her footprint AND her
// faction scope at once — and would move the moment either axis changed. This one measures the
// engine THREADING (`factionByActorId` → `buildTurnArgs` → `runPlayerTurn` → the per-slot timed
// status's own `factionFilter`) and nothing else.
// ---------------------------------------------------------------------------

const factionScopedGrantKit = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'fs-scoped',
                    type: 'buff',
                    target: 'all-allies',
                    trigger: 'on-cast',
                    conditions: [],
                    factionFilter: ['TIANCHAO'],
                    config: {
                        type: 'buff',
                        buffName: 'Stealth',
                        parsedEffects: {},
                        stacks: 1,
                        isStackable: false,
                        duration: 1,
                    },
                },
                {
                    id: 'fs-open',
                    type: 'buff',
                    target: 'all-allies',
                    trigger: 'on-cast',
                    conditions: [],
                    config: {
                        type: 'buff',
                        buffName: 'Security Up III',
                        parsedEffects: {},
                        stacks: 1,
                        isStackable: false,
                        duration: 2,
                    },
                },
            ],
        },
    ],
});

const inertWalkStats = (hp: number) => ({
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    hacking: 0,
    defence: 0,
    hp,
});

/** Enemy-attacker stats are a DIFFERENT shape from walk stats (`speed` is required here and
 *  `defensePenetration` is not part of it) — vitest cannot tell them apart, only `tsc` can. */
const inertEnemyStats = (hp: number) => ({
    attack: 0,
    crit: 0,
    critDamage: 0,
    speed: 1,
    hacking: 0,
    defence: 0,
    hp,
});

const inertAlly = (id: string, faction?: FactionKey) => ({
    id,
    speed: 1,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    ...(faction ? { faction } : {}),
    walk: {
        shipSkills: { slots: [] },
        stats: inertWalkStats(500_000),
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: false,
    },
});

function recipientsOf(
    buffsApplied: Extract<CombatEvent, { type: 'buff-applied' }>[],
    name: string
) {
    return [
        ...new Set(buffsApplied.filter((e) => e.buffName === name).map((e) => e.actorId)),
    ].sort();
}

function runAndCollectBuffs(input: CombatEngineInput) {
    const bus = createEventBus();
    const buffsApplied: Extract<CombatEvent, { type: 'buff-applied' }>[] = [];
    bus.on('buff-applied', (e) => buffsApplied.push(e));
    runCombat({ ...input, bus });
    return buffsApplied;
}

const BASE_FOCUS = (): CombatEngineInput => ({
    attack: 1000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: factionScopedGrantKit(),
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
    hp: 1_000_000,
    enemyAttackers: bareEnemy({ stats: { hp: 10_000_000 } }),
});

describe('Fuying faction-scoped Stealth grant (#363) — engine wiring', () => {
    it('a PLAYER caster’s faction-scoped grant lands only on same-faction allies', () => {
        const buffs = runAndCollectBuffs({
            ...BASE_FOCUS(),
            faction: 'TIANCHAO',
            teamActors: [
                inertAlly('ally-tianchao', 'TIANCHAO'),
                inertAlly('ally-xaoc', 'XAOC'),
                inertAlly('ally-unknown'), // manual slot: no faction at all
            ],
        });
        // The unfiltered co-cast grant is the CONTROL: it proves the cast fired, reached every
        // ally, and that the faction filter — not some unrelated gate — is what removed the rest.
        // Without this the scoped assertion below could pass on a cast that never happened.
        expect(recipientsOf(buffs, 'Security Up III')).toEqual([
            'ally-tianchao',
            'ally-unknown',
            'ally-xaoc',
            'attacker',
        ]);
        // The scoped grant: the Tianchao ally AND the Tianchao caster; never the XAOC ally, never
        // the faction-less manual one (unknown never matches).
        expect(recipientsOf(buffs, 'Stealth')).toEqual(['ally-tianchao', 'attacker']);
    });

    it('an ENEMY caster’s faction-scoped grant narrows on its OWN side (team symmetry)', () => {
        // Combat-engine work in this project must be team-symmetric: `factionByActorId` is keyed
        // by actor id with no `side` branch, so the SAME kit on the enemy side must narrow the
        // same way against the enemy roster.
        const buffs = runAndCollectBuffs({
            ...BASE_FOCUS(),
            shipSkills: { slots: [] },
            enemyAttackers: [
                {
                    id: 'e-caster',
                    chargeCount: 0,
                    startCharged: false,
                    faction: 'TIANCHAO',
                    shipSkills: factionScopedGrantKit(),
                    stats: inertEnemyStats(10_000_000),
                },
                {
                    id: 'e-tianchao',
                    chargeCount: 0,
                    startCharged: false,
                    faction: 'TIANCHAO',
                    stats: inertEnemyStats(10_000_000),
                },
                {
                    id: 'e-xaoc',
                    chargeCount: 0,
                    startCharged: false,
                    faction: 'XAOC',
                    stats: inertEnemyStats(10_000_000),
                },
            ],
        });
        expect(recipientsOf(buffs, 'Security Up III')).toEqual([
            'e-caster',
            'e-tianchao',
            'e-xaoc',
        ]);
        expect(recipientsOf(buffs, 'Stealth')).toEqual(['e-caster', 'e-tianchao']);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// #363 Gap 2 — the ALLY-SCOPED Stealth damage-reduction aura.
//
// "All Tianchao allies with Stealth take 30% less direct damage" (R4; R2/R3 read 15%). It was not
// applied AT ALL: every pre-existing member of the `incoming-reduction` family
// (Iridium/Anemone/Wusheng/Panon/Tormenter/Voron) reduces damage on the CARRIER, so the engine's
// per-actor incoming-effects map only ever keyed each actor's OWN passive-slot abilities and the
// victim-side read never saw a teammate's aura.
//
// OWNER RULINGS this section encodes (2026-08-22) — ground truth, not derived from the clause text:
//  1. The aura is PATTERN-LIMITED (`patternScoped: true`). A Stealthed Tianchao ally standing
//     OUTSIDE Fuying's active pattern takes FULL damage. The limit is MECHANICAL: it governs the
//     whole passive even though the words "within the active pattern" sit only in the passive's
//     SECOND sentence (the Stasis reactive), and at R2 the aura ships alone with no pattern phrase
//     at all. `markPatternScoped` reads an ability's OWN sentence and so would never flag it —
//     which is why the parser arm sets the flag explicitly.
//  2. Stealth affects only being CHOSEN as a target; damage lands normally on a Stealthed ship. So
//     this aura is frequently live, and a fixture can and must get a Stealthed ally hit.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('Fuying Stealth DR aura (#363) — build', () => {
    const auraOf = () =>
        buildShipAbilities(fuyingShip())
            .slots.flatMap((s) => s.abilities)
            .find((a) => a.config.type === 'incoming-reduction');

    it('builds an ally-scoped, faction-filtered direct-damage reduction at the R4 magnitude', () => {
        // buildTraceShip defaults to refitLevel 4 and getShipSkillRows returns only the
        // refit-active passive, so this is the R4 row → 30, not R2/R3's 15. No per-refit
        // branching is needed in the parser.
        const aura = auraOf();
        expect(aura).toBeDefined();
        expect(aura!.target).toBe('all-allies');
        expect(aura!.factionFilter).toEqual(['TIANCHAO']);
        // OWNER-RULED 2026-08-22: see ruling 1 in this section's header.
        expect(aura!.patternScoped).toBe(true);
        expect(aura!.config).toMatchObject({
            type: 'incoming-reduction',
            scope: 'direct',
            condition: 'self-stealth',
            pct: 30,
            critFamily: false,
        });
    });

    it('does not disturb the self-scoped members of the family (Wusheng keeps target self)', () => {
        // Wusheng's "reduces direct damage by N% while Stealth is active" shares the aura's
        // `self-stealth` condition and its `scope: 'direct'`, and is parsed by a sibling arm of the
        // same function. It is the closest neighbour the new arm could have captured.
        const wusheng = buildTraceShip('Wusheng');
        if (!wusheng) throw new Error('Wusheng missing from the corpus');
        const red = buildShipAbilities(wusheng)
            .slots.flatMap((s) => s.abilities)
            .filter((a) => a.config.type === 'incoming-reduction');
        expect(red.length).toBeGreaterThan(0);
        for (const a of red) {
            expect(a.target).toBe('self');
            expect(a.factionFilter).toBeUndefined();
            expect(a.patternScoped).toBeUndefined();
        }
    });
});

// ---------------------------------------------------------------------------
// #363 hardening (item 3) — corpus-inertness for the aura's regex arm.
//
// `npx tsx scripts/auditSkills.ts` reporting 0 findings only proves the arm MATCHED Fuying — an
// over-greedy arm that ALSO matched some other ship's text would emit an extra ally-scoped aura
// and produce no finding at all (a silent false positive, not a gap `audit:skills` is built to
// see). This mirrors the "fires on Fuying alone" shape already used above for
// `detectGrantFactionScope`, but for the ally-scoped `incoming-reduction` arm instead.
// ---------------------------------------------------------------------------
describe('Fuying Stealth DR aura (#363) — corpus inertness for the ally-scoped arm', () => {
    /** Parses one skill-text clause in isolation, exactly like `scripts/auditSkills.ts`'s own
     *  `abilitiesFor` helper: stuff it into `activeSkillText` on a bare, unrefit `Ship` so
     *  `buildShipAbilities` runs the SAME regex arms production runs, independent of which real
     *  slot the clause lives in. */
    function abilitiesForText(text: string): Ability[] {
        const ship = { refits: [], activeSkillText: text } as unknown as Ship;
        return buildShipAbilities(ship).slots.flatMap((s) => s.abilities);
    }

    it('the ally-scoped incoming-reduction arm (target: all-allies) fires on Fuying alone across all 149 corpus ships', () => {
        const hits: string[] = [];
        for (const record of loadShipSkillRecords()) {
            for (const text of [record.active, record.charge, ...record.passives]) {
                if (!text) continue;
                for (const a of abilitiesForText(text)) {
                    if (a.config.type === 'incoming-reduction' && a.target === 'all-allies') {
                        hits.push(record.name);
                    }
                }
            }
        }
        // Non-vacuity: proves the sweep actually walked text containing the clause at all, not
        // just that it found nothing anywhere.
        expect(hits.length).toBeGreaterThan(0);
        expect([...new Set(hits)]).toEqual(['Fuying']);
    });

    it('yields 15/15/30 for her three passive rows (refitLevel 0/2/4 → Passive R0/R2/R4)', () => {
        const auraPctAt = (refitLevel: 0 | 2 | 4): number => {
            const ship = buildTraceShip('Fuying', { refitLevel });
            if (!ship) throw new Error('Fuying missing from the corpus');
            const ability = buildShipAbilities(ship)
                .slots.flatMap((s) => s.abilities)
                .find((a) => a.config.type === 'incoming-reduction' && a.target === 'all-allies');
            if (!ability || ability.config.type !== 'incoming-reduction') {
                throw new Error(
                    `Fuying built no ally-scoped incoming-reduction aura at refitLevel ${refitLevel}`
                );
            }
            if (ability.config.pct === undefined) {
                throw new Error(`Fuying's aura at refitLevel ${refitLevel} carries no pct`);
            }
            return ability.config.pct;
        };
        expect(auraPctAt(0)).toBe(15); // Passive R0
        expect(auraPctAt(2)).toBe(15); // Passive R2
        expect(auraPctAt(4)).toBe(30); // Passive R4 (the default used by every other test above)
    });
});

describe('Fuying Stealth DR aura (#363) — the per-hit gate', () => {
    const aura = {
        id: 'x',
        type: 'incoming-reduction',
        target: 'all-allies',
        trigger: 'on-cast',
        conditions: [],
        config: {
            type: 'incoming-reduction',
            scope: 'direct',
            condition: 'self-stealth',
            pct: 30,
            critFamily: false,
        },
    } as const;
    const base = {
        didCrit: false,
        attackerStealthed: false,
        victimStealthed: true,
        victimStasised: false,
        hitIndexThisRound: 1,
        attackerHasDot: false,
        victimHasBarrierRecharging: false,
        victimHasShield: false,
        attackerTauntedOrProvoked: false,
        selfHpPct: 100,
    };

    it('reduces a DIRECT hit on a Stealthed victim', () => {
        expect(incomingReductionForHit([aura as never], base as never)).toBe(30);
    });

    it('does NOT reduce a DoT tick on the same victim — the clause says "direct damage"', () => {
        expect(
            incomingReductionForHit([aura as never], { ...base, dotType: 'inferno' } as never)
        ).toBe(0);
    });

    it('does NOT reduce an unstealthed victim', () => {
        expect(incomingReductionForHit([aura as never], { ...base, victimStealthed: false })).toBe(
            0
        );
    });
});

describe('Fuying Stealth DR aura (#363) — recipient set', () => {
    // `allyScopedIncomingRecipients` is the PRODUCTION rule the engine calls to decide whose
    // incoming list the aura lands on. Asserting the SET (rather than a damage outcome) is the only
    // way to pin the owner rule below: through Fuying every observable outcome is identical either
    // way, because `self-stealth` fails for her regardless.
    const auraOf = (): Ability => {
        const a = buildShipAbilities(fuyingShip())
            .slots.flatMap((s) => s.abilities)
            .find((x) => x.config.type === 'incoming-reduction');
        if (!a) throw new Error('Fuying built no incoming-reduction aura');
        return a;
    };
    const FACTIONS_BY_ID: Record<string, FactionKey> = {
        fuying: 'TIANCHAO',
        anjian: 'TIANCHAO',
        grif: 'XAOC',
    };
    const factionOf = (id: string): FactionKey | undefined => FACTIONS_BY_ID[id];

    it('is footprint ∩ Tianchao', () => {
        expect(
            allyScopedIncomingRecipients({
                ability: auraOf(),
                ownerId: 'fuying',
                livingSameSideIds: ['fuying', 'anjian', 'grif', 'manual'],
                // Her real pattern is Not-Self, so her own cell is absent from her footprint.
                footprintAllyIds: ['anjian', 'grif'],
                factionOf,
            })
        ).toEqual(['anjian']);
        // 'grif' is on-pattern but XAOC; 'manual' has no faction at all (unknown never matches).
    });

    it('does NOT exclude the OWNER — she is dropped by her Not-Self pattern, not by a rule', () => {
        // The load-bearing assertion of this file. There is no `id !== ownerId` guard anywhere in
        // the recipient resolution, so a carrier whose footprint DOES contain its own cell is its
        // own recipient. Hardcoding an owner exclusion "because Fuying never has Stealth" would
        // encode a fact about her GRANT's pattern into the AURA's recipient resolution, and would
        // break silently the day a carrier self-grants Stealth or a teammate grants it to her.
        expect(
            allyScopedIncomingRecipients({
                ability: auraOf(),
                ownerId: 'fuying',
                livingSameSideIds: ['fuying', 'anjian', 'grif'],
                footprintAllyIds: ['fuying', 'anjian', 'grif'], // a self-inclusive support pattern
                factionOf,
            })
        ).toEqual(['fuying', 'anjian']);
    });

    it('leaves the aura team-wide when there is no support footprint to narrow by', () => {
        // `undefined` means "do not narrow" throughout this codebase — a non-positional or
        // non-support pattern must not silence the aura.
        expect(
            allyScopedIncomingRecipients({
                ability: auraOf(),
                ownerId: 'fuying',
                livingSameSideIds: ['fuying', 'anjian', 'grif'],
                footprintAllyIds: undefined,
                factionOf,
            })
        ).toEqual(['fuying', 'anjian']);
    });

    it('ignores the footprint entirely for an aura that is NOT patternScoped', () => {
        // Guards the flag itself: strip `patternScoped` and the footprint stops applying, which is
        // exactly the behaviour the reverted first draft of the spec argued for. This assertion is
        // what makes the ENGINE fixture below a measurement of ruling 1 rather than of geometry.
        const unscoped = { ...auraOf() };
        delete unscoped.patternScoped;
        expect(
            allyScopedIncomingRecipients({
                ability: unscoped,
                ownerId: 'fuying',
                livingSameSideIds: ['fuying', 'anjian', 'grif'],
                footprintAllyIds: ['anjian'],
                factionOf,
            })
        ).toEqual(['fuying', 'anjian']);
    });
});

// ---------------------------------------------------------------------------
// Engine end-to-end — a REAL board, because the pattern limit IS the thing under test.
//
// The whole player side is Stealthed. That is not decoration: the positional stealth filter drops
// Stealthed cells from an enemy's candidate list UNLESS every candidate is Stealthed, so cloaking
// everyone is what restores ordinary front-to-back selection and lets a Stealthed ally be hit at
// all (owner ruling 2 — Stealth blocks being CHOSEN, not damage). Un-stealthing one ally to make it
// a control would move the enemy's anchor and change the footprint under test, so the controls here
// are "same board, aura absent" and "same board, faction swapped" instead.
//
// Geometry (all human-verifiable from patternOffsets.ts):
//   Fuying is the FOCUS at T2 with her real `Pattern-Wings-Support-Not-Self-Range-2`
//     → support footprint {M2, M3, B1, B2, B3}  (the table's own "Human-verified @ T2" line).
//   The enemy fires `Pattern-Line-Range-2` and, sitting in row M, anchors on the front-most M-row
//     player. M4 is empty, so that is `ally-m3` at M3; covered extends 2 steps back → M2, M1.
//   So one attack lands on all three allies:
//     M3  TIANCHAO, Stealthed, INSIDE  the footprint → reduced 30%
//     M2  XAOC,     Stealthed, INSIDE  the footprint → FULL (faction narrowing)
//     M1  TIANCHAO, Stealthed, OUTSIDE the footprint → FULL (ruling 1, the pattern limit)
//
// Every assertion is a per-victim DIFFERENTIAL against the identical board with the aura passive
// removed from Fuying's kit. That is deliberate: origin and covered cells take different shares of
// an AoE, so comparing two victims to each other would measure the AoE table, not the aura.
// ---------------------------------------------------------------------------

const HUGE_HP = 1_000_000_000;
const ENEMY_ATTACK = 5000;

const wingsSupportNotSelf2 = (): ParsedPattern => ({
    raw: 'Pattern-Wings-Support-Not-Self-Range-2',
    shape: 'wings',
    range: 2,
    modifiers: { support: true, notSelf: true },
});
const lineRange2 = (): ParsedPattern => ({
    raw: 'Pattern-Line-Range-2',
    shape: 'line',
    range: 2,
    modifiers: {},
});
const frontTarget = (): ParsedTarget => ({ raw: 'front', side: 'enemy', selection: 'front' });

/** A 99-turn self-Stealth cast (the idiom from incomingReductionEngine.test.ts). */
const stealthSelfBuff = (id: string): Ability => ({
    id,
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
});

/** Fuying's aura exactly as `buildShipAbilities` emits it from her R4 passive row. */
const auraPassiveSlot = (): ShipSkills['slots'][number] => {
    const aura = buildShipAbilities(fuyingShip())
        .slots.flatMap((s) => s.abilities)
        .find((a) => a.config.type === 'incoming-reduction');
    if (!aura) throw new Error('Fuying built no incoming-reduction aura');
    return { slot: 'passive', abilities: [aura] };
};

/** A Stealthed, positioned, harmless player victim. */
const stealthedAlly = (id: string, position: Position, faction: FactionKey) => ({
    id,
    speed: 1000, // ahead of the enemy, so Stealth is up before it fires
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    faction,
    position,
    walk: {
        shipSkills: {
            slots: [{ slot: 'active' as const, abilities: [stealthSelfBuff(`${id}-stealth`)] }],
        },
        stats: inertWalkStats(HUGE_HP),
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: false,
    },
});

/** A seeded corrosion stack attributed to the enemy, so its tick can resolve an applier ctx. */
const corrosion = (): ActiveDoTStack => ({
    stacks: 1,
    tier: 10,
    remainingRounds: 5,
    sourceId: 'enemy-1',
});

const auraBoard = (opts: { aura: boolean; m3Faction?: FactionKey }): CombatEngineInput => ({
    // Fuying herself is the focus, so `pattern` below IS her support pattern (the engine reads
    // `input.pattern` for the focus actor) and `faction` is her Tianchao membership.
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    // TWO rounds, and it has to be two: a DoT tick resolves the APPLIER's turn context
    // (`lastTurnCtxByActor`), and the enemy is deliberately the slowest actor on the board so that
    // every ally is already Stealthed when it fires. Its context therefore does not exist until
    // round 1 has finished, so a one-round fixture ticks nothing and the DoT assertion below would
    // be vacuous (0 === 0). Both rounds are identical for the direct-damage ratio.
    numRounds: 2,
    enemyDebuffs: [],
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: HUGE_HP,
    speed: 2000,
    mode: 'healing',
    healTargetId: 'attacker',
    faction: 'TIANCHAO',
    position: 'T2',
    pattern: wingsSupportNotSelf2(),
    // Fuying's own Stealth is a SNAPSHOT self-buff, not a self-cast like her allies' below. It has
    // to be: her pattern is Not-Self, and a CAST-slot support clause is footprint-scoped, so a
    // self-targeted cast of hers is narrowed away by her own footprint (she genuinely cannot Stealth
    // herself in game — which is exactly why the aura is inert on her). The snapshot buff is only
    // here so the positional stealth filter's "every candidate is Stealthed → restore all" branch
    // fires and the enemy can pick a target at all; it is irrelevant to the aura, which never
    // reaches her cell.
    selfBuffs: [
        {
            id: 'fuying-stealth-snapshot',
            buffName: 'Stealth',
            stacks: 1,
            parsedEffects: {},
            isStackable: false,
        },
    ],
    shipSkills: {
        slots: [...(opts.aura ? [auraPassiveSlot()] : [])],
    },
    teamActors: [
        stealthedAlly('ally-m3', 'M3', opts.m3Faction ?? 'TIANCHAO'),
        stealthedAlly('ally-m2', 'M2', 'XAOC'),
        stealthedAlly('ally-m1', 'M1', 'TIANCHAO'),
    ],
    enemyAttackers: [
        {
            id: 'enemy-1',
            stats: {
                attack: ENEMY_ATTACK,
                crit: 0,
                critDamage: 0,
                defence: 0,
                hp: HUGE_HP,
                speed: 1, // acts last → sees every ally's Stealth
            },
            chargeCount: 0,
            startCharged: false,
            position: 'M1',
            target: frontTarget(),
            pattern: lineRange2(),
        },
    ],
    // Seed the SAME DoT on the reduced ally in every run: its tick must not move, because the
    // clause says "direct damage" and the ability is scope:'direct'.
    __testTapActors: (actors: CombatActor[]) => {
        for (const a of actors) if (a.id === 'ally-m3') a.corrosionEntries.push(corrosion());
    },
});

/** Landed direct damage and DoT-tick damage per victim for one board. */
const runBoard = (opts: { aura: boolean; m3Faction?: FactionKey }) => {
    const bus = createEventBus();
    const direct = new Map<string, number>();
    const dot = new Map<string, number>();
    bus.on('attacked', (e) => {
        if (e.damage !== undefined)
            direct.set(e.targetId, (direct.get(e.targetId) ?? 0) + e.damage);
    });
    bus.on('dot-ticked', (e) => dot.set(e.targetId, (dot.get(e.targetId) ?? 0) + e.damage));
    runCombat({ ...auraBoard(opts), bus });
    return { direct, dot };
};

describe('Fuying Stealth DR aura (#363) — engine, on a real board', () => {
    // Fix 3 (review): built on first ACCESS, not in the `describe` body — a describe body runs at
    // COLLECTION time, before `beforeAll(requireReferenceData)`, so a fresh worktree without the
    // gitignored `docs/` reference data crashed during collection instead of reporting the guard's
    // readable message. Memoized, so both boards are still each run exactly once.
    const withAura = lazyFixture(() => runBoard({ aura: true }));
    const noAura = lazyFixture(() => runBoard({ aura: false }));

    it('all three Stealthed allies are actually HIT (ruling 2 — Stealth does not stop damage)', () => {
        // Non-vacuity gate: without this, every differential below could be 0 === 0.
        for (const id of ['ally-m3', 'ally-m2', 'ally-m1']) {
            expect(noAura().direct.get(id)).toBeGreaterThan(0);
            expect(withAura().direct.get(id)).toBeGreaterThan(0);
        }
    });

    it('reduces a DIRECT hit on the Stealthed Tianchao ally INSIDE her pattern by exactly 30%', () => {
        expect(withAura().direct.get('ally-m3')!).toBeCloseTo(
            0.7 * noAura().direct.get('ally-m3')!,
            5
        );
    });

    it('a Stealthed Tianchao ally OUTSIDE her pattern takes FULL damage (owner ruling 1)', () => {
        // The assertion that distinguishes the shipped implementation from the reverted spec's
        // version, which argued the aura was not pattern-limited.
        expect(withAura().direct.get('ally-m1')!).toBe(noAura().direct.get('ally-m1')!);
    });

    it('a Stealthed XAOC ally INSIDE her pattern takes FULL damage (faction narrowing)', () => {
        expect(withAura().direct.get('ally-m2')!).toBe(noAura().direct.get('ally-m2')!);
    });

    it('does NOT reduce a DoT tick on the very ally whose direct hit it DID reduce', () => {
        // Same actor, same run as the 30% assertion above, so the aura is provably live on it —
        // which is what makes an unchanged tick evidence about `scope: 'direct'` rather than about
        // the ally being out of reach.
        expect(withAura().dot.get('ally-m3')).toBeGreaterThan(0);
        expect(withAura().dot.get('ally-m3')!).toBe(noAura().dot.get('ally-m3')!);
    });

    it('swapping the reduced ally to XAOC removes the reduction (same cell, same Stealth)', () => {
        const swapped = runBoard({ aura: true, m3Faction: 'XAOC' });
        expect(swapped.direct.get('ally-m3')!).toBe(noAura().direct.get('ally-m3')!);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// #363 hardening (item 1) — the OWNER's own incoming-effects list must stay clean.
//
// `incomingAbilitiesById`'s first pass (engine.ts) keys each actor's OWN passive-slot
// incoming-effect abilities onto that actor's own list, and explicitly SKIPS an ally-scoped
// (`target: 'all-allies'`) incoming-reduction there — the second pass is its sole authority, and
// it never revisits Fuying's own cell because her active pattern is Not-Self. Deleting that skip
// would hand Fuying's own carrier a self-copy of her aura, bypassing the footprint entirely.
//
// This is unobservable on the board above: Fuying sits at T2 and the enemy's Line-Range-2 attack
// (anchored in row M) never reaches her, so the stray self-copy has nothing to reduce. This board
// moves her onto the attacked row instead (M4 — the front-most M-row cell) so she takes a direct
// hit herself, and gives her the same snapshot self-Stealth idiom the board above uses for her
// (she can never reach her own cell with a Not-Self cast, so a real self-cast is not an option)
// so `self-stealth` is genuinely true for her when she is hit.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const FUYING_SNAPSHOT_STEALTH = [
    {
        id: 'fuying-stealth-snapshot',
        buffName: 'Stealth',
        stacks: 1,
        parsedEffects: {},
        isStackable: false,
    },
];

/** Fuying alone, at the front of row M, taking a direct hit from a single enemy. `abilities`
 *  stands in for her passive slot — empty, her real aura, or (for the instrument check) a
 *  hand-built SELF-scoped control sharing the aura's exact condition/scope/pct. */
const selfHitBoard = (abilities: Ability[]): CombatEngineInput => ({
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    numRounds: 1,
    selfBuffs: FUYING_SNAPSHOT_STEALTH,
    enemyDebuffs: [],
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: HUGE_HP,
    speed: 100,
    mode: 'healing',
    healTargetId: 'attacker',
    faction: 'TIANCHAO',
    position: 'M4', // front-most row-M cell — the enemy's Line-Range-2 front-target anchors here
    pattern: wingsSupportNotSelf2(), // her real support pattern; irrelevant here (no allies to
    // narrow a footprint for) but kept realistic rather than omitted.
    shipSkills: { slots: abilities.length ? [{ slot: 'passive', abilities }] : [] },
    enemyAttackers: [
        {
            id: 'enemy-1',
            stats: {
                attack: ENEMY_ATTACK,
                crit: 0,
                critDamage: 0,
                defence: 0,
                hp: HUGE_HP,
                speed: 1,
            },
            chargeCount: 0,
            startCharged: false,
            position: 'M1',
            target: frontTarget(),
            pattern: lineRange2(),
        },
    ],
});

const runSelfHitBoard = (abilities: Ability[]): number => {
    const bus = createEventBus();
    let direct = 0;
    bus.on('attacked', (e) => {
        if (e.targetId === 'attacker' && e.damage !== undefined) direct += e.damage;
    });
    runCombat({ ...selfHitBoard(abilities), bus });
    return direct;
};

/** A hand-built SELF-scoped incoming-reduction sharing the real aura's exact condition/scope/pct
 *  — used only to PROVE the instrument (that `self-stealth` really does read true for Fuying in
 *  this fixture, and that the harness genuinely wires a reduction into a hit on the focus actor).
 *  `target: 'self'` means pass 1's ally-scoped skip never applies to it, so it is unaffected by
 *  the mutation this section pins. */
const selfScopedStealthControl: Ability = {
    id: 'self-scoped-control',
    type: 'incoming-reduction',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'incoming-reduction',
        scope: 'direct',
        condition: 'self-stealth',
        pct: 30,
        critFamily: false,
    },
};

describe("Fuying Stealth DR aura (#363) — the OWNER's own incoming list stays clean (pass-1 pin)", () => {
    it('PRE-CONDITION: Fuying herself is actually hit directly, with no abilities on her kit', () => {
        expect(runSelfHitBoard([])).toBeGreaterThan(0);
    });

    it(
        'PROVE THE INSTRUMENT: a SELF-scoped control with the same condition genuinely reduces her ' +
            'own damage by 30%, so self-stealth really is true for her and the harness wiring works',
        () => {
            const baseline = runSelfHitBoard([]);
            const withControl = runSelfHitBoard([selfScopedStealthControl]);
            expect(withControl).toBeCloseTo(0.7 * baseline, 5);
        }
    );

    it('her own incoming damage is IDENTICAL with and without her own ALLY-SCOPED aura present', () => {
        // Her aura is target: 'all-allies' and her active pattern is Not-Self — it must never
        // reduce HER OWN damage. If pass 1's skip (engine.ts, `incomingAbilitiesById`'s first
        // pass) is deleted, her own passive-slot copy of the aura would land on her OWN incoming
        // list unguarded — and since she genuinely holds Stealth here (proved above), it would
        // wrongly cut this by 30%, same as the self-scoped control does.
        const noAura = runSelfHitBoard([]);
        const withAura = runSelfHitBoard(auraPassiveSlot().abilities);
        expect(withAura).toBe(noAura);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// #363 hardening (item 4) — no enemy-side fixture existed for the aura, even though the code is
// side-agnostic by construction (`bySide`/`factionByActorId` carry no player/enemy branch) and the
// changelog claims enemy Fuyings protect their own side the same way. Mirrors the player-side
// "engine, on a real board" section above, with the sides swapped: an enemy Fuying, at her real
// support position/pattern, with a Stealthed enemy Tianchao ally inside her footprint — hit by a
// PLAYER attack instead of an enemy one.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** A plain "deals 100% damage" active ability — the same shape `buildEnemyPlayerActorRuntime`
 *  auto-synthesizes for a `shipSkills`-less manual enemy (engine.ts). The top-level FOCUS has no
 *  equivalent auto-synthesis (`CombatEngineInput.shipSkills` is required, not optional), so a
 *  focus that must actually attack — as the player-side one below does — needs this spelled out
 *  explicitly rather than omitted. */
const basicDamageAbility = (id: string): Ability => ({
    id,
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100, hits: 1 },
});

const enemyAuraBoard = (opts: { aura: boolean }): CombatEngineInput => ({
    attack: ENEMY_ATTACK,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
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
    hp: HUGE_HP,
    speed: 1, // the PLAYER attacker fires LAST — after the enemy ally's self-Stealth cast lands
    position: 'M1',
    pattern: lineRange2(),
    // `ignoresStealth: true`: the row-scan stealth filter (positionalBinding.ts) restores every
    // candidate ONLY when the WHOLE opposing roster is stealthed — here just the M-row ally is,
    // so an unfiltered scan would fall through to the (unstealthed) enemy-fuying at T2 instead.
    // The player-side board above sidesteps this by cloaking its entire roster; that trick is not
    // available here without ALSO stealthing enemy-fuying, which collides with an unrelated
    // engine quirk (an enemy attacker with BOTH a `pattern` and its own active-slot on-cast
    // ability skips that ability's real effect). `ignoresStealth` is the same escape hatch a
    // stealth-bypassing ship uses in production and is orthogonal to the aura this
    // section pins — target SELECTION under Stealth is already exhaustively covered above.
    target: { ...frontTarget(), ignoresStealth: true },
    shipSkills: { slots: [{ slot: 'active', abilities: [basicDamageAbility('focus-basic')] }] },
    enemyAttackers: [
        {
            id: 'enemy-fuying',
            chargeCount: 0,
            startCharged: false,
            faction: 'TIANCHAO',
            position: 'T2', // her real support position
            pattern: wingsSupportNotSelf2(), // her real support pattern → footprint {M2,M3,B1,B2,B3}
            shipSkills: { slots: opts.aura ? [auraPassiveSlot()] : [] },
            stats: { attack: 0, crit: 0, critDamage: 0, speed: 500, defence: 0, hp: HUGE_HP },
        },
        {
            id: 'enemy-ally-tianchao',
            chargeCount: 0,
            startCharged: false,
            faction: 'TIANCHAO',
            position: 'M3', // inside enemy-fuying's footprint
            shipSkills: {
                slots: [{ slot: 'active', abilities: [stealthSelfBuff('enemy-ally-stealth')] }],
            },
            // Fires FIRST (highest speed on the board) so it is Stealthed before the player hits.
            stats: { attack: 0, crit: 0, critDamage: 0, speed: 1000, defence: 0, hp: HUGE_HP },
        },
    ],
});

const runEnemyAuraBoard = (opts: { aura: boolean }): number => {
    const bus = createEventBus();
    let direct = 0;
    bus.on('attacked', (e) => {
        if (e.targetId === 'enemy-ally-tianchao' && e.damage !== undefined) direct += e.damage;
    });
    runCombat({ ...enemyAuraBoard(opts), bus });
    return direct;
};

describe('Fuying Stealth DR aura (#363) — engine, enemy-side mirror (item 4)', () => {
    it('PRE-CONDITION: the enemy Tianchao ally is actually hit directly, both with and without the aura', () => {
        expect(runEnemyAuraBoard({ aura: false })).toBeGreaterThan(0);
        expect(runEnemyAuraBoard({ aura: true })).toBeGreaterThan(0);
    });

    it('an ENEMY Fuying protects her own (enemy-side) Stealthed Tianchao ally by the same 30%, team-symmetrically', () => {
        const noAura = runEnemyAuraBoard({ aura: false });
        const withAura = runEnemyAuraBoard({ aura: true });
        expect(withAura).toBeCloseTo(0.7 * noAura, 5);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// #363 review follow-up (Fix 1) — THE AURA STOPS WHEN ITS CARRIER DIES.
//
// OWNER-RULED 2026-08-22. In a fight: round 2, Fuying alive, a Stealthed Tianchao ally takes
// 10,000 → 7,000. Round 3, Fuying destroyed, the same hit on the same still-Stealthed ally →
// the full 10,000.
//
// The bug this pins: the ally-scoped fan-out writes Fuying's aura `Ability` into each recipient's
// `incomingAbilitiesById` list ONCE at setup, and the per-hit fold reads that list with no owner
// identity at all — so a destroyed Fuying went on protecting her allies for the rest of the battle.
//
// Board (a two-enemy variant of the player-side board above, one ally instead of three):
//   Fuying  T2, her real Pattern-Wings-Support-Not-Self-Range-2 → footprint {M2,M3,B1,B2,B3},
//           and a SMALL hp pool in the dies-runs.
//   ally-m3 M3, TIANCHAO, self-Stealth for 99 turns → inside the footprint, faction matches.
//   enemy-1 M1, Pattern-Line-Range-2 @front, speed 500 → anchors the front-most M-row player
//           (ally-m3) EVERY round. This is the measured hit.
//   killer  T1, base pattern @front, speed 1 → acts LAST in the round and anchors the front-most
//           T-row player, i.e. Fuying, for LETHAL damage. So round 1's measured hit lands while
//           she is alive and round 2's lands after she is gone.
//
// Three runs, because two would not separate "she died" from "round 2 differs for some other
// reason" (the ally's Stealth lapsing, the enemy's anchor moving, an AoE share changing):
//   • dies + aura      — round 1 reduced, round 2 full   ← the rule
//   • survives + aura  — BOTH rounds reduced             ← proves the ally is still Stealthed, still
//                                                          in-pattern and still hit in round 2, so
//                                                          round 2's recovery above is about DEATH
//   • dies + no aura   — the full-damage yardstick both rounds
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const LETHAL = 10_000_000;
const FUYING_FRAGILE_HP = 1000;
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

const ownerDeathBoard = (opts: { aura: boolean; fuyingSurvives: boolean }): CombatEngineInput => ({
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    numRounds: 2,
    enemyDebuffs: [],
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: opts.fuyingSurvives ? HUGE_HP : FUYING_FRAGILE_HP,
    speed: 2000,
    mode: 'healing',
    healTargetId: 'attacker',
    faction: 'TIANCHAO',
    position: 'T2',
    pattern: wingsSupportNotSelf2(),
    // Same snapshot-Stealth reasoning as the board above: the row-scan stealth filter restores
    // every candidate only when the WHOLE player roster is Stealthed, and leaving Fuying visible
    // would make her the only pickable target — nobody would ever hit ally-m3. It also keeps the
    // `killer` below able to reach her.
    selfBuffs: FUYING_SNAPSHOT_STEALTH,
    shipSkills: { slots: [...(opts.aura ? [auraPassiveSlot()] : [])] },
    teamActors: [stealthedAlly('ally-m3', 'M3', 'TIANCHAO')],
    enemyAttackers: [
        {
            id: 'enemy-1',
            stats: {
                attack: ENEMY_ATTACK,
                crit: 0,
                critDamage: 0,
                defence: 0,
                hp: HUGE_HP,
                speed: 500, // after the ally's Stealth cast, before the killer
            },
            chargeCount: 0,
            startCharged: false,
            position: 'M1',
            target: frontTarget(),
            pattern: lineRange2(),
        },
        {
            id: 'killer',
            stats: {
                attack: LETHAL,
                crit: 0,
                critDamage: 0,
                defence: 0,
                hp: HUGE_HP,
                speed: 1, // LAST in the round, so round 1's measured hit precedes Fuying's death
            },
            chargeCount: 0,
            startCharged: false,
            position: 'T1', // Fuying's own row → `front` anchors on her
            target: frontTarget(),
            pattern: basePattern(),
        },
    ],
});

/** `enemy-1`'s direct damage on `ally-m3`, keyed by ROUND, plus the round Fuying was destroyed in.
 *
 *  ⚠️ SCOPED TO `enemy-1` ON PURPOSE, and the first draft was wrong without it. Once Fuying dies,
 *  row T is empty, so the `killer`'s `front` anchor falls through to ally-m3 and dumps its LETHAL
 *  10,000,000 into the round-2 total — which made the no-aura yardstick 2000× the real hit and the
 *  comparison meaningless. `enemy-1`'s ordinary 5,000-attack line hit is the thing being measured;
 *  the killer exists only to remove Fuying. */
const runOwnerDeathBoard = (opts: { aura: boolean; fuyingSurvives: boolean }) => {
    const bus = createEventBus();
    const byRound = new Map<number, number>();
    let fuyingDestroyedRound: number | undefined;
    bus.on('attacked', (e) => {
        if (e.targetId !== 'ally-m3' || e.attackerId !== 'enemy-1' || e.damage === undefined)
            return;
        byRound.set(e.round, (byRound.get(e.round) ?? 0) + e.damage);
    });
    bus.on('ship-destroyed', (e: CombatEvent) => {
        if (e.type === 'ship-destroyed' && e.actorId === 'attacker') fuyingDestroyedRound = e.round;
    });
    runCombat({ ...ownerDeathBoard(opts), bus });
    return { byRound, fuyingDestroyedRound };
};

describe('Fuying Stealth DR aura (#363) — a DESTROYED carrier stops protecting her allies', () => {
    // `lazyFixture`, not a plain arrow: built on first ACCESS (so after
    // `beforeAll(requireReferenceData)`, never during collection — Fix 3) and memoized, so each of
    // the three boards runs exactly once across all four arms.
    const dies = lazyFixture(() => runOwnerDeathBoard({ aura: true, fuyingSurvives: false }));
    const survives = lazyFixture(() => runOwnerDeathBoard({ aura: true, fuyingSurvives: true }));
    const noAura = lazyFixture(() => runOwnerDeathBoard({ aura: false, fuyingSurvives: false }));

    it('PRECONDITION: the ally is hit in BOTH rounds of every run (nothing here is 0 === 0)', () => {
        for (const [label, r] of [
            ['dies+aura', dies()],
            ['survives+aura', survives()],
            ['dies+noAura', noAura()],
        ] as const) {
            expect([...r.byRound.keys()].sort(), `${label}: wrong rounds`).toEqual([1, 2]);
            expect(r.byRound.get(1), `${label} r1`).toBeGreaterThan(0);
            expect(r.byRound.get(2), `${label} r2`).toBeGreaterThan(0);
        }
    });

    it('PRECONDITION: Fuying really is destroyed in round 1 of the dies-runs, and never in the survives-run', () => {
        // The instrument's own hinge. Without this the "round 2 is full damage" assertion below
        // could pass on a board where she simply never died and something else moved the number.
        expect(dies().fuyingDestroyedRound).toBe(1);
        expect(noAura().fuyingDestroyedRound).toBe(1);
        expect(survives().fuyingDestroyedRound).toBeUndefined();
    });

    it('CONTROL: while she LIVES the ally is reduced 30% in BOTH rounds', () => {
        // So the ally is provably still Stealthed, still inside the footprint and still being hit
        // in round 2 — the only thing that changes in the dies-run is that she is dead.
        const alive = survives();
        const full = noAura();
        expect(alive.byRound.get(1)!).toBeCloseTo(0.7 * full.byRound.get(1)!, 5);
        expect(alive.byRound.get(2)!).toBeCloseTo(0.7 * full.byRound.get(2)!, 5);
    });

    it('reduces the round-1 hit (she is alive for it) and NOT the round-2 hit (she is dead)', () => {
        const dead = dies();
        const full = noAura();
        expect(dead.byRound.get(1)!).toBeCloseTo(0.7 * full.byRound.get(1)!, 5);
        expect(dead.byRound.get(2)!).toBe(full.byRound.get(2)!);
    });
});
