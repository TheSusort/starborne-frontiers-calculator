# Healing-Calc Adoption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt the healing calculator onto the deterministic combat engine: skill-parsed heal/shield/cleanse abilities, HoT statuses, reactive heal triggers, a bombarded heal target with effective-healing/overheal/shield-absorption accounting, and enemy attacker cards with a damage-abilities-only walk — behind a new `simulateHealing` adapter, with the DPS public API and all 22 golden snapshots untouched.

**Architecture:** One engine pass (Approach A): `runCombat` gains an optional healing mode (`healTargetId` + `enemyAttackers`) that is inert when absent (DPS runs never set it → byte-identical goldens). Heals consume against the target's live `currentHp`; shields are an additive pool capped at max HP that drains before HP; enemies are queue actors whose turns deal deterministic damage through the existing defence formula. A new public adapter `simulateHealing` mirrors `simulateDPS`'s discipline. The legacy `healingSimulator`/`healingCalculator`/page UI are replaced wholesale.

**Tech Stack:** TypeScript, Vitest, React 18 + TailwindCSS, existing combat engine + parser.

**Spec:** `docs/superpowers/specs/2026-06-06-healing-calc-design.md` — read first. Reviewer-verified twice; decisions 1–9 are user-approved and NOT renegotiable.

---

## Project conventions (binding)

- Pre-commit hook runs full suite (~2 min); **NEVER `--no-verify`** for code commits (docs-only commits may).
- Golden suite `src/utils/calculators/__tests__/dpsGoldenParity.test.ts` (22 scenarios) = referee. **ZERO churn**; NEVER `vitest -u`; targeted regeneration = delete the one snapshot + re-run.
- No RegExp lookbehind in src/ (iOS Safari 15). ESLint zero warnings (`npm run lint`). No `'attacker'` literals in NEW engine-core comparisons — key on `focusActorId`/ids.
- Zero-RNG determinism: `makeRateGate` accumulators, per-actor gate instances, fixed listener/queue/recipient order. NEVER statistical `critRate × critDamage` blends.
- Listeners never mutate state; the engine/executor is the sole mutator. New event fields additive, present-only-when-true.
- Changelog: ONE evolving healing-calc entry in `UNRELEASED_CHANGES` (`src/constants/changelog.ts`) — implementer subagents must EDIT IT IN PLACE across tasks, never append duplicates. (The DPS entry is separate — leave it alone.)
- docs/ is gitignored — `git add -f` for the coverage doc / spec / plan.
- No emojis in UI text; use existing UI primitives (`src/components/ui/`), `card` class, `Modal`, etc.
- PERCENTAGE_ONLY_STATS are integers (crit 70 = 70%, not 0.70) — test fixtures must match.

## Spec refinements locked in this plan (read before implementing)

1. **Heals draw SEPARATE crit gates** (`activeHealCritGate`/`chargedHealCritGate` per actor), NOT the damage crit gates. Rationale: after this increment the parser emits heal abilities for real ships, so the DPS page's `shipSkills` will carry them; drawing heal crits from the damage gates would shift every damage-crit schedule for heal-carrying ships → DPS behavior change + golden risk. Separate gates keep damage byte-identical and stay deterministic. Heal abilities are single-draw (no multi-hit in the heal model); `noCrit` heals skip the draw.
2. **The dummy enemy stays the sole player-offense target.** Enemy attacker actors are offense-only queue actors; player damage/DoTs keep routing to the singular `enemy` dummy (zero change to the player pipeline). This implements the spec's "player enemy-targeted abilities route to the first enemy" line — the dummy IS that target. The healing adapter supplies the dummy internally with fixed defaults.
3. **Target stats for enemy attacks and `target-hp`/`incomingHeal` resolution come from `PlayerRoundCtx`** (the corrosion applier-ctx convention): `PlayerRoundCtx` gains additive `effectiveDefence`, `effectiveMaxHp`, `incomingHealPct` fields set by every player turn. An enemy attacking before the target's first-ever turn falls back to the target's BASE stats (runtime defence/hp, incomingHeal 0) — document in code.
4. **HoT applier attribution needs `casterId` on stored statuses:** `BuffState` and `ActiveAbilityStatus` gain optional `casterId` (additive). Applier-HP at tick time: caster === the acting actor → this turn's local `effectiveHp`; else `lastTurnCtxByActor.get(casterId)?.effectiveMaxHp`; no ctx yet → SKIP this tick (corrosion rule). Scheduled (manual-picker) HoTs have no caster → applier = the holder itself.
5. **Death semantics:** target `currentHp` floors at 0; once 0: target's own turns are SKIPPED (a destroyed ship doesn't act), heals/shields to it are skipped (still counted as raw output + overheal), enemy attacks against it are skipped (`incomingDamage` 0 after death). `destroyedRound` = the round its HP first hit 0. Sim runs all rounds.
6. **`avgHealingPerRound` is RAW** (totalHealing / rounds), not effective — name the comment in the result type.
7. **Two new live triggers:** `on-ally-critically-repaired` (owner's OWN `heal-performed` with `critHits ≥ 1` and ≥ 1 non-self recipient) and `on-ally-crit` (`ability-performed` from another player actor, enqueue once per critting hit — mirrors `on-crit` ally-scoped). Executor learns `heal`/`shield`/`cleanse` follow-ups. The `ally-critically-repaired` ConditionSubject coexists (manual gate ≠ live trigger) — do NOT collapse them.
8. **Healing mode gating:** the engine's healing block runs ONLY when `CombatEngineInput.healTargetId` is set. `simulateDPS` never sets it → inert for damage runs by construction.

---

### Task 0: Branch

**Files:** none

- [ ] **Step 0.1:** `git checkout main && git pull && git checkout -b feat/healing-calc-engine`
- [ ] **Step 0.2:** `npm test` — confirm green baseline (~1314 tests). Record the test/file count.

---

### Task 1: `hotPct` buff effect (ParsedBuffEffects + buffParser)

**Files:**
- Modify: `src/types/calculator.ts:80-103` (ParsedBuffEffects)
- Modify: `src/utils/calculators/buffParser.ts` (~line 23 area; mirrors the `Outgoing Repair` extraction)
- Test: `src/utils/calculators/__tests__/buffParser.test.ts` (extend; check the file's existing describe pattern first)

- [ ] **Step 1.1: Failing test.** Real buff descriptions from `src/constants/buffs.ts`:

```ts
describe('hotPct (Repair Over Time)', () => {
    it('parses "10% Applying Unit HP%" into hotPct', () => {
        expect(parseBuffDescription('10% Applying Unit HP%').hotPct).toBe(10);
    });
    it('parses Repair Over Time III (20%)', () => {
        expect(parseBuffDescription('20% Applying Unit HP%').hotPct).toBe(20);
    });
    it('Everliving Regeneration is NOT a HoT (incoming repair amplifier)', () => {
        const fx = parseBuffDescription('+20% Incoming Repair, +20 Security');
        expect(fx.hotPct).toBeUndefined();
        expect(fx.incomingHeal).toBe(20);
        expect(fx.security).toBe(20);
    });
});
```

(Adapt the parser entry-point name to the file's actual export — read `buffParser.ts` first; the extraction helpers and `extract(...)` regex pattern at lines 23/43 are the template.)

- [ ] **Step 1.2:** Run → FAIL (`hotPct` undefined for the HoT descriptions… and the key doesn't exist).
- [ ] **Step 1.3: types/calculator.ts** — in `ParsedBuffEffects`, after `incomingHeal`:

```ts
    /** Heal-over-time: % of the APPLYING unit's max HP healed to the holder per
     *  holder turn ("Repair Over Time I/II/III" — '10% Applying Unit HP%'). */
    hotPct?: number;
```

- [ ] **Step 1.4: buffParser.ts** — alongside the other extractions:

```ts
    const hotPct = extract(/([+-]?\d+(?:\.\d+)?)%\s*Applying\s*Unit\s*HP%?/i);
    if (hotPct !== undefined) effects.hotPct = hotPct;
```

(Match the file's exact `extract` helper signature/casing conventions.)

- [ ] **Step 1.5:** Run new tests (PASS) + `npx vitest run src/utils/calculators/` — goldens untouched (hotPct is a new key nothing consumes yet).
- [ ] **Step 1.6: Commit** — `git add src/types/calculator.ts src/utils/calculators/buffParser.ts src/utils/calculators/__tests__/buffParser.test.ts && git commit -m "feat: parse Repair Over Time 'Applying Unit HP%' into ParsedBuffEffects.hotPct"`

---

### Task 2: heal/shield/cleanse ability model + editor fields

**Files:**
- Modify: `src/types/abilities.ts:175` (heal/shield config variant), `:31-41` + `:52-59` (trigger union + LIVE_TRIGGERS — triggers come in Task 8; here only the config shape)
- Modify: `src/components/skills/AbilityCard.tsx` (new `case 'heal': case 'shield':` and `case 'cleanse':` bodies in `renderBody`)
- Modify: `src/components/skills/simCoverage.ts`
- Test: `src/components/skills/__tests__/AbilityCard.test.tsx` (extend, following its render/fire pattern)

- [ ] **Step 2.1: types/abilities.ts** — replace the heal/shield variant:

```ts
    | {
          type: 'heal' | 'shield';
          pct: number;
          /** Stat the amount scales from: caster max HP / attack / defence, or the
           *  RECIPIENT's max HP ('target-hp' — "of their Max HP"). */
          basis: 'hp' | 'attack' | 'defense' | 'target-hp';
          /** Pallas: "repair cannot critically hit". Shields never crit regardless. */
          noCrit?: boolean;
      }
```

(Existing stored configs with `basis: 'hp' | 'attack'` remain valid — pure widening.)

- [ ] **Step 2.2: Failing component test.** A heal ability renders pct + basis fields and propagates changes; a cleanse ability renders a count field:

```tsx
it('heal ability renders pct/basis/noCrit fields', () => { /* render AbilityCard with
   ability {type:'heal', config:{type:'heal', pct:15, basis:'hp'}}; assert inputs labelled
   'Percent' and 'Based on stat' exist; change pct → onChange called with pct updated */ });
it('cleanse ability renders count field', () => { /* config {type:'cleanse', count:1} */ });
```

- [ ] **Step 2.3:** Run → FAIL (falls to the default "No editable fields" case).
- [ ] **Step 2.4: AbilityCard.tsx** — add before the `default:` case:

```tsx
            case 'heal':
            case 'shield':
                return (
                    <div className="space-y-2">
                        <div className="flex gap-2">
                            <Input
                                label="Percent"
                                type="number"
                                step="0.01"
                                value={config.pct}
                                onChange={(e) =>
                                    updateConfig({ ...config, pct: toNumber(e.target.value) })
                                }
                            />
                            <Select
                                label="Based on stat"
                                value={config.basis}
                                options={HEAL_BASIS_OPTIONS}
                                onChange={(value) =>
                                    updateConfig({
                                        ...config,
                                        basis: value as 'hp' | 'attack' | 'defense' | 'target-hp',
                                    })
                                }
                            />
                        </div>
                        {config.type === 'heal' && (
                            <Checkbox
                                label="Cannot critically hit"
                                checked={config.noCrit ?? false}
                                onChange={(checked) =>
                                    updateConfig({ ...config, noCrit: checked ? true : undefined })
                                }
                            />
                        )}
                    </div>
                );

            case 'cleanse':
            case 'purge':
                return (
                    <Input
                        label="Count"
                        type="number"
                        min={1}
                        value={config.count}
                        onChange={(e) =>
                            updateConfig({ ...config, count: toNumber(e.target.value) })
                        }
                    />
                );
```

with (next to the other option constants):

```tsx
const HEAL_BASIS_OPTIONS = [
    { value: 'hp', label: "Caster's Max HP" },
    { value: 'attack', label: "Caster's Attack" },
    { value: 'defense', label: "Caster's Defense" },
    { value: 'target-hp', label: "Recipient's Max HP" },
];
```

- [ ] **Step 2.5: simCoverage.ts** — heal/shield/cleanse leave `NOT_SIMULATED_TYPES` (now consumed by the healing calculator): `NOT_SIMULATED_TYPES = new Set(['purge', 'control'])` (purge stays — output-count consumption is cleanse-only this increment; purge is Phase 4). Update `NOT_SIMULATED_NOTE` to `'Not simulated in the calculators yet.'` and the file's doc comment. NOTE: purge now renders the count field (Step 2.4) while still flagged not-simulated — that is fine (editable annotation).
- [ ] **Step 2.6:** Run AbilityCard tests + `npx vitest run src/components/ && npm run lint` — green, zero golden churn.
- [ ] **Step 2.7: Commit** — `git add src/types/abilities.ts src/components/skills/ && git commit -m "feat: heal/shield basis extension (defense, target-hp, noCrit) + editor fields for heal/shield/cleanse"`

---

### Task 3: Parser — heal/shield/cleanse extraction with disqualify guards

**Files:**
- Modify: `src/utils/skillTextParser.ts` (new exported parsers; DELETE `parseSkillHeal` happens in Task 12 with the page)
- Test: `src/utils/__tests__/skillTextParser.test.ts`

The CSV shapes to cover (verified 2026-06-06): `repairs N% of (its|this Unit's) [Mm]ax HP`, `repairs N% of its Attack`, `(an additional repair|amount) equal to N% of its Defense`, `of their Max HP` (recipient basis), `Shield equal to N% of (its Max HP|its attack|their Max HP)`, `cleanses N debuff(s)`. Targets resolve from the clause: `itself` → self; `that ally`/`the ally`/`them` → ally; `all allies` → all-allies; bare `repairs N% of its Max HP` with no target phrase on an active = self unless "to the ally/all allies" follows ("repairs 30% of its Max HP to the ally with the most missing health" → ally).

- [ ] **Step 3.1: Failing tests** (real CSV texts; trim to the relevant sentence where long):

```ts
describe('parseHealAbilities', () => {
    it('caster-HP heal to an ally', () => {
        expect(
            parseHealAbilities(
                'This unit <unit-damage>repairs the ally for 4%</unit-damage> of this Unit\'s Max HP.'
            )
        ).toEqual([{ kind: 'heal', pct: 4, basis: 'hp', target: 'ally' }]);
    });
    it('self repair', () => {
        expect(
            parseHealAbilities('This unit <unit-damage>repairs itself for 30%</unit-damage> of its Max HP.')
        ).toEqual([{ kind: 'heal', pct: 30, basis: 'hp', target: 'self' }]);
    });
    it('all-allies repair', () => {
        expect(
            parseHealAbilities('This unit <unit-damage>repairs 80%</unit-damage> of its max HP to all allies.')
        ).toEqual([{ kind: 'heal', pct: 80, basis: 'hp', target: 'all-allies' }]);
    });
    it('most-missing-health routes as ally', () => {
        expect(
            parseHealAbilities(
                'This unit <unit-damage>repairs 30%</unit-damage> of its Max HP to the ally with the most missing health.'
            )
        ).toEqual([{ kind: 'heal', pct: 30, basis: 'hp', target: 'ally' }]);
    });
    it('attack-based repair', () => {
        expect(parseHealAbilities('This unit <unit-damage>repairs 90%</unit-damage> of its Attack.')).toEqual([
            { kind: 'heal', pct: 90, basis: 'attack', target: 'self' },
        ]);
    });
    it('multi-component heal: HP + Defense', () => {
        expect(
            parseHealAbilities(
                'This unit <unit-damage>repairs 5%</unit-damage> of its Max HP with an additional repair equal to 100% of its Defense.'
            )
        ).toEqual([
            { kind: 'heal', pct: 5, basis: 'hp', target: 'self' },
            { kind: 'heal', pct: 100, basis: 'defense', target: 'self' },
        ]);
    });
    it('recipient-HP heal (their Max HP)', () => {
        expect(
            parseHealAbilities('Repairs all allies for <unit-damage>8%</unit-damage> of their Max HP.')
        ).toEqual([{ kind: 'heal', pct: 8, basis: 'target-hp', target: 'all-allies' }]);
    });
    it('shield from caster HP', () => {
        expect(
            parseHealAbilities(
                'This Unit gains a <unit-damage>Shield equal to 25%</unit-damage> of its Max HP at the start of combat.'
            )
        ).toEqual([{ kind: 'shield', pct: 25, basis: 'hp', target: 'self' }]);
    });
    it('shield from attack', () => {
        expect(
            parseHealAbilities('grants the ally a <unit-damage>shield equal to 180%</unit-damage> of its attack')
        ).toEqual([{ kind: 'shield', pct: 180, basis: 'attack', target: 'ally' }]);
    });
    // --- disqualify guards (Phase 4 / reactive shapes stay unparsed) ---
    it('damage-reactive shield is NOT parsed', () => {
        expect(
            parseHealAbilities(
                'gains a Shield equal to 25% of the damage taken when taking HP damage and still having Shield'
            )
        ).toEqual([]);
    });
    it('damage-dealt shield is NOT parsed', () => {
        expect(parseHealAbilities('gains a Shield equal to 15% of the Damage dealt to them')).toEqual([]);
    });
    it('revive/Cheat Death text is NOT parsed', () => {
        expect(
            parseHealAbilities(
                'Once per battle, when this unit is destroyed, it revives with 50% of its max HP.'
            )
        ).toEqual([]);
    });
    it('"X% of damage dealt" repair is NOT parsed (Valkyrie burst reaction)', () => {
        expect(
            parseHealAbilities(
                'this Unit and the ally with the lowest current health percentage <unit-damage>repair 5%</unit-damage> of damage dealt.'
            )
        ).toEqual([]);
    });
});

describe('parseCleanse', () => {
    it('parses cleanse count', () => {
        expect(parseCleanse('it <unit-aid>cleanses 1</unit-aid> debuff from itself')).toEqual([
            { count: 1, target: 'self' },
        ]);
    });
    it('ally cleanse', () => {
        expect(parseCleanse('<unit-aid>Cleanses 2</unit-aid> debuffs from all allies')).toEqual([
            { count: 2, target: 'all-allies' },
        ]);
    });
    it('does not parse purge as cleanse', () => {
        expect(parseCleanse('<unit-aid>purges 1</unit-aid> buff from the enemy')).toEqual([]);
    });
});

describe('parseHealNoCrit', () => {
    it('Pallas repair-cannot-crit sets heal noCrit', () => {
        expect(parseHealNoCrit('This repair cannot critically hit.')).toBe(true);
        expect(parseHealNoCrit('This attack cannot critically hit.')).toBe(false);
    });
});
```

- [ ] **Step 3.2:** Run → FAIL (functions don't exist).
- [ ] **Step 3.3: Implement in skillTextParser.ts.** Design notes (follow the file's conventions — `stripUnitTags`, sentence scoping via `'. '` boundaries, NO lookbehind):

```ts
export interface ParsedHealAbility {
    kind: 'heal' | 'shield';
    pct: number;
    basis: 'hp' | 'attack' | 'defense' | 'target-hp';
    target: 'self' | 'ally' | 'all-allies';
}

// Disqualify guards: clause-scoped (mask "Inc."/"Out." periods first if reusing the
// sentence splitter — see project_clause_scoping_abbrev_periods). A heal/shield whose
// clause matches one of these is Phase-4/reactive content — emit nothing:
//   /of the damage (taken|dealt)/i, /\bdamage dealt\b/i  (damage-reactive amounts)
//   /\brevives?\b/i, /\bcheat death\b/i                  (revive content)
// Walk ALL matches of the repair/shield regexes (global), one ParsedHealAbility per
// match, clause-scoping target + basis PER MATCH (multi-component heals emit two).
// Basis resolution per match, in priority order:
//   /of (its|this unit'?s?) max hp/i → 'hp';  /of its attack/i → 'attack';
//   /equal to .*?% of (its|this unit'?s?) defense/i → 'defense';
//   /of their max hp/i → 'target-hp'.
// Target resolution from the clause around the match:
//   itself → self; all allies / them (plural recipients) → all-allies;
//   (that|the) ally / most missing health → ally; default self.
```

Implement `parseHealAbilities(text)`, `parseCleanse(text)` (`/cleanses?\s+(\d+)/i` inside `<unit-aid>` or plain, target from clause; ignore `purge`), and `parseHealNoCrit(text)` (reuse `NO_CRIT_RE` at line 858: return true when a match's subject IS in `NO_CRIT_HEAL_SUBJECTS` — the exact complement of `parseNoCrit`).

- [ ] **Step 3.4:** Iterate to green. Then run the WHOLE parser suite (`npx vitest run src/utils/`) — existing tests must stay green (especially the Morao heal-as-secondary guard tests — your new parser must not disturb `parseSecondaryDamage`).
- [ ] **Step 3.5: Commit** — `git add src/utils/skillTextParser.ts src/utils/__tests__/skillTextParser.test.ts && git commit -m "feat: parse heal/shield/cleanse abilities from skill text with Phase-4 disqualify guards"`

---

### Task 4: Parser — buildShipAbilities emits heal/shield/cleanse abilities

**Files:**
- Modify: `src/utils/abilities/buildShipAbilities.ts` (`abilitiesFromText`, ~line 517)
- Modify: `scripts/auditSkills.ts` + `scripts/auditSkills.allowlist.ts` (read both first — extend the audit so heal/shield texts WITH a parsed ability stop counting as gaps; allowlist intentionally-unparsed reactive shapes)
- Test: `src/utils/abilities/__tests__/buildShipAbilities.test.ts`

- [ ] **Step 4.1: Failing tests** (use the file's `ship()` fixture helper — read its defaults; refits default to 4):

```ts
it('emits heal abilities with text-position ordering', () => {
    const s = ship({
        activeSkillText:
            "This unit deals <unit-damage>120% damage</unit-damage> and <unit-damage>repairs the ally for 4%</unit-damage> of this Unit's Max HP.",
    });
    const active = buildShipAbilities(s).slots.find((x) => x.slot === 'active');
    const heal = active?.abilities.find((a) => a.type === 'heal');
    expect(heal).toMatchObject({
        target: 'ally',
        trigger: 'on-cast',
        config: { type: 'heal', pct: 4, basis: 'hp' },
        autoFilled: true,
    });
    // damage ability still present and FIRST (its tag precedes the repair in the text)
    expect(active!.abilities[0].type).toBe('damage');
});

it('emits shield abilities', () => { /* charge text with "Shield equal to 30% of its Max HP"
    → charged slot carries {type:'shield', config:{pct:30, basis:'hp'}, target:'self'} */ });

it('emits cleanse abilities', () => { /* "cleanses 1 debuff from all allies" → cleanse,
    config {count:1}, target 'all-allies' */ });

it('heal noCrit flows from parseHealNoCrit', () => { /* text with a heal + "This repair
    cannot critically hit." → heal config.noCrit === true; damage (if any) noCrit ABSENT */ });

it('damage-reactive shield emits nothing', () => { /* "Shield equal to 25% of the damage
    taken…" → no shield ability on the slot */ });
```

- [ ] **Step 4.2:** Run → FAIL.
- [ ] **Step 4.3: buildShipAbilities.ts** — in `abilitiesFromText`, after the accumulate block (follow the established PositionedAbility pattern):

```ts
    const healNoCrit = parseHealNoCrit(text);
    for (const h of parseHealAbilities(text)) {
        // Anchor at the tag carrying THIS pct (mirrors the damage anchor convention).
        const healTagPos = text.search(
            new RegExp(`<unit-damage>(?:[^<]*?)${escNum(h.pct)}%`, 'i')
        );
        const fallbackPos = text.search(h.kind === 'shield' ? /shield/i : /repair/i);
        out.push({
            ability: {
                id: nextId(),
                type: h.kind,
                target: h.target,
                trigger: 'on-cast',
                conditions: [],
                config: {
                    type: h.kind,
                    pct: h.pct,
                    basis: h.basis,
                    ...(h.kind === 'heal' && healNoCrit ? { noCrit: true } : {}),
                },
                autoFilled: true,
            },
            pos: healTagPos >= 0 ? healTagPos : fallbackPos >= 0 ? fallbackPos : MAX_POS,
        });
    }

    for (const c of parseCleanse(text)) {
        const cleansePos = text.search(/cleanse/i);
        out.push({
            ability: {
                id: nextId(),
                type: 'cleanse',
                target: c.target,
                trigger: 'on-cast',
                conditions: [],
                config: { type: 'cleanse', count: c.count },
                autoFilled: true,
            },
            pos: cleansePos >= 0 ? cleansePos : MAX_POS,
        });
    }
```

Import the three new parsers. NOTE: `escNum` exists locally in `abilitiesFromText` — reuse it.

- [ ] **Step 4.4: Audit.** Run `npm run audit:skills`. Triage the report: heal/shield/cleanse texts now emitting abilities should clear their unmodeled-gap rows; guarded reactive shapes (damage-reactive shields, revives) get `auditSkills.allowlist.ts` entries with reasons (follow the existing `AllowEntry` shape). The audit run must end with 0 unexpected findings. Record before/after counts in the commit message.
- [ ] **Step 4.5:** Full abilities + parser + golden suites green (`npx vitest run src/utils/`). Goldens: heal abilities now appear in `shipSkills` built from texts, but the ENGINE ignores them until Task 6 and golden fixtures are hand-built configs — verify `git diff --stat -- '*.snap'` is empty anyway.
- [ ] **Step 4.6: Commit** — `git add src/utils/abilities scripts/ && git commit -m "feat: buildShipAbilities emits heal/shield/cleanse abilities (text-position ordered, audit-clean)"`

---

### Task 5: Engine groundwork — PlayerRoundCtx stats, heal buff channels, runtime fields (zero behavior change)

**Files:**
- Modify: `src/utils/combat/playerTurn.ts` (PlayerRoundCtx ~line 56, calculateBuffTotals ~line 176, runtime interface ~line 85, turnCtx assembly ~line 1213)
- Modify: `src/utils/calculators/dpsBuffHelpers.ts` (`toSimBuffs` gains outgoingHeal/incomingHeal/hotPct entries)
- Modify: `src/types/calculator.ts` (`Buff['stat']` union — read it first; extend with the new stat keys)
- Test: `src/utils/combat/__tests__/healing.test.ts` (create — this file grows through Tasks 5-9)

This task threads heal-relevant numbers through the existing folds WITHOUT consuming them — pure additive plumbing, provably inert for DPS.

- [ ] **Step 5.1: Failing unit test** for the fold helpers:

```ts
// calculateBuffTotals is module-private — test through resolveSelfBuffTotals?? No:
// EXPORT a tested seam instead. Plan: extend calculateBuffTotals to also sum
// 'outgoingHeal' | 'incomingHeal' stats, and export a small helper for the test:
it('toSimBuffs carries outgoingHeal/incomingHeal/hotPct', () => {
    const buffs = toSimBuffs([
        { id: 'x', buffName: 'Out Repair', stacks: 2, isStackable: false,
          parsedEffects: { outgoingHeal: 15, incomingHeal: 10, hotPct: 10 } },
    ]);
    expect(buffs).toEqual(expect.arrayContaining([
        expect.objectContaining({ stat: 'outgoingHeal', value: 30 }),
        expect.objectContaining({ stat: 'incomingHeal', value: 20 }),
        expect.objectContaining({ stat: 'hotPct', value: 20 }),
    ]));
});
```

- [ ] **Step 5.2:** Run → FAIL.
- [ ] **Step 5.3: Implement:**
  - `Buff['stat']` union (types/calculator.ts — find the `Buff` interface): add `'outgoingHeal' | 'incomingHeal' | 'hotPct'`.
  - `toSimBuffs`: three new `if (parsedEffects.X !== undefined)` entries mirroring the existing ones. SAFE: every existing consumer filters by specific stat names — new entries are invisible to them (verify by reading `calculateBuffTotals` and any other `toSimBuffs` consumers — grep).
  - `calculateBuffTotals` (playerTurn.ts): add `outgoingHealBuff` and `incomingHealBuff` sums to the returned object (hotPct is NOT summed here — HoTs need per-status applier identity, Task 7 reads statuses directly).
  - `PlayerActorRuntime`: add `healModifier: number;` (after `hp`). Set it in BOTH runtime constructions in engine.ts (attacker: from a new `CombatEngineInput.healModifier?: number` defaulting 0; team: from a new optional `walk.healModifier` defaulting 0). `TeamActorEngineInput.walk` + the adapter mapping in dpsSimulator.ts:207-229 — pass `healModifier: 0` for DPS-built walks (the DPS adapter has no healModifier input; the healing adapter supplies real values in Task 9).
  - `PlayerRoundCtx`: add `effectiveDefence: number; effectiveMaxHp: number; incomingHealPct: number;`. Set in the `turnCtx` assembly (playerTurn.ts:1213): `effectiveDefence` and `effectiveHp` already exist as locals; `incomingHealPct = incomingHealBuff (scheduled) + ability-status incomingHeal totals` — fold the ability path exactly where `abilitySelfTotals` folds (extend that destructure with the two new keys).
- [ ] **Step 5.4:** Run FULL suite + goldens: `npm test` — ZERO churn (`git diff --stat -- '*.snap'` empty). The new ctx fields are written, never read; new buff entries are filtered out by all existing consumers.
- [ ] **Step 5.5: Commit** — `git add -A src/ && git commit -m "feat: thread heal stat channels (outgoingHeal/incomingHeal/hotPct, healModifier, ctx defence/maxHp) through the engine folds — inert plumbing"`

---

### Task 6: Engine — healing mode: heal/shield/cleanse consumption + heal-performed event

**Files:**
- Modify: `src/utils/combat/state.ts` (ActorHealing; `shieldPool` on CombatActor + createActor)
- Modify: `src/utils/combat/events.ts` (heal-performed)
- Modify: `src/utils/combat/playerTurn.ts` (heal block in runPlayerTurn; heal gates on the runtime)
- Modify: `src/utils/combat/engine.ts` (healing-mode state, `healTargetId` input, healing accumulator + additive return)
- Test: `src/utils/combat/__tests__/healing.test.ts`

- [ ] **Step 6.1: state.ts additions:**

```ts
/** Per-actor healing contributions within one round (healing-calc adoption; mirrors
 *  ActorDamage). effectiveHeal/overheal partition the TARGET-routed portion of
 *  directHeal+hotHeal; non-target recipients count raw only. */
export interface ActorHealing {
    directHeal: number;
    hotHeal: number;
    shield: number;
    cleanseCount: number;
    effectiveHeal: number;
    overheal: number;
}

export function emptyActorHealing(): ActorHealing {
    return { directHeal: 0, hotHeal: 0, shield: 0, cleanseCount: 0, effectiveHeal: 0, overheal: 0 };
}
```

CombatActor gains `/** Absorption pool (healing mode): additive, capped at max HP, drains before HP. */ shieldPool: number;` — initialize `shieldPool: 0` in `createActor`.

- [ ] **Step 6.2: events.ts** — new variant (after dot-applied):

```ts
    /** A heal/shield cast resolved (healing mode only). `targets` lists recipient actor
     *  ids in application order; `amount` is the summed RAW amount across recipients.
     *  `critHits` present only when ≥ 1 (single-draw heals: 0 or 1). */
    | {
          type: 'heal-performed';
          casterId: string;
          targets: string[];
          round: number;
          amount: number;
          critHits?: number;
      }
```

- [ ] **Step 6.3: Failing engine tests** (healing.test.ts — build fixtures the way `extraActions.test.ts` builds `ab`/BASE runCombat inputs; read it first). Healing mode needs a target: pass `healTargetId` + a team actor as target. Cover:

1. **Self-heal raw:** focus actor (also the heal target — `healTargetId: 'attacker'`) with active `{type:'heal', pct:10, basis:'hp'}`, hp 10000, full HP, no enemies → each round `directHeal` 1000 raw, `effectiveHeal` 0, `overheal` 1000 (full-HP target wastes it).
2. **Ally-heal routing:** heal target = team actor `t1` (hp 20000); focus heals `ally` 10% of own hp (10000) → 1000 raw credited to the FOCUS actor's map entry; consumption vs t1's missing HP.
3. **Basis resolution:** attack-based (pct 90, attack 5000 → 4500), defense-based, and `target-hp` (10% of t1's 20000 → 2000).
4. **Crit heals:** crit 100 → every heal draws crit → amount × (1 + cd/100); `heal-performed.critHits: 1`. crit 0 → no critHits field. noCrit heal at crit 100 → no draw, base amount (assert the heal gates don't advance — follow with a 50%-crit heal and check its schedule starts fresh).
5. **outgoingHeal/healModifier/incomingHeal folds:** caster healModifier 20 + an outgoingHeal +15 self buff + target carrying an incomingHeal +20 buff → amount = base × 1.20 × 1.15 × 1.20 (target's incomingHealPct from ITS ctx; target must act before the caster for round-1 ctx — give it higher speed, or assert round 2+).
6. **Shield pool:** shield ability 25% hp → pool 2500; second cast → 5000; cap at target max HP; `shield` bucket counts raw granted.
7. **Cleanse count:** active with `{type:'cleanse', count:2}` → cleanseCount 2 per cast.
8. **all-allies summing:** heal all-allies with focus+2 team actors → raw = 3 × per-recipient amount; only the target's slice consumption-tracked.

- [ ] **Step 6.4:** Run → FAIL (no healing mode).
- [ ] **Step 6.5: Implement.**

**engine.ts:** `CombatEngineInput` gains `healModifier?: number` (Task 5), `healTargetId?: string`. Healing-mode state in runCombat:

```ts
    const healingMode = input.healTargetId !== undefined;
    const healTarget = healingMode
        ? allPlayerActors.find((a) => a.id === input.healTargetId)
        : undefined;
    if (healingMode && !healTarget) {
        throw new Error(`runCombat: healTargetId '${input.healTargetId}' is not a player actor`);
    }
```

Per-round healing accumulator beside `roundDamage`:

```ts
    const roundHealing = healingMode ? new Map<string, ActorHealing>() : undefined;
    const heal = (id: string): ActorHealing => { /* lazy-create, mirrors dmg() */ };
```

A `HealingRuntimeCtx` bundle threaded into runPlayerTurn (additive optional arg):

```ts
export interface HealingRuntimeCtx {
    targetId: string;
    /** Live target actor (currentHp/shieldPool mutate ONLY through engine-owned helpers). */
    target: CombatActor;
    targetBaseHp: number;     // runtime max-hp basis fallback (pre-first-turn)
    targetBaseDefence: number;
    credit: (actorId: string, bucket: keyof ActorHealing, amount: number) => void;
    /** Resolve a recipient's effective max HP / incomingHeal% via lastTurnCtxByActor,
     *  base-stat fallback (refinement 3). */
    recipientMaxHp: (actorId: string) => number;
    recipientIncomingHealPct: (actorId: string) => number;
    /** Apply a target-routed heal: consumed = min(raw, maxHp − currentHp) unless dead.
     *  Returns {consumed, overheal}. Mutates target.currentHp. */
    applyHealToTarget: (raw: number) => { consumed: number; overheal: number };
    /** Add to the shield pool, capped at target max HP. Dead target → no-op (all raw). */
    grantShieldToTarget: (raw: number) => void;
}
```

Implement the helpers IN engine.ts (the engine is the mutator). `applyHealToTarget`: dead (currentHp <= 0) → `{consumed: 0, overheal: raw}`. `recipientMaxHp(id)`: `lastTurnCtxByActor.get(id)?.effectiveMaxHp ?? baseHpFor(id)` where baseHpFor reads the runtime's `hp` (build a small id→baseStats map from the runtimes; legacy team actors without runtimes fall back to `actor.stats.hp`).

**playerTurn.ts:** runtime gains `activeHealCritGate: RateGate; chargedHealCritGate: RateGate;` (constructed per actor in engine.ts beside the other gates — BOTH for the attacker runtime and walked team runtimes). `PlayerTurnArgs` gains `healing?: HealingRuntimeCtx`. After the damage/ability-performed block (a clean sequence point after `extendDoTs` — pick after the accumulators/before turnCtx, and KEEP IT FIXED), add the heal block, processing `gatedSkill` + `gatedPassive` abilities in their array order:

```ts
    if (args.healing) {
        const healing = args.healing;
        const healCritGate = action === 'charged' ? chargedHealCritGate : activeHealCritGate;
        let healPerformedAmount = 0;
        let healPerformedCrits = 0;
        const healTargets: string[] = [];
        const recipientsFor = (target: Ability['target']): string[] =>
            target === 'self'
                ? [actor.id]
                : target === 'ally'
                  ? [healing.targetId]                 // user-confirmed routing rule
                  : target === 'all-allies'
                    ? playerIdsInOrder                  // threaded in via healing ctx or args
                    : [];
        for (const ability of [
            ...(gatedSkill?.abilities ?? []),
            ...(gatedPassive?.abilities ?? []),
        ]) {
            const cfg = ability.config;
            if (cfg.type === 'heal') {
                const recipients = recipientsFor(ability.target);
                if (!recipients.length) continue;
                const didCrit = cfg.noCrit ? false : healCritGate(effectiveCrit / 100);
                const critMult = didCrit ? 1 + effectiveCritDamage / 100 : 1;
                for (const rid of recipients) {
                    const basisValue =
                        cfg.basis === 'attack' ? effectiveAttack
                        : cfg.basis === 'defense' ? effectiveDefence
                        : cfg.basis === 'target-hp' ? healing.recipientMaxHp(rid)
                        : effectiveHp;
                    const raw =
                        basisValue * (cfg.pct / 100) * critMult *
                        (1 + runtime.healModifier / 100) *
                        (1 + outgoingHealBuff / 100) *
                        (1 + healing.recipientIncomingHealPct(rid) / 100);
                    healing.credit(actor.id, 'directHeal', raw);
                    if (rid === healing.targetId) {
                        const { consumed, overheal } = healing.applyHealToTarget(raw);
                        healing.credit(actor.id, 'effectiveHeal', consumed);
                        healing.credit(actor.id, 'overheal', overheal);
                    }
                    healPerformedAmount += raw;
                    healTargets.push(rid);
                }
                if (didCrit) healPerformedCrits += 1;
            } else if (cfg.type === 'shield') {
                const recipients = recipientsFor(ability.target);
                for (const rid of recipients) {
                    const basisValue = /* same basis resolution, NO crit, NO heal modifiers */;
                    const raw = basisValue * (cfg.pct / 100);
                    healing.credit(actor.id, 'shield', raw);
                    if (rid === healing.targetId) healing.grantShieldToTarget(raw);
                }
            } else if (cfg.type === 'cleanse') {
                healing.credit(actor.id, 'cleanseCount', cfg.count);
            }
        }
        if (healTargets.length > 0) {
            bus.emit({
                type: 'heal-performed',
                casterId: actor.id,
                targets: healTargets,
                round: r,
                amount: healPerformedAmount,
                ...(healPerformedCrits > 0 ? { critHits: healPerformedCrits } : {}),
            });
        }
    }
```

Details the implementer must get right:
  - `outgoingHealBuff`/`incomingHealBuff` from the Task-5 `calculateBuffTotals` extension — fold ability-status payload totals too (same place `abilitySelfTotals` folds the other six).
  - One crit draw PER HEAL ABILITY (not per recipient). The DRAW happens even for an all-allies heal once.
  - INCOMING heal % uses the RECIPIENT's value: for `rid === actor.id` use this turn's own local `incomingHealBuff`; for the target use `recipientIncomingHealPct(targetId)` (its ctx); for other recipients use 0 (documented approximation: non-target, non-self recipient amplifiers unmodeled this increment).
  - `playerIdsInOrder` — thread `playerIds` into PlayerTurnArgs (it already exists in the engine; pass it down) or carry it on the healing ctx; pick ONE and document.
  - Heal-mode skip when `args.healing` is undefined → byte-identical DPS runs.
  - Gated heal/shield/cleanse abilities respect `gateFiringAbilities` automatically (we iterate the GATED skill).

**engine.ts (assembly):** after the round loop's post-round assembly, when `healingMode`, push into a `healingRounds` array (additive return field):

```ts
export interface HealingRoundEngine {
    perActor: Map<string, ActorHealing>;
    targetHpPctStart: number;      // entering the round
    targetShieldStart: number;     // entering the round
    incomingDamage: number;        // enemy damage thrown at the target this round (Task 8)
    shieldAbsorbed: number;        // (Task 8)
}
// runCombat return gains: healing?: { rounds: HealingRoundEngine[]; destroyedRound?: number }
```

Capture `targetHpPctStart`/`targetShieldStart` at round top (before any turn); incomingDamage/shieldAbsorbed stay 0 until Task 8. `destroyedRound` set when `healTarget.currentHp` first reaches 0.

- [ ] **Step 6.6:** Tests green. FULL suite + goldens — zero churn (`healTargetId` unset everywhere existing).
- [ ] **Step 6.7: Commit** — `git add src/utils/combat src/utils/calculators && git commit -m "feat: engine healing mode — heal/shield/cleanse consumption vs a live heal target, separate heal crit gates, heal-performed events"`

---

### Task 7: Engine — HoT (Repair Over Time) ticking with applier attribution

**Files:**
- Modify: `src/utils/combat/statusEngine.ts` (BuffState + ActiveAbilityStatus gain `casterId?`)
- Modify: `src/utils/combat/playerTurn.ts` (HoT tick inside the healing block)
- Test: `src/utils/combat/__tests__/healing.test.ts` (extend)

- [ ] **Step 7.1: Failing tests:**

1. Focus healer grants the TARGET a timed buff ability `{buffName:'Repair Over Time II', parsedEffects:{hotPct:15}, duration: 2}` target `ally` → on each of the TARGET's turns while the window stands, the target heals `casterEffectiveHp × 15%`, credited to the CASTER's `hotHeal`, consumption-tracked (effective/overheal split).
2. Self-HoT (caster === holder): scales with the caster's CURRENT turn effectiveHp (hp buff active → larger tick).
3. Caster hasn't acted yet this run (target faster, round 1) → tick SKIPPED that turn (corrosion rule), ticks from round 2.
4. Scheduled (manual `selfBuffs` list) Repair Over Time on the FOCUS actor → applier = holder itself (no caster identity), heals holder hp × hotPct.

- [ ] **Step 7.2:** Run → FAIL.
- [ ] **Step 7.3: statusEngine.ts** — `BuffState` gains `casterId?: string`; `applyTimedAbilityStatus` stamps `casterId: status.casterId` into the map entry; `ActiveAbilityStatus` gains `casterId?: string`; `timedAbilityStatuses` + `activeAbilityStatuses` return it (`casterId: s.casterId` / `a.casterId`). All additive — no existing test churn (verify).
- [ ] **Step 7.4: playerTurn.ts** — inside the `if (args.healing)` block, BEFORE the cast-heal loop (HoTs tick at turn start conceptually; FIXED ordering — document):

```ts
        // HoT ticks: every active self status on THIS actor whose payload carries hotPct
        // heals this actor (the holder) for applierEffectiveHp × hotPct% × stacks.
        // Applier ctx at TICK time (corrosion rule): caster === this actor → this turn's
        // local effectiveHp; foreign caster → lastTurnCtxByActor.get(casterId) (skip when
        // absent — the applier hasn't acted yet this run). Scheduled (no-payload) HoTs:
        // expand via selfBuffLookup; applier = the holder itself.
        for (const s of [
            ...statusEngine.timedAbilityStatuses('self', actor.id),
            ...statusEngine.activeAbilityStatuses('self', resolveCtx(postDebuffGateCtx), actor.id),
        ]) {
            const hotPct = s.payload.parsedEffects.hotPct;
            if (!hotPct) continue;
            const applierId = s.casterId ?? actor.id;
            const applierHp =
                applierId === actor.id
                    ? effectiveHp
                    : args.healing.recipientMaxHp /* NO — see below */;
            ...
        }
```

IMPORTANT correction the implementer must apply: foreign-applier HP must come from `lastTurnCtxByActor.get(applierId)?.effectiveMaxHp` and SKIP when undefined — do NOT use `recipientMaxHp` (it falls back to base stats; HoT follows the strict corrosion skip rule). Thread a `applierMaxHp: (id: string) => number | undefined` accessor on `HealingRuntimeCtx`. Per tick: `raw = applierHp × (hotPct/100) × (payload stacks where applicable) × (1 + recipientIncomingHealPct(actor.id)/100)`; credit `hotHeal` to the APPLIER's map entry; if `actor.id === healing.targetId` apply consumption (`applyHealToTarget`) crediting effective/overheal to the APPLIER. Also walk the SCHEDULED self statuses (`entry.activeSelfBuffs` expanded via `selfBuffLookup`) for hotPct entries — applier = `actor.id`, local effectiveHp. NOTE: do NOT double-count — payload statuses come from the two ability-status reads; scheduled from the lookup expansion; they are disjoint sources.

(HoT heals never crit and ignore healModifier/outgoingHeal — they are the applier's standing effect, not a cast. Document as a rule; verify in-game on the live checklist.)

- [ ] **Step 7.5:** Tests green; full suite + goldens zero churn.
- [ ] **Step 7.6: Commit** — `git add src/utils/combat && git commit -m "feat: Repair Over Time ticking — applier-HP-scaled at tick time, applier-attributed, consumption-aware"`

---

### Task 8: Engine — enemy attackers (manual + basics walk) and target damage intake

**Files:**
- Create: `src/utils/combat/enemyTurn.ts`
- Modify: `src/utils/combat/engine.ts` (enemyAttackers input, queue inclusion, enemy-turn dispatch, incomingDamage/shieldAbsorbed/destroyedRound wiring, dead-target turn skip)
- Modify: `src/utils/combat/state.ts` ONLY if a helper is needed (prefer not)
- Test: `src/utils/combat/__tests__/healing.test.ts` + `src/utils/combat/__tests__/enemyTurn.test.ts` (create)

- [ ] **Step 8.1: enemyTurn.ts** — the new module:

```ts
import { calculateDamageReduction } from '../autogear/priorityScore';
import { ShipSkills } from '../../types/abilities';
import { selectFiringSkill, damageInputsFromSkill } from '../abilities/applyAbilities';
import { CombatActor } from './state';
import { RateGate } from './playerTurn';

/** Everything one enemy attacker's turns need. Built once at engine setup. */
export interface EnemyAttackerRuntime {
    actor: CombatActor;
    /** Damage-abilities-only walk (basics walk, spec decision 9). Absent → one basic
     *  attack per turn (manual flat card). */
    castSkills?: ShipSkills;
    hasChargedSkill: boolean;
    activeCritGate: RateGate;
    chargedCritGate: RateGate;
}

export interface EnemyAttackResult {
    /** Damage thrown at the target this turn (pre-shield). 0 when the target is dead. */
    damage: number;
    action: 'active' | 'charged';
}

/**
 * One enemy attacker turn: charge cadence mirroring the team-actor block
 * (+1/turn, fire-and-reset at chargeCount; no bonus/ally charges reach enemies —
 * spec decision 9), then damage vs the target's current effective defence:
 *   manual: one hit at multiplier 100%.
 *   walk: the firing slot's damage ability (multiplier × hits, per-hit crit draws,
 *         noCrit respected). Non-damage abilities are SKIPPED (Phase 4).
 * Blended per-hit crit multiplier mirrors the player pipeline:
 *   1 + (critHits/hits) × (critDamage/100).
 * No enemy buffs/affinity/outgoing modifiers — enemies are bare-stat actors.
 */
export function runEnemyAttackerTurn(args: {
    runtime: EnemyAttackerRuntime;
    targetDefence: number; // target's current effective defence (ctx or base fallback)
    targetDead: boolean;
}): EnemyAttackResult {
    const { runtime, targetDefence, targetDead } = args;
    const { actor } = runtime;
    // Cadence runs even against a dead target (charges keep banking — the fight goes on).
    let action: 'active' | 'charged';
    if (runtime.hasChargedSkill && actor.charges >= actor.chargeCount) {
        action = 'charged';
        actor.charges = 0;
    } else {
        action = 'active';
        if (runtime.hasChargedSkill) actor.charges += 1;
    }
    if (targetDead) return { damage: 0, action };

    let multiplier = 100;
    let hits = 1;
    let noCrit = false;
    if (runtime.castSkills) {
        const firing = selectFiringSkill(runtime.castSkills, action);
        const d = damageInputsFromSkill(firing);
        // A walked slot with no damage ability contributes nothing this turn
        // (utility-only enemy slots are unmodeled — Phase 4).
        if (d.multiplier <= 0) return { damage: 0, action };
        multiplier = d.multiplier;
        hits = d.hits;
        noCrit = d.noCrit;
    }
    const gate = action === 'charged' ? runtime.chargedCritGate : runtime.activeCritGate;
    let critHits = 0;
    const drawHits = noCrit ? 0 : hits;
    for (let h = 0; h < drawHits; h++) {
        if (gate(actor.stats.crit / 100)) critHits += 1;
    }
    const critFraction = drawHits > 0 ? critHits / drawHits : 0;
    const critMult = 1 + critFraction * (actor.stats.critDamage / 100);
    const reduction = targetDefence > 0 ? calculateDamageReduction(targetDefence) : 0;
    const damage =
        actor.stats.attack * ((multiplier * hits) / 100) * critMult * (1 - reduction / 100);
    return { damage, action };
}
```

- [ ] **Step 8.2: Failing unit tests** (`enemyTurn.test.ts`): manual card damage formula (hand-computed vs `calculateDamageReduction`); crit-gate schedule at crit 50 (back-loaded accumulator: fires on draw 2, 4, …); charge cadence (chargeCount 3, startCharged false → charged on turn 4); walked nuke (charged slot multiplier 400 → spike on charged turns); multi-hit per-hit crits (3 hits, crit 100 → ×(1+cd)); dead target → damage 0 but cadence advances.
- [ ] **Step 8.3:** Run → FAIL → implement → PASS.
- [ ] **Step 8.4: engine.ts integration.** `CombatEngineInput` gains:

```ts
    /** Enemy attackers (healing mode): offense-only queue actors bombarding the heal
     *  target. The singular dummy `enemy` remains the player-offense target + DoT carrier. */
    enemyAttackers?: {
        id: string;
        stats: { attack: number; crit: number; critDamage: number; speed: number };
        chargeCount: number;
        startCharged: boolean;
        shipSkills?: ShipSkills;
    }[];
```

Build `CombatActor`s (side 'enemy', kind 'enemy', defence/hp/defensePenetration 0 — ActorStats requires them) + `EnemyAttackerRuntime`s with own gates. For walked enemies, partition? NO — enemies use `selectFiringSkill` directly on the RAW shipSkills (damage abilities are never reactive; partitioning is unnecessary — document). `hasChargedSkill` mirrors the adapter rule: `chargeCount >= 1 && (charged slot has ANY damage ability)` — compute with `selectFiringSkill(shipSkills,'charged')` + `damageInputsFromSkill(...).multiplier > 0`; manual cards: `chargeCount >= 1` is meaningless without a skill → hasChargedSkill false (flat cards have one basic attack; document).

Queue: `buildTurnQueue([...teamCombatActors, attacker, enemy, ...enemyAttackerActors])`. In the turn dispatch, the `actor.kind === 'enemy'` branch becomes:

```ts
            } else if (actor.kind === 'enemy' && actor.id === enemy.id) {
                // DUMMY ENEMY TURN — DoT ticking (unchanged block)
            } else if (actor.kind === 'enemy') {
                // ENEMY ATTACKER TURN (healing mode only — these actors exist only then)
                const rt = enemyAttackerRuntimeById.get(actor.id)!;
                const targetCtx = lastTurnCtxByActor.get(healTarget!.id);
                const targetDefence = targetCtx?.effectiveDefence ?? healTargetBaseDefence;
                const dead = healTarget!.currentHp <= 0;
                const result = runEnemyAttackerTurn({ runtime: rt, targetDefence, targetDead: dead });
                if (result.damage > 0) {
                    roundIncomingDamage += result.damage;
                    // Shield first, then HP (spec decisions 7-8).
                    const absorbed = Math.min(healTarget!.shieldPool, result.damage);
                    healTarget!.shieldPool -= absorbed;
                    roundShieldAbsorbed += absorbed;
                    healTarget!.currentHp = Math.max(0, healTarget!.currentHp - (result.damage - absorbed));
                    if (healTarget!.currentHp <= 0 && destroyedRound === undefined) {
                        destroyedRound = r;
                        bus.emit({ type: 'ship-destroyed', actorId: healTarget!.id, round: r });
                    }
                }
            }
```

(`roundIncomingDamage`/`roundShieldAbsorbed` are fresh per-round locals folded into the round's `HealingRoundEngine` entry. `enemy.id` comparison is id-keyed — no literal `'attacker'`.)

**Dead-target turn skip:** in the player-turn dispatch, before running a turn for the TARGET actor: `if (healingMode && actor.id === healTarget!.id && healTarget!.currentHp <= 0) { /* destroyed ships don't act — skip the turn body; still emit turn-started/ended? NO — skip both emissions, document */ continue-equivalent }`. CAREFUL: the focus actor must never be skipped silently in a way that breaks the `focusTurns.length` invariant — when the TARGET IS THE FOCUS HEALER and it dies, a round would have ZERO focus turns and the existing throw at engine.ts:1188 fires. Handle: when the dead-skipped actor is the focus actor, push a synthetic "dead turn" result? NO — cleaner: when focus === target and dead, the round row still needs fields; synthesize a minimal PlayerTurnResult-shaped focus entry `{action:'active', roundCrit:false, enemyHpPct, dotsConfig:[], dotsLanded:true, activeSelfBuffs:[], landedEnemyDebuffs:[], resistedEnemyDebuffs:[], directDamage:0, secondaryDamage:0, conditionalDamage:0, detonationDamage:0, extraActionGrants:[], turnCtx: lastKnown}` and do NOT call sourceFired (it didn't act). Write a dedicated test for "focus healer is the target and dies" locking this.
- [ ] **Step 8.5: Failing integration tests** (healing.test.ts): pressure scenario (1 enemy, attack such that intake > healing → targetHpPct declines round over round; effectiveHeal == raw while deficit exists); shield absorption ordering (pool drains before HP); lethal scenario (`destroyedRound` set; post-death rounds: incomingDamage 0, no heals consumed, raw still counted); spike cadence (walked enemy, charged nuke every 3rd round → incomingDamage pattern [a,a,A,a,a,A…]); empty enemy list degenerates to raw-output (overheal vs full-HP target).
- [ ] **Step 8.6:** Green; full suite + goldens zero churn (no DPS input constructs enemyAttackers).
- [ ] **Step 8.7: Commit** — `git add src/utils/combat && git commit -m "feat: enemy attackers — manual + basics-walk turns, shield-first intake, destroyedRound, dead-target skip"`

---

### Task 9: Triggers — on-ally-critically-repaired, on-ally-crit, reactive heal/shield/cleanse execution

**Files:**
- Modify: `src/types/abilities.ts` (AbilityTrigger union + LIVE_TRIGGERS)
- Modify: `src/utils/combat/triggers.ts` (listener cases; REACTIVE_ABILITY_TYPES; executeIntent heal/shield/cleanse branches; IntentExecContext healing access)
- Modify: `src/utils/combat/engine.ts` (thread healing ctx into executeIntent)
- Modify: `src/components/skills/AbilityCard.tsx` (TRIGGER_OPTIONS + show the Trigger select for heal/shield/cleanse types)
- Modify: `src/utils/abilities/buildShipAbilities.ts` (route the Pallas-pattern texts: "when this unit critically repairs an ally" → cleanse/heal abilities with `on-ally-critically-repaired`; "when an ally critically hits an enemy" → charge/buff abilities get `on-ally-crit` — extend `detectReactiveTrigger` or add a focused detector; read how `detectReactiveTrigger` works FIRST)
- Test: `src/utils/combat/__tests__/healing.test.ts` + `src/utils/abilities/__tests__/buildShipAbilities.test.ts`

- [ ] **Step 9.1: types/abilities.ts** — union gains `'on-ally-critically-repaired' | 'on-ally-crit'` (after `on-ally-crit-dot`); both join LIVE_TRIGGERS.
- [ ] **Step 9.2: Failing listener tests** (hand-rolled bus + enqueue array — the `allyCritDot.test.ts` scaffold pattern):
  - `on-ally-critically-repaired`: owner's own `heal-performed` `{casterId: ownerId, targets:['t1'], critHits:1}` → 1 enqueue; `targets:[ownerId]` only (pure self-heal) → 0; `critHits` absent → 0; another caster → 0.
  - `on-ally-crit`: `ability-performed` `{actorId: otherPlayer, critHits: 2}` → 2 enqueues (per critting hit); own actorId → 0; enemyId → 0; no critHits → 0.
- [ ] **Step 9.3: triggers.ts listener cases:**

```ts
                case 'on-ally-critically-repaired':
                    bus.on('heal-performed', (e) => {
                        // The OWNER's own crit repair of an ALLY (Pallas: "when this unit
                        // critically repairs an ally"): own cast, >= 1 critting draw, and
                        // at least one non-self recipient. One enqueue per qualifying cast.
                        if (
                            e.casterId === ownerId &&
                            (e.critHits ?? 0) >= 1 &&
                            e.targets.some((t) => t !== ownerId)
                        ) {
                            enqueue(intent);
                        }
                    });
                    break;
                case 'on-ally-crit':
                    bus.on('ability-performed', (e) => {
                        // An ALLY's critting hits (mirrors on-crit with ally scoping):
                        // fires once PER CRITTING HIT, own casts and the enemy excluded.
                        if (e.actorId === ownerId || e.actorId === enemyId) return;
                        const n = e.critHits ?? (e.didCrit ? 1 : 0);
                        for (let i = 0; i < n; i++) enqueue(intent);
                    });
                    break;
```

- [ ] **Step 9.4: Executor.** `REACTIVE_ABILITY_TYPES` gains `'heal' | 'shield' | 'cleanse'`. `IntentExecContext` gains `healing?: { /* the SAME HealingRuntimeCtx the player turns use */ }`. In `executeIntent`, after the dot branch:

```ts
    if (cfg.type === 'heal' || cfg.type === 'shield') {
        if (!ctx.healing) return; // healing mode off → not-simulated follow-up
        // Reactive heals NEVER crit (no per-cast draw at drain time — deterministic,
        // documented approximation) and use the OWNER's last-turn ctx stats; before the
        // owner's first turn, fall back to runtime base stats.
        const ownerCtx = ctx.lastTurnCtxByActor.get(intent.ownerId);
        const basisValue =
            cfg.basis === 'attack' ? (ownerCtx?.effectiveAttack ?? owner.attack)
            : cfg.basis === 'defense' ? (ownerCtx?.effectiveDefence ?? owner.defence)
            : cfg.basis === 'target-hp' ? ctx.healing.recipientMaxHp(ctx.healing.targetId)
            : (ownerCtx?.effectiveMaxHp ?? owner.hp);
        const recipients =
            intent.ability.target === 'ally' ? [ctx.healing.targetId]
            : intent.ability.target === 'all-allies' ? ctx.playerIds
            : [intent.ownerId];
        for (const rid of recipients) {
            const raw = basisValue * (cfg.pct / 100) * (1 + owner.healModifier / 100);
            if (cfg.type === 'heal') {
                ctx.healing.credit(intent.ownerId, 'directHeal', raw);
                if (rid === ctx.healing.targetId) {
                    const { consumed, overheal } = ctx.healing.applyHealToTarget(raw);
                    ctx.healing.credit(intent.ownerId, 'effectiveHeal', consumed);
                    ctx.healing.credit(intent.ownerId, 'overheal', overheal);
                }
            } else {
                ctx.healing.credit(intent.ownerId, 'shield', raw);
                if (rid === ctx.healing.targetId) ctx.healing.grantShieldToTarget(raw);
            }
        }
        // NOTE: deliberately NO heal-performed emission from the executor (a reactive
        // heal must not re-trigger heal listeners — chain-guard, mirrors drain-time
        // no-crit-outcome conventions). Document.
        return;
    }
    if (cfg.type === 'cleanse') {
        if (!ctx.healing) return;
        ctx.healing.credit(intent.ownerId, 'cleanseCount', cfg.count);
        return;
    }
```

(Update the trailing "any other type" comment.) Engine threads `healing` into the `executeIntent` context (the drainIntents call site).
- [ ] **Step 9.5: AbilityCard.tsx** — TRIGGER_OPTIONS gains both entries (labels: 'After this unit critically repairs an ally', 'After an ally critically hits'); the Trigger `Select` render condition (line ~616) extends to `'heal' | 'shield' | 'cleanse'` types.
- [ ] **Step 9.6: Parser routing (buildShipAbilities + skillTextParser):** detect the two phrasings (write focused detectors near `parseAllyCritDot`, reusing its clause conventions):
  - `/when this unit critically repairs (an ally|allies)/i` → heal/shield/cleanse abilities parsed FROM THAT SENTENCE get `trigger: 'on-ally-critically-repaired'` (Pallas: the "cleanses 1 debuff from itself" cleanse).
  - `/when an ally critically hits/i` → charge/buff abilities from that sentence get `trigger: 'on-ally-crit'` (Pallas: +1 charge, Everliving Regeneration 3).
  Failing tests with the real Pallas-pattern text (ships.ts:820): assert the cleanse rides `on-ally-critically-repaired`, the charge + Everliving Regeneration buff ride `on-ally-crit`. Valkyrie heal-on-burst: text "When an Echoing Burst explodes … repair 5% of damage dealt" stays UNPARSED (damage-dealt basis — guarded in Task 3); add an allowlist entry note instead. Howler-style other reactive heals follow the same seams when their bases are parseable.
- [ ] **Step 9.7: Integration test:** healing-mode runCombat where the focus healer crit-heals the target (crit 100) and carries a passive reactive cleanse `on-ally-critically-repaired` → cleanseCount increments once per cast; at crit 0 → never.
- [ ] **Step 9.8:** Full suite + goldens zero churn. `npm run audit:skills` clean.
- [ ] **Step 9.9: Commit** — `git add -A src/ scripts/ && git commit -m "feat: on-ally-critically-repaired + on-ally-crit live triggers; reactive heal/shield/cleanse execution"`

---

### Task 10: Public adapter — simulateHealing (replaces healingSimulator.ts)

**Files:**
- Rewrite: `src/utils/calculators/healingSimulator.ts` (wholesale replacement)
- Delete: `src/utils/calculators/healingCalculator.ts` + its test (legacy page-only — verify no other consumers first: `grep -rn "healingCalculator" src/`; the page still imports it until Task 12 — so DELETE in Task 12 instead; this task only rewrites healingSimulator and the OLD page keeps compiling against healingCalculator. CHECK: the old page imports `simulateHealing` from healingSimulator — rewriting its signature breaks the page build. Resolution: rewrite healingSimulator.ts in THIS task AND stub the page's usage by doing Task 12's page replacement in the SAME PR but later — to keep every commit green, this task RENAMES: create `src/utils/calculators/healingEngineAdapter.ts` with the new `simulateHealing`; the legacy `healingSimulator.ts` stays untouched until Task 12 deletes it with the page.)
- Create: `src/utils/calculators/healingEngineAdapter.ts`
- Test: `src/utils/calculators/__tests__/healingEngineAdapter.test.ts`

- [ ] **Step 10.1: Types + adapter** (the spec's shapes, refined):

```ts
import { ShipSkills } from '../../types/abilities';
import { SelectedGameBuff, TeamActorInput } from '../../types/calculator';
import type { ActiveBuff } from '../combat/statusEngine';
import type { CombatEventBus } from '../combat/events';
import { runCombat } from '../combat/engine';

export interface HealerStats {
    hp: number;
    attack: number;
    defence: number;
    crit: number;
    critDamage: number;
    defensePenetration: number;
    healModifier: number;
    hacking: number;
    speed: number;
}

export interface EnemyAttackerInput {
    id: string;
    stats: { attack: number; crit: number; critDamage: number; speed: number };
    chargeCount: number;
    startCharged: boolean;
    shipSkills?: ShipSkills; // basics walk (damage abilities only)
}

export interface HealingSimulationInput {
    healer: HealerStats;
    chargeCount: number;
    startCharged?: boolean;
    shipSkills: ShipSkills;
    selfBuffs: SelectedGameBuff[];
    /** Which player actor the enemies bombard: 'healer' or a team actor id. */
    healTargetId: string;
    teamActors?: TeamActorInput[]; // the target is one of these (or the healer)
    enemies: EnemyAttackerInput[];
    rounds: number;
    bus?: CombatEventBus;
}

export interface HealingRoundData {
    round: number;
    action: 'active' | 'charged';
    charges: number;
    chargeCount: number;
    didCrit: boolean;
    directHeal: number;
    hotHeal: number;
    shield: number;
    cleanseCount: number;
    effectiveHealing: number;
    overheal: number;
    incomingDamage: number;
    shieldAbsorbed: number;
    targetHpPct: number;      // ENTERING the round
    targetShieldPool: number; // ENTERING the round
    totalRoundHealing: number; // directHeal + hotHeal (raw; shield separate)
    cumulativeHealing: number;
    teamHealing?: number;      // non-focus actors' raw healing; only when team actors exist
    activeSelfBuffs: ActiveBuff[];
    extraTurns?: number;
}

export interface HealingSimulationResult {
    rounds: HealingRoundData[];
    summary: {
        totalHealing: number;       // RAW (direct + HoT)
        totalDirectHeal: number;
        totalHotHeal: number;
        totalShield: number;
        totalCleanses: number;
        totalEffectiveHealing: number;
        totalOverheal: number;
        totalShieldAbsorbed: number;
        totalIncomingDamage: number;
        /** RAW healing / rounds — NOT effective (see spec advisory). */
        avgHealingPerRound: number;
        destroyedRound?: number;
        teamTotalHealing?: number;
    };
}
```

`simulateHealing(input)`: mirrors `simulateDPS`'s derivation — internal focus id `'attacker'` (adapter-internal, matching the engine's current internal focus id), `healTargetId: input.healTargetId === 'healer' ? 'attacker' : input.healTargetId`, dummy-enemy defaults `{enemyDefense: 10000, enemyHp: 1_000_000, enemySpeed: 0, security 100}` (player offense is irrelevant to healing output; dummy still takes its turn for DoT ticks), `debuffLandingChance` derived from healer hacking vs security 100 (the standard formula), affinity neutral (`affinityDamageModifier 0, critCap 100, critPenalty 0` — healing ignores affinity this increment, document), team actors resolved exactly like the DPS adapter's walk derivation (reuse/extract the per-team-actor walk mapping from `dpsSimulator.ts:207-229` into a shared helper in dpsSimulator.ts and import it — do NOT duplicate; the helper gains the optional `healModifier` stat passthrough from Task 5), `enemyAttackers: input.enemies`, `hasChargedSkill` via `selectFiringSkill` widening rule. Build per-round `HealingRoundData` by zipping `rounds[i]` (focus cadence/crit/buffs/extraTurns) with `healing.rounds[i]` (per-actor maps + target fields): focus buckets from `perActor.get('attacker')`, `teamHealing` = Σ other entries' `directHeal + hotHeal + shield`? — NO: `teamHealing` = Σ non-focus `directHeal + hotHeal` (raw healing; shield is its own channel and team shield folds into `totalShield`? Keep it simple and DOCUMENTED: `teamHealing` = non-focus direct+HoT raw; summary `teamTotalHealing` likewise; team shield contributes to the target's pool mechanically but is not separately reported this increment).
- [ ] **Step 10.2: Failing adapter tests:** shape test (plain heal cadence: rounds have the right buckets/cumulative); charged-heal cadence (chargeCount 2 → pattern active/active/charged); destroyedRound surfaces; empty enemies valid; healer-as-target works (`healTargetId: 'healer'`).
- [ ] **Step 10.3:** Implement → green. Full suite + goldens untouched.
- [ ] **Step 10.4: Commit** — `git add src/utils/calculators && git commit -m "feat: simulateHealing adapter over the combat engine (healingEngineAdapter)"`

---

### Task 11: Healing golden suite

**Files:**
- Create: `src/utils/calculators/__tests__/healingGoldenParity.test.ts`

- [ ] **Step 11.1:** Mirror `dpsGoldenParity.test.ts`'s structure (read its header comment + fixture conventions FIRST — BASE input, scenario naming, `toMatchSnapshot()` per scenario). Scenarios (each a minimal hand-traceable fixture):
  1. Plain heal cadence (active 10% hp self-heal, healer = target, no enemies).
  2. Charged heal (chargeCount 2, bigger charged heal).
  3. HoT (timed Repair Over Time ability on the target, applier = healer).
  4. Reactive (crit-heal → on-ally-critically-repaired cleanse; crit 50 for schedule coverage).
  5. Team healing (one walked team healer contributing teamHealing).
  6. Pressure (1 manual enemy; intake ≈ 2× healing → declining targetHpPct, full effective).
  7. Lethal pressure (target dies mid-run; destroyedRound + flatline).
  8. Spike (walked enemy, charged 400% nuke every 3rd turn + shield ability on the healer — shield absorption visible).
- [ ] **Step 11.2:** Run once to self-write snapshots, then **HAND-VERIFY** scenarios 1, 6, and 7 round-by-round (trace the heal formula, gate schedules — back-loaded accumulator first-fire rule, shield drain order, death round) and write the trace into the commit message. Spot-check the rest for plausibility (no NaN, monotonic cumulative, overheal+effective == raw on target-routed casts).
- [ ] **Step 11.3:** Confirm DPS goldens byte-identical one more time: `npx vitest run src/utils/calculators/__tests__/dpsGoldenParity.test.ts && git diff --stat -- '*.snap'` shows ONLY the new healing snapshot file.
- [ ] **Step 11.4: Commit** — `git add src/utils/calculators/__tests__ && git commit -m "test: healing golden parity suite (8 scenarios, hand-verified 1/6/7)"`

---

### Task 12: UI — Healing Calculator page rebuild

**Files:**
- Rewrite: `src/pages/calculators/HealingCalculatorPage.tsx`
- Create: `src/components/calculator/HealerShipConfigCard.tsx` (mirror `ShipConfigCard.tsx` — read it first)
- Create: `src/components/calculator/HealTargetPanel.tsx`, `src/components/calculator/EnemyAttackersPanel.tsx` (mirror `EnemySettingsPanel`/`TeamPanel` collapsible patterns)
- Create: `src/components/calculator/HealingTimelineChart.tsx` (BaseChart/Recharts; target HP + shield area + incoming damage/healing bars per round)
- Delete: `src/components/calculator/HealerConfigCard.tsx`, `HealingBubbleChart.tsx`, `HealingComparisonChart.tsx`, `HealingRoundChart.tsx`, `HealingSettingsPanel.tsx`, `src/utils/calculators/healingSimulator.ts`, `src/utils/calculators/healingCalculator.ts`, their tests, `parseSkillHeal` in `skillTextParser.ts` (+ its tests), `HealerConfig`/`HealerConfigUpdateableField`/`HealingBuffTotals` types in `src/types/calculator.ts` (grep each for other consumers FIRST — e.g. `buildSkillBuffAutoFill` usage on the old page is shared with other pages, keep the util)
- Test: page smoke test mirroring whatever exists for DPSCalculatorPage (check `src/__tests__/` and `src/pages/` test conventions — if no DPS page test exists, add a render smoke test for the new page)

Page structure (mirrors DPSCalculatorPage exactly — state shape, memoized sim, card grid):

- Healer config cards (`configs[]`, compare-by-cards like DPS): ship selector (autofill via `calculateTotalStats` + `buildShipAbilities` + `detectFullyCharged` — copy the `shipFinalStats`/`combatStatsFromShip` helpers, extending with `healModifier: Math.round(final.healModifier ?? 0)`), editable stat inputs (hp/attack/defence/crit/critDamage/healModifier/speed/hacking/chargeCount/startCharged), Skill Editor (the existing `SkillEditorModal` — heal abilities are now editable from Task 2), per-card summary StatCards: Effective Healing, Overheal %, Shield Absorbed, Survival ("Survived N rounds" / "Destroyed round N" — plain text + color classes, NO emojis).
- Shared panels: `HealTargetPanel` (ship selector for the target; "Use healer as target" Checkbox → `healTargetId: 'healer'`; target stats display), `EnemyAttackersPanel` (add/remove enemy cards; each card: ship selector (autofills stats + `buildShipAbilities` for the basics walk + shows "damage abilities walked; other abilities not simulated until enemy kits land" note) OR manual `attack/crit/critDamage/speed` Inputs; chargeCount/startCharged when ship-backed), `TeamPanel` reuse if its props fit (it does — same TeamShipConfig shape; the target may simply BE one of the team slots; simplest UX: the target is its own panel and is passed to the engine as an extra team actor with id 'heal-target').
- Shared settings: rounds; healer buffs (GameBuffPicker, as before).
- Charts: `HealingTimelineChart` (centerpiece: target HP% line + shield pool area + per-round incoming damage and healing bars — compare across configs via config selector or single-config display; keep scope minimal: per-config chart inside each card region like DPSRoundChart does, plus one shared cumulative-effective-healing comparison line chart across configs).
- `simResults = useMemo(... simulateHealing({...}) ...)` per config — mirror the DPS memo deps exactly.
- Best-healer highlight by `summary.totalEffectiveHealing`.

- [ ] **Step 12.1:** Build the new components bottom-up with render tests for each (props in → expected labels/values out; follow existing component test patterns in `src/components/calculator/__tests__/` if present, else snapshot-free render assertions).
- [ ] **Step 12.2:** Rewrite the page; delete the legacy files + types + `parseSkillHeal`; fix every dangling import (`npx tsc --noEmit` or the vite build will surface them; also grep `HealingRoundChart|HealerConfig|healingSimulator|healingCalculator|parseSkillHeal`).
- [ ] **Step 12.3:** `npm test && npm run lint` — full green, zero golden churn.
- [ ] **Step 12.4:** Manual visual pass: `npm start` (or reuse the dev server on :3002), open `/healing`, select a healer ship with heal text (e.g. one of the "repairs 30% of its Max HP" supporters), a target, one enemy — verify numbers render and the chart updates. (Full live verification with the user is Task 14.)
- [ ] **Step 12.5: Commit** — `git add -A src/ && git commit -m "feat: rebuild Healing Calculator on the combat engine — heal target, enemy attacker cards, effective healing/overheal/shield timeline"`

---

### Task 13: Docs, changelog, coverage

**Files:**
- Modify: `docs/skill-model-coverage.md` (§5 healing rules block; §6 item 6 closed + heal/shield rows updated; §1 table rows for heal/shield/cleanse — they're now parsed+consumed)
- Modify: `src/constants/changelog.ts` (ONE new evolving healing entry in UNRELEASED_CHANGES)
- Modify: `src/pages/DocumentationPage.tsx` (healing section rewritten: engine model, effective vs raw, shields, enemy cards, determinism)

- [ ] **Step 13.1:** Coverage doc §5 gains the healing rules block: heal formula + channels, separate heal crit gates (rationale), shield additive-pool-capped-at-maxHP (user-verified) + drains-before-HP + no-expiry, HoT applier-HP-at-tick-time + corrosion skip rule, ally-heal→target routing rule, dead-is-dead semantics, reactive-heal no-crit/no-event approximations, enemy basics-walk (team-cadence mirror; non-damage enemy abilities Phase 4). §6: close item 6; note revive/purge/damage-reactive shields stay Phase 4 seams.
- [ ] **Step 13.2:** Changelog: ONE plain-English entry describing the healing calculator rebuild (engine-driven, skill-parsed heals/shields/HoTs, heal target under enemy fire, effective healing vs overheal, shield absorption, survival metric, enemy attacker cards with real skill cadence). Edit in place on later amendments.
- [ ] **13.3:** DocumentationPage: rewrite the healing calculator section to match (check how the DPS section is structured; mirror its tone; include the determinism + formula notes).
- [ ] **Step 13.4:** `npm run audit:skills` final check — 0 unexpected findings. `npm test` green.
- [ ] **Step 13.5: Commit** — `git add src/constants/changelog.ts src/pages/DocumentationPage.tsx && git add -f docs/skill-model-coverage.md && git commit -m "docs: healing-calc rules in coverage doc + changelog + in-app docs"`

---

### Task 14: Full verification, live check, PR

- [ ] **Step 14.1:** `npm test` (full suite) + `npm run lint` — zero failures, zero warnings.
- [ ] **Step 14.2:** Golden inventory vs main: `git diff main --stat -- '*.snap'` — ONLY the new healing snapshots; the 22 DPS snapshots byte-identical.
- [ ] **Step 14.3:** Live verification WITH THE USER on localhost:3002 (212-ship fleet; reuse the running Vite instance; pages with 200+ ships exceed snapshot token limits — use `evaluate_script`; the ship-selector modal's "Search ships" input is INSIDE the modal — the first page text input is the config name; × on ability cards DELETES — close modals with Escape):
  - Select a real healer (a "repairs N% of its Max HP" supporter) → parsed heal abilities visible in the Skill Editor with pct/basis fields.
  - Configure a target + 1-2 enemies (one ship-backed with a charged nuke) → HP timeline shows spike cadence; effective healing + overheal + survival render.
  - **Named checklist items (spec):** shields don't crit and ignore heal modifiers (verify in-game if the user can); shield pool additive capped at max HP, no expiry; HoT ticks scale with the applier's HP.
- [ ] **Step 14.4:** Push, open PR: title `feat: healing calculator on the combat engine — heal target, enemy pressure, effective healing`, body summarizing per the spec + golden-parity proof; standard footer (`🤖 Generated with [Claude Code](https://claude.com/claude-code)`). CodeRabbit flow: triage → fix or skip-with-reason → reply in-thread → wait for re-review (poll `pulls/N/comments`) → merge when clean (merge commit, branch kept).
- [ ] **Step 14.5:** Post-merge: update memory (`project_combat_engine_roadmap.md`) + write the next handoff (Phase 4 enemy offense is next per the roadmap).
