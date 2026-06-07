# Damage-Leech Heals & Shields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The healing calculator simulates heals/shields equal to a % of damage dealt or taken (~14 text cells, ~11 ships: Magnolia, Valerian, Iridium, Opal, Tithonus, Pallas, Valkyrie, Quixilver, FrontLine, Malvex).

**Architecture:** Three mechanisms, no new triggers/events/Intent changes (spec: `docs/superpowers/specs/2026-06-07-damage-leech-design.md` — READ IT FIRST, especially the user decisions and the baseline-correction section): (1) cast-rider `basis: 'damage-dealt'` resolved locally in the player-turn heal block; (2) an engine `creditDamage` wrapper around the existing damage-credit points that procs passive-slot standing leeches immediately; (3) per-attack `damage-taken` procs in the enemy-attack block. All 30 golden snapshots (22 DPS + 8 healing) must stay **byte-identical**.

**Tech Stack:** TypeScript, Vitest, React (one small editor change). No new dependencies.

**Hard rules for every task:**
- Goldens: NEVER `vitest -u`. Regeneration = delete the `.snap` + re-run (only in Task 8, only for NEW scenarios).
- No RegExp lookbehind in `src/` (iOS Safari 15). `scripts/auditSkills.ts` already uses one legitimately (Node-only) — do not copy its patterns into `src/`, do not "fix" it.
- ESLint zero warnings (`npm run lint`). Pre-commit runs the full suite (~2 min) — do not use `--no-verify` for code commits.
- Changelog: ONE evolving healing entry in `UNRELEASED_CHANGES` (`src/constants/changelog.ts`) — **edit the existing healing-calculator entry in place**; never append a second entry.
- `docs/` is gitignored — use `git add -f` for docs files.

---

### Task 0: Branch

- [ ] **Step 1: Create the feature branch**

```bash
cd /Users/kennethsusort/PersonalProjects/starborne-frontiers-calculator
git checkout -b feat/damage-leech
```

---

### Task 1: Config types

**Files:**
- Modify: `src/types/abilities.ts:179-187` (the heal/shield `AbilityConfig` variant)

- [ ] **Step 1: Extend the heal/shield config variant**

Replace the existing variant:

```ts
    | {
          type: 'heal' | 'shield';
          pct: number;
          /** Stat the amount scales from: caster max HP / attack / defence, the
           *  RECIPIENT's max HP ('target-hp' — "of their Max HP"), or a damage-leech
           *  basis: 'damage-dealt' (X% of damage this actor deals — cast rider on
           *  active/charged slots, standing leech on the passive slot) /
           *  'damage-taken' (X% of an enemy attack's damage on this actor; passive
           *  slot, procs only while the actor is the heal target). */
          basis: 'hp' | 'attack' | 'defense' | 'target-hp' | 'damage-dealt' | 'damage-taken';
          /** Pallas/Tithonus: "repair cannot critically hit". Shields never crit regardless. */
          noCrit?: boolean;
          /** Passive-slot 'damage-dealt' only: which credited damage procs the leech.
           *  'all' (default — direct + DoT ticks + detonations, user decision 2026-06-07)
           *  or 'detonation' (Valkyrie: Echoing Burst explosions only). */
          leechScope?: 'all' | 'detonation';
          /** 'damage-taken' only (Quixilver "when taking HP damage and still having
           *  Shield"): proc only when the attack started with shield > 0 AND dealt HP
           *  damage (punched through the pool). Absent → unconditional (Malvex). */
          requiresHpDamage?: boolean;
      }
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS — but `src/components/skills/AbilityCard.tsx:569` has a cast `value as 'hp' | 'attack' | 'defense' | 'target-hp'`; that cast still compiles (it's a narrowing cast into a wider field). If anything else fails, the failure names the file — fix only type-level fallout, no behaviour.

- [ ] **Step 3: Commit**

```bash
git add src/types/abilities.ts && git commit -m "feat: damage-leech basis values on heal/shield ability config"
```

---

### Task 2: Parser — leech basis, verb, scope, split, guard

**Files:**
- Modify: `src/utils/skillTextParser.ts` (`HEAL_DISQUALIFY_RE` ~line 1130, `ParsedHealAbility` ~1088, `resolveHealBasis` ~1149, `parseHealAbilities` ~1200)
- Test: `src/utils/__tests__/skillTextParser.test.ts`

- [ ] **Step 1: Write failing tests** (append a `describe('damage-leech parsing', ...)` block; texts are the stripped CSV phrasings)

```ts
describe('damage-leech parsing', () => {
    it('Iridium rider: repairs 15% of the damage dealt → damage-dealt basis', () => {
        const r = parseHealAbilities(
            'This Unit deals 40% damage with additional damage equal to 9% of its max HP and repairs 15% of the damage dealt.'
        );
        expect(r).toHaveLength(1);
        expect(r[0]).toMatchObject({ kind: 'heal', pct: 15, basis: 'damage-dealt' });
    });

    it('Magnolia standing: repairs itself for 20% of the damage it deals to enemies', () => {
        const r = parseHealAbilities(
            'This Unit repairs itself for 20% of the damage it deals to enemies.'
        );
        expect(r).toHaveLength(1);
        expect(r[0]).toMatchObject({
            kind: 'heal',
            pct: 20,
            basis: 'damage-dealt',
            target: 'self',
            explicitTarget: true,
        });
    });

    it('Tithonus: repairs all allies 7% of the damage dealt → all-allies', () => {
        const r = parseHealAbilities(
            'This Unit deals purges 2 buffs from the enemy and deals 170% damage. Then repairs all allies 7% of the damage dealt. This repair cannot critically hit.'
        );
        expect(r).toHaveLength(1);
        expect(r[0]).toMatchObject({
            kind: 'heal',
            pct: 7,
            basis: 'damage-dealt',
            target: 'all-allies',
        });
    });

    it('Pallas: "heals for 20% of the damage dealt" leech verb → ally', () => {
        const r = parseHealAbilities(
            'This Unit deals 200% damage. The other ally with the lowest current health percentage heals for 20% of the damage dealt and this repair cannot critically hit.'
        );
        expect(r).toHaveLength(1);
        expect(r[0]).toMatchObject({
            kind: 'heal',
            pct: 20,
            basis: 'damage-dealt',
            target: 'ally',
        });
    });

    it('"heals" verb does NOT parse without a leech tail (no general heals-verb parsing)', () => {
        expect(parseHealAbilities('This Unit heals for 20% of its max HP.')).toHaveLength(0);
    });

    it('Valkyrie: dual recipient + Echoing Burst scope → two entries, detonation scope', () => {
        const r = parseHealAbilities(
            'When an Echoing Burst explodes on an enemy, this Unit and the ally with the lowest current health percentage repair 5% of damage dealt.'
        );
        expect(r).toHaveLength(2);
        expect(r[0]).toMatchObject({
            kind: 'heal',
            pct: 5,
            basis: 'damage-dealt',
            target: 'ally',
            leechScope: 'detonation',
        });
        expect(r[1]).toMatchObject({ target: 'self', leechScope: 'detonation' });
    });

    it('Quixilver active: gains Shield equal to 20% of the damage dealt', () => {
        const r = parseHealAbilities(
            'This unit deals 100% damage plus an additional damage equal to 14% of its current Shield, and gains Shield equal to 20% of the damage dealt..'
        );
        expect(r).toHaveLength(1);
        expect(r[0]).toMatchObject({ kind: 'shield', pct: 20, basis: 'damage-dealt' });
    });

    it('Quixilver passive: Shield equal to 25% of the damage taken → damage-taken + requiresHpDamage', () => {
        const r = parseHealAbilities(
            'This Unit gains Shield equal to 25% of the damage taken when taking HP damage and still having Shield.'
        );
        expect(r).toHaveLength(1);
        expect(r[0]).toMatchObject({
            kind: 'shield',
            pct: 25,
            basis: 'damage-taken',
            requiresHpDamage: true,
        });
    });

    it('Malvex: "Damage dealt to them" is damage TAKEN, unconditional', () => {
        const r = parseHealAbilities(
            'When directly damaged as a primary target, this Unit gains Shield equal to 15% of the Damage dealt to them.'
        );
        expect(r).toHaveLength(1);
        expect(r[0]).toMatchObject({ kind: 'shield', pct: 15, basis: 'damage-taken' });
        expect(r[0].requiresHpDamage).toBeUndefined();
    });

    it('FrontLine R4: enemy-action leech shield does NOT parse', () => {
        const r = parseHealAbilities(
            'When an enemy uses their Charged skill, it deals 80% and gains a Shield equal to 30% of the damage dealt, once per round.'
        );
        expect(r).toHaveLength(0);
    });

    it('revive/Cheat Death still disqualified', () => {
        expect(parseHealAbilities('This Unit revives with 50% HP.')).toHaveLength(0);
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/utils/__tests__/skillTextParser.test.ts -t 'damage-leech parsing'`
Expected: FAIL — current guard suppresses all leech matches (entries length 0), and `ParsedHealAbility` lacks the new fields (TS errors are also "failure").

- [ ] **Step 3: Implement**

In `src/utils/skillTextParser.ts`:

(a) `ParsedHealAbility` — extend:

```ts
export interface ParsedHealAbility {
    kind: 'heal' | 'shield';
    pct: number;
    basis: 'hp' | 'attack' | 'defense' | 'target-hp' | 'damage-dealt' | 'damage-taken';
    target: 'self' | 'ally' | 'all-allies';
    explicitTarget: boolean; // (keep existing comment)
    /** Valkyrie: leech scoped to Echoing Burst explosions (detonation credits only). */
    leechScope?: 'all' | 'detonation';
    /** Quixilver: damage-taken proc gated on shield punch-through. */
    requiresHpDamage?: boolean;
}
```

(b) `HEAL_DISQUALIFY_RE` — lift the leech phrases, keep revive/Cheat Death, add the enemy-action disqualifier (FrontLine R4):

```ts
// Phase-4 / reactive disqualifiers — clause-scoped. Damage-leech phrases ("of the
// damage taken/dealt") are now PARSED (basis 'damage-dealt'/'damage-taken'); only
// revive content and enemy-action reactions ("when an enemy uses ...") stay out.
const HEAL_DISQUALIFY_RE = /\brevives?\b|\bcheat death\b|when an enemy uses/i;
```

(c) New leech-basis resolver, checked BEFORE `resolveHealBasis` (order matters — Malvex's "Damage dealt to them" must hit the taken-pattern before the generic dealt-pattern):

```ts
// Leech basis from the sentence tail after the match. ORDER MATTERS: "damage dealt
// to them/this unit" (Malvex) is damage TAKEN and must be tested before the generic
// damage-dealt phrasing. No lookbehind (iOS Safari 15).
function resolveLeechBasis(after: string): 'damage-dealt' | 'damage-taken' | undefined {
    if (/of\s+the\s+damage\s+taken|damage\s+dealt\s+to\s+(?:them|this\s+unit)/i.test(after)) {
        return 'damage-taken';
    }
    if (/of\s+(?:the\s+)?damage\s+(?:dealt|it\s+deals)/i.test(after)) return 'damage-dealt';
    return undefined;
}
```

(d) Pallas leech-verb regex (module scope, next to `HEAL_REPAIR_RE`) — matches ONLY with a leech tail, so there is no general "heals" parsing:

```ts
// Pallas: "heals for 20% of the damage dealt" — the 'heals' verb is parsed ONLY when
// followed by a leech tail (no general heals-verb support; avoids false positives).
const LEECH_HEAL_VERB_RE = /\bheals?\s+for\s+(\d+(?:\.\d+)?)\s*%\s*of\s+(?:the\s+)?damage\s+dealt/gi;
```

(e) In `parseHealAbilities`'s `emit` closure: after `const basisScope = sentence.slice(m.index - sentenceStart);` compute the leech basis and extras, and emit the Valkyrie dual entry:

```ts
const leechBasis = resolveLeechBasis(basisScope);
const basis = leechBasis ?? resolveHealBasis(basisScope);
const { target, explicit: explicitTarget } = resolveHealTarget(sentence);
const leechScope: ParsedHealAbility['leechScope'] =
    leechBasis === 'damage-dealt' && /echoing\s+burst\s+explodes/i.test(sentence)
        ? 'detonation'
        : undefined;
const requiresHpDamage =
    leechBasis === 'damage-taken' &&
    /when\s+taking\s+hp\s+damage\s+and\s+still\s+having\s+shield/i.test(sentence)
        ? true
        : undefined;
results.push({
    kind, pct, basis, target, explicitTarget,
    ...(leechScope ? { leechScope } : {}),
    ...(requiresHpDamage ? { requiresHpDamage } : {}),
});
// Valkyrie: "this Unit and the ally with the lowest ..." — dual recipient → emit a
// second SELF entry mirroring the first (5% each, same basis/scope).
if (leechBasis && /\bthis\s+unit\s+and\s+the\s+ally\b/i.test(sentence)) {
    results.push({
        kind, pct, basis, target: 'self', explicitTarget: true,
        ...(leechScope ? { leechScope } : {}),
    });
}
```

NOTE: the existing `if (kind === 'heal' && /equal\s+to/i.test(m[0])) continue;` skip (continuation handling) fires on matches whose own text contains "equal to". `HEAL_SHIELD_RE` matches ("Shield equal to N%") are `kind === 'shield'` — unaffected. The Iridium/Opal repair matches ("repairs 15% of the damage dealt") contain no "equal to" — unaffected.

(f) Register the new verb regex at the bottom of `parseHealAbilities`:

```ts
emit('heal', HEAL_REPAIR_RE);
emit('heal', LEECH_HEAL_VERB_RE);
emit('shield', HEAL_SHIELD_RE);
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/utils/__tests__/skillTextParser.test.ts`
Expected: new block PASS, **all pre-existing tests PASS** (regressions here mean the guard lift leaked — fix before proceeding).

- [ ] **Step 5: Commit**

```bash
git add src/utils/skillTextParser.ts src/utils/__tests__/skillTextParser.test.ts
git commit -m "feat: parse damage-leech heal/shield bases (dealt/taken, scope, dual recipient)"
```

---

### Task 3: buildShipAbilities — thread leech fields onto configs

**Files:**
- Modify: `src/utils/abilities/buildShipAbilities.ts` (heal emission loop, ~lines 830-876)
- Test: `src/utils/abilities/__tests__/buildShipAbilities.test.ts`

- [ ] **Step 1: Write failing ship-level fixture tests** (append a `describe('damage-leech ships', ...)`; use the test file's existing `ship({...})` fixture helper — see the Cultivator/Morao block at line ~1285 for the pattern)

One test per spec shape. Key assertions (write all of these):

```ts
// Magnolia (passive standing leech, default scope):
//   ship({ firstPassiveSkillText: 'This Unit <unit-damage>repairs itself for 20%</unit-damage> of the damage it deals to enemies.' })
//   → passive slot heal: { target: 'self', config: { type: 'heal', pct: 20, basis: 'damage-dealt', leechScope: 'all' } }
// Valerian (passive, explicit DoT-inclusive text parses identically — scope 'all'):
//   'This Unit <unit-damage>repairs 15%</unit-damage> of Damage dealt to the enemy, including inflcted Damage over Time effects.'
//   → { target: 'self', config: { pct: 15, basis: 'damage-dealt', leechScope: 'all' } }
//   NOTE the CSV's misspelling "inflcted" — copy the text verbatim.
//   AND: "Damage dealt to the enemy" must resolve damage-DEALT (the taken-pattern is
//   'dealt to (them|this unit)' only — '...to the enemy' must not match it).
// Iridium (active rider): active slot heal { target: 'self', config: { pct: 15, basis: 'damage-dealt' } }, NO leechScope.
// Tithonus (active, all-allies + noCrit from the following sentence — parseHealNoCrit is
//   skill-wide and already returns true): { target: 'all-allies', config: { pct: 7, basis: 'damage-dealt', noCrit: true } }
// Pallas active ('heals for' verb): { target: 'ally', config: { pct: 20, basis: 'damage-dealt', noCrit: true } }
// Valkyrie passive: TWO heal abilities, both { config: { pct: 5, basis: 'damage-dealt', leechScope: 'detonation' } },
//   one target 'ally' + one target 'self'.
// Quixilver active: shield { target: 'self', config: { pct: 20, basis: 'damage-dealt' } } —
//   shields are never target-flipped (existing rule).
// Quixilver passive: shield { config: { pct: 25, basis: 'damage-taken', requiresHpDamage: true } }.
// Malvex passive: shield { config: { pct: 15, basis: 'damage-taken' } }, requiresHpDamage undefined.
// FrontLine active: shield { config: { pct: 30, basis: 'damage-dealt' } }; R4 passive text
//   ('When an enemy uses their Charged skill ... Shield equal to 30% of the damage dealt, once per round')
//   produces NO damage-taken/damage-dealt shield from that sentence (the start-of-combat
//   25%-Max-HP shield in the same passive still parses — basis 'hp').
// Regression: Meatshield self-damage carve-out, Hermes bare-active flip, Cultivator/Morao
//   recipient rules — covered by existing tests; just run the whole file.
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/utils/abilities/__tests__/buildShipAbilities.test.ts -t 'damage-leech ships'`
Expected: FAIL — configs lack `leechScope`/`requiresHpDamage` (and before Task 2 the heals wouldn't parse at all).

- [ ] **Step 3: Implement** — in the heal emission loop (~line 859-875), thread the new fields:

```ts
out.push({
    ability: {
        id: nextId(),
        type: h.kind,
        target: healTarget,
        trigger: reactiveTrigger ?? 'on-cast',
        conditions: [],
        config: {
            type: h.kind,
            pct: h.pct,
            basis: h.basis,
            ...(h.kind === 'heal' && healNoCrit ? { noCrit: true } : {}),
            // Standing leech (passive-slot damage-dealt): default scope 'all'
            // (user decision: direct + DoT ticks + detonations). Cast riders
            // (active/charged) carry no scope.
            ...(h.basis === 'damage-dealt' && slot === 'passive'
                ? { leechScope: h.leechScope ?? 'all' }
                : {}),
            ...(h.requiresHpDamage ? { requiresHpDamage: true } : {}),
        },
        autoFilled: true,
    },
    pos: healTagPos >= 0 ? healTagPos : fallbackPos >= 0 ? fallbackPos : MAX_POS,
});
```

`flipBareSupportTarget` needs NO change — verify with the fixtures: leech riders on damage skills have `hasDamage=true` → stay self; Magnolia/Valerian are explicit/passive-bare without ally-damage/cleanse triggers → stay self; shields never flip.

- [ ] **Step 4: Run the full file**

Run: `npx vitest run src/utils/abilities/__tests__/buildShipAbilities.test.ts`
Expected: PASS including all pre-existing tests.

- [ ] **Step 5: Commit**

```bash
git add src/utils/abilities/buildShipAbilities.ts src/utils/abilities/__tests__/buildShipAbilities.test.ts
git commit -m "feat: build leech heal/shield abilities (scope, punch-through flag, ship fixtures)"
```

---

### Task 4: Cast riders in the player-turn heal block

**Files:**
- Modify: `src/utils/combat/playerTurn.ts` (heal block ~lines 1285-1448: `basisValue` ~1302, `healAbilities` assembly ~1387)
- Test: `src/utils/combat/__tests__/healing.test.ts` (follow the file's existing fixture style)

- [ ] **Step 1: Write failing tests**

```ts
// 1. Active-slot heal { basis: 'damage-dealt', pct: 10 } on a healer whose active also
//    carries a damage ability: directHeal === thisTurnDirectDamage × 0.10 (crit 0,
//    healModifier 0 → no folds). Derive the expected direct damage from the fixture
//    exactly as healing.test.ts already does for damage-carrying casts.
// 2. Same with healModifier 50 → × 1.5 fold applies.
// 3. Shield rider { type: 'shield', basis: 'damage-dealt', pct: 20 } → shield bucket
//    === direct × 0.20, NO folds.
// 4. PASSIVE-slot { basis: 'damage-dealt' } heal → the heal block produces NOTHING for
//    it (no directHeal credit from the cast path — it belongs to the engine hook,
//    Task 6; until then the fixture simply shows zero).
// 5. Any-slot { basis: 'damage-taken' } heal/shield → heal block produces nothing.
// 6. noCrit: false leech heal with crit 100 → crit fold applies on the heal draw
//    (raw × (1 + critDamage/100)); with noCrit: true it does not.
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/utils/combat/__tests__/healing.test.ts -t 'damage-dealt'`
Expected: FAIL — `basisValue` has no damage-dealt case (falls to `hp` default → wrong numbers).

- [ ] **Step 3: Implement**

(a) `basisValue` (~1302) — the local `directDamage` const (playerTurn.ts:1177, already includes secondary/conditional folds and the passive hit; excludes detonation per spec):

```ts
const basisValue = (
    basis: 'hp' | 'attack' | 'defense' | 'target-hp' | 'damage-dealt' | 'damage-taken',
    rid: string
): number => {
    switch (basis) {
        case 'attack':
            return effectiveAttack;
        case 'defense':
            return effectiveDefence;
        case 'target-hp':
            return healing.recipientMaxHp(rid);
        // Cast rider (active/charged 'damage-dealt'): this turn's own cast damage —
        // the local directDamage (incl. secondary/conditional sub-buckets and the
        // passive hit; detonation excluded by spec). 'damage-taken' never reaches
        // here (filtered below).
        case 'damage-dealt':
            return directDamage;
        case 'hp':
        default:
            return effectiveHp;
    }
};
```

(b) Heal-abilities assembly (~1387) — partition by origin and skip the hook-owned shapes:

```ts
// Slot partition (damage-leech): passive-slot 'damage-dealt' abilities are standing
// leeches owned by the ENGINE's credit hook (engine.ts) — processing them here would
// double-count the cast's direct portion. 'damage-taken' abilities (any slot) are
// owned by the enemy-attack block. Both are skipped on the cast path.
const isHookOwned = (a: Ability, fromPassive: boolean): boolean => {
    const c = a.config;
    if (c.type !== 'heal' && c.type !== 'shield') return false;
    if (c.basis === 'damage-taken') return true;
    return c.basis === 'damage-dealt' && fromPassive;
};
const healAbilities = [
    ...(gatedSkill?.abilities ?? []).filter((a) => !isHookOwned(a, false)),
    ...(gatedPassive?.abilities ?? []).filter((a) => !isHookOwned(a, true)),
];
```

- [ ] **Step 4: Run the combat suites + BOTH golden suites**

Run: `npx vitest run src/utils/combat/ src/utils/calculators/__tests__/dpsGoldenParity.test.ts src/utils/calculators/__tests__/healingGoldenParity.test.ts`
Expected: ALL PASS, zero snapshot diffs (no existing fixture uses leech bases yet).

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/playerTurn.ts src/utils/combat/__tests__/healing.test.ts
git commit -m "feat: cast-rider damage-dealt basis in the player-turn heal block"
```

---

### Task 5: Engine `creditDamage` wrapper (pure refactor — goldens are the referee)

**Files:**
- Modify: `src/utils/combat/engine.ts` (credit points: focus fold ~1281-1285, team fold ~1330-1334, `tickDoTs` credit callback ~1423-1441, `processBombs` ~1447-1460, `processAccumulators` ~1465-1475)

- [ ] **Step 1: Implement the wrapper** (next to the `dmg` helper, ~line 1026)

```ts
/** Damage-credit channels the standing-leech hook distinguishes (Task 6). */
type LeechChannel = 'direct' | 'detonation' | 'corrosion' | 'inferno';
// Single damage-credit point: every channel write flows through here so standing
// leeches (damage-leech spec) can proc at credit time. With no leeches registered
// this is byte-identical to the bare dmg() writes (the goldens are the referee).
const creditDamage = (sourceId: string, channel: LeechChannel, amount: number): void => {
    dmg(sourceId)[channel] += amount;
    // procStandingLeeches(sourceId, channel, amount);  // ← added in Task 6
};
```

IMPORTANT: do NOT gate the `dmg()` write on `amount > 0` — the focus fold currently calls `dmg(actor.id)` unconditionally, which lazily CREATES the actor's entry; skipping zero writes would drop zero-damage actors from `roundDamage` and churn goldens.

(b) Focus fold (~1281): keep the sub-bucket writes inline (they are informational sub-buckets of direct — crediting them through the hook would double-proc):

```ts
const d = dmg(actor.id);
d.secondary += turn.secondaryDamage;
d.conditional += turn.conditionalDamage;
creditDamage(actor.id, 'direct', turn.directDamage);
creditDamage(actor.id, 'detonation', turn.detonationDamage);
```

(c) Team fold (~1330): same shape.

(d) `tickDoTs` call site credit callback: `credit: (sourceId, dotType, damage) => creditDamage(sourceId, dotType, damage)`.

(e) `processBombs` call site: `creditDetonation: (sourceId, damage) => creditDamage(sourceId, 'detonation', damage)`. Same for `processAccumulators`.

- [ ] **Step 2: Run BOTH golden suites + full combat tests**

Run: `npx vitest run src/utils/combat/ src/utils/calculators/`
Expected: ALL PASS, **zero snapshot diffs**. Any diff = the refactor is not pure — fix it, do not regenerate.

- [ ] **Step 3: Commit**

```bash
git add src/utils/combat/engine.ts
git commit -m "refactor: route all damage credits through creditDamage (leech hook seam)"
```

---

### Task 6: Standing-leech hook (groups B + C)

**Files:**
- Modify: `src/utils/combat/engine.ts` (setup scan + `procStandingLeeches` + enable the call in `creditDamage`)
- Test: Create `src/utils/combat/__tests__/leech.test.ts`

- [ ] **Step 1: Write failing tests** (drive through `runCombat` in healing mode, mirroring fixtures in `healing.test.ts` / `engine.events.test.ts`; healer with a passive-slot leech + a damage-dealing active)

```ts
// 1. Standing heal scope 'all': passive { type:'heal', pct:20, basis:'damage-dealt',
//    leechScope:'all' }, active deals D direct → after round 1 the actor's directHeal
//    includes D × 0.20 (crit 0, healModifier 0).
// 2. DoT-tick leech: active applies corrosion; round 2's enemy-turn tick T credits the
//    owner → directHeal grows by T × 0.20 at tick time (assert via round-2 buckets).
// 3. Detonation scope (Valkyrie shape): leechScope 'detonation' + an
//    accumulate-detonate ability → NO leech on direct damage rounds; on the burst
//    round, leech = burstDamage × pct/100. Two-entry parse shape: ally entry routes to
//    the heal target, self entry to the owner.
// 4. noCrit respected; crit draw applies otherwise: owner crit 100, critDamage 100 →
//    leech heal doubles (runtime base stats, activeHealCritGate).
// 5. Shield-kind standing leech: credits 'shield' bucket, no folds, granted to the
//    pool only when the owner IS the heal target.
// 6. healModifier folds into heal-kind: healModifier 50 → × 1.5.
// 7. DPS mode (no healTargetId): same fixture → zero healing output, identical damage
//    results to a no-leech run (inertness).
// 8. all-allies recipient: directHeal credited once per recipient (playerIds order).
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/utils/combat/__tests__/leech.test.ts`
Expected: FAIL — no leech procs yet (heal buckets miss the leech amounts).

- [ ] **Step 3: Implement**

(a) Setup scan — engine setup, after the player runtimes map (the same `Map<string, PlayerActorRuntime>` handed to `IntentExecContext.runtimes`) and `healTarget` exist; healing mode only:

```ts
/** Passive-slot standing leeches per owner (damage-leech spec §4). Slot/text order. */
interface StandingLeech {
    kind: 'heal' | 'shield';
    pct: number;
    target: Ability['target'];
    noCrit: boolean;
    scope: 'all' | 'detonation';
}
const standingLeeches = new Map<string, StandingLeech[]>();
if (healTarget) {
    for (const [ownerId, rt] of runtimesById) {
        const entries: StandingLeech[] = [];
        for (const slot of rt.castSkills.slots) {
            if (slot.slot !== 'passive') continue;
            for (const a of slot.abilities) {
                const c = a.config;
                if ((c.type === 'heal' || c.type === 'shield') && c.basis === 'damage-dealt') {
                    entries.push({
                        kind: c.type,
                        pct: c.pct,
                        target: a.target,
                        noCrit: c.type === 'heal' ? (c.noCrit ?? false) : true,
                        scope: c.leechScope ?? 'all',
                    });
                }
            }
        }
        if (entries.length > 0) standingLeeches.set(ownerId, entries);
    }
}
```

(b) `procStandingLeeches` (engine closure; healing mode only):

```ts
// Proc an owner's standing leeches against a damage credit (heals immediately at
// credit time — a DoT-tick leech lands during the enemy turn). Simplified drain-style
// fold (spec §4): healModifier only + a deterministic heal-crit draw on the owner's
// activeHealCritGate at the RUNTIME's standing crit/critDamage (base+gear stats — the
// per-turn folded effectiveCrit only exists mid-turn). NO heal-performed emission
// (chain guard: leech procs never feed on-ally-critically-repaired).
const procStandingLeeches = (sourceId: string, channel: LeechChannel, amount: number): void => {
    if (!healingCtx || amount <= 0) return;
    const entries = standingLeeches.get(sourceId);
    if (!entries) return;
    const owner = runtimesById.get(sourceId);
    if (!owner) return;
    for (const e of entries) {
        if (e.scope === 'detonation' && channel !== 'detonation') continue;
        let raw = amount * (e.pct / 100);
        if (e.kind === 'heal') {
            raw *= 1 + owner.healModifier / 100;
            if (!e.noCrit && owner.activeHealCritGate(owner.crit / 100)) {
                raw *= 1 + owner.critDamage / 100;
            }
        }
        const recipients =
            e.target === 'ally'
                ? [healTarget!.id]
                : e.target === 'all-allies'
                  ? healingCtx.playerIds
                  : [sourceId];
        for (const rid of recipients) {
            if (e.kind === 'heal') {
                healingCtx.credit(sourceId, 'directHeal', raw);
                if (rid === healTarget!.id) {
                    const { consumed, overheal } = healingCtx.applyHealToTarget(raw);
                    healingCtx.credit(sourceId, 'effectiveHeal', consumed);
                    healingCtx.credit(sourceId, 'overheal', overheal);
                }
            } else {
                healingCtx.credit(sourceId, 'shield', raw);
                if (rid === healTarget!.id) healingCtx.grantShieldToTarget(raw);
            }
        }
    }
};
```

(Use the engine's actual local names for `healingCtx`/`healTarget`/`runtimes` — discover with grep; the healing ctx variable is `healingCtx` per `engine.ts:1323`.)

(c) Enable the call in `creditDamage` (uncomment the Task-5 line).

(d) Watch declaration order: `creditDamage` references `procStandingLeeches` — define both before the round loop, after `runtimes`/`healingCtx`/`healTarget` exist (or declare `procStandingLeeches` as a `function` for hoisting).

- [ ] **Step 4: Run tests + goldens**

Run: `npx vitest run src/utils/combat/ src/utils/calculators/`
Expected: leech.test.ts PASS; zero snapshot diffs (no existing fixture has passive damage-dealt abilities).

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/engine.ts src/utils/combat/__tests__/leech.test.ts
git commit -m "feat: standing-leech credit hook (Magnolia/Valerian/Valkyrie shapes)"
```

---

### Task 7: Damage-taken procs (group D)

**Files:**
- Modify: `src/utils/combat/engine.ts` (enemy-attacker branch, ~lines 1476-1513)
- Test: `src/utils/combat/__tests__/leech.test.ts` (extend)

- [ ] **Step 1: Write failing tests**

```ts
// 1. Malvex shape: heal target with passive { type:'shield', pct:15, basis:'damage-taken' },
//    one enemy attacker dealing damage D per attack → after the attack,
//    target.shield bucket grows by D × 0.15 and the pool increases (visible as
//    shieldAbsorbed on the NEXT attack).
// 2. Quixilver gate, no-shield case: { pct:25, basis:'damage-taken', requiresHpDamage:true }
//    with NO shield at attack start → no proc.
// 3. Quixilver gate, punch-through: pre-grant a small shield (e.g. via an active-slot
//    shield ability) so the attack drains it AND deals HP damage → proc fires:
//    shield += D × 0.25 (D = full attack damage, not just the HP portion — spec §5).
// 4. Quixilver gate, fully-absorbed case: shield large enough to absorb the whole
//    attack → hpDamage 0 → no proc.
// 5. Procs apply AFTER the attack's drain: the granting attack itself gets no
//    absorption from its own proc.
// 6. Dead target: killed by the attack → grantShieldToTarget no-ops (existing
//    semantics); no crash.
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/utils/combat/__tests__/leech.test.ts -t 'damage-taken'`
Expected: FAIL — no procs.

- [ ] **Step 3: Implement**

(a) Setup scan (next to the standing-leech scan; the HEAL TARGET's runtime only — enemy attacks only ever hit the heal target):

```ts
/** The heal target's passive damage-taken abilities (damage-leech spec §5). */
interface TakenLeech {
    kind: 'heal' | 'shield';
    pct: number;
    noCrit: boolean;
    requiresHpDamage: boolean;
}
const takenLeeches: TakenLeech[] = [];
if (healTarget) {
    const rt = runtimesById.get(healTarget.id);
    if (rt) {
        for (const slot of rt.castSkills.slots) {
            if (slot.slot !== 'passive') continue;
            for (const a of slot.abilities) {
                const c = a.config;
                if ((c.type === 'heal' || c.type === 'shield') && c.basis === 'damage-taken') {
                    takenLeeches.push({
                        kind: c.type,
                        pct: c.pct,
                        noCrit: c.type === 'heal' ? (c.noCrit ?? false) : true,
                        requiresHpDamage: c.requiresHpDamage ?? false,
                    });
                }
            }
        }
    }
}
```

(b) In the enemy-attacker branch (`engine.ts` ~1496), capture the pre-drain pool and proc after the drain + destroyed handling:

```ts
if (damage > 0) {
    roundIncomingDamage += damage;
    const shieldBefore = healTarget!.shieldPool;          // ← NEW capture
    const absorbed = Math.min(healTarget!.shieldPool, damage);
    // ... existing drain + destroyed handling unchanged ...

    // Damage-taken procs (per ATTACK, on the aggregate — spec §5): applied AFTER
    // this attack's drain (the proc never absorbs its own trigger). Quixilver's
    // punch-through gate: shield at attack start AND HP damage dealt.
    if (takenLeeches.length > 0 && healingCtx) {
        const hpDamage = damage - absorbed;
        const rt = runtimesById.get(healTarget!.id);
        for (const e of takenLeeches) {
            if (e.requiresHpDamage && !(shieldBefore > 0 && hpDamage > 0)) continue;
            let raw = damage * (e.pct / 100);
            if (e.kind === 'heal' && rt) {
                raw *= 1 + rt.healModifier / 100;
                if (!e.noCrit && rt.activeHealCritGate(rt.crit / 100)) {
                    raw *= 1 + rt.critDamage / 100;
                }
            }
            if (e.kind === 'heal') {
                healingCtx.credit(healTarget!.id, 'directHeal', raw);
                const { consumed, overheal } = healingCtx.applyHealToTarget(raw);
                healingCtx.credit(healTarget!.id, 'effectiveHeal', consumed);
                healingCtx.credit(healTarget!.id, 'overheal', overheal);
            } else {
                healingCtx.credit(healTarget!.id, 'shield', raw);
                healingCtx.grantShieldToTarget(raw);
            }
        }
    }
}
```

- [ ] **Step 4: Run tests + goldens**

Run: `npx vitest run src/utils/combat/ src/utils/calculators/`
Expected: ALL PASS, zero snapshot diffs.

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/engine.ts src/utils/combat/__tests__/leech.test.ts
git commit -m "feat: per-attack damage-taken shield/heal procs (Quixilver/Malvex shapes)"
```

---

### Task 8: New healing golden scenarios

**Files:**
- Modify: `src/utils/calculators/__tests__/healingGoldenParity.test.ts`
- Snapshot: `src/utils/calculators/__tests__/__snapshots__/healingGoldenParity.test.ts.snap` (grows — existing entries MUST NOT change)

- [ ] **Step 1: Add scenarios** (follow the file's `BASE`/`ab`/`healSkills` fixture conventions; keep stats hand-traceable — crit 0 except where the scenario tests crits)

```ts
// Scenario 9  — Magnolia shape: passive standing leech 20% scope 'all' + active damage
//               + inferno application; trace rounds 1-3 BY HAND in a comment (cast
//               leech at fold time, tick leech at enemy turn).
// Scenario 10 — Tithonus/Pallas shape: active damage + all-allies 7% noCrit rider, a
//               team actor present (recipient routing), healer ≠ target.
// Scenario 11 — Valkyrie shape: accumulate-detonate + two detonation-scope leech
//               entries (ally + self); burst round leech only.
// Scenario 12 — Quixilver as heal target: active shield rider 20% + taken passive 25%
//               requiresHpDamage + one enemy attacker; covers punch-through + the
//               rider/taken interplay; trace BY HAND.
```

- [ ] **Step 2: Run the suite — new snapshots write, existing ones untouched**

Run: `npx vitest run src/utils/calculators/__tests__/healingGoldenParity.test.ts`
Expected: PASS with `4 written` (new), zero `updated`.

- [ ] **Step 3: Hand-verify** the Magnolia and Quixilver snapshot numbers against the comment traces (re-derive every bucket for rounds 1-2; document the trace in the test comment — referee discipline).

- [ ] **Step 4: Full-suite sanity + commit**

```bash
npx vitest run
git add src/utils/calculators/__tests__/
git commit -m "test: damage-leech healing golden scenarios (hand-verified)"
```

---

### Task 9: Skill Editor fields

**Files:**
- Modify: `src/components/skills/AbilityCard.tsx` (`HEAL_BASIS_OPTIONS` ~line 93, heal/shield case ~547-584)
- Test: `src/components/skills/__tests__/AbilityCard.test.tsx`

- [ ] **Step 1: Write failing tests** (existing file's render conventions)

```ts
// 1. heal config { basis: 'damage-dealt' } renders the basis select with value
//    'damage-dealt' AND a scope select ('All damage' / 'Detonations only').
// 2. Changing scope to 'Detonations only' calls onChange with leechScope 'detonation';
//    'All damage' yields leechScope 'all'.
// 3. shield config { basis: 'damage-taken' } renders the punch-through checkbox;
//    toggling sets/clears requiresHpDamage (cleared → undefined, not false).
// 4. basis 'hp' renders neither extra control.
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/skills/__tests__/AbilityCard.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

(a) Options:

```ts
const HEAL_BASIS_OPTIONS = [
    /* existing four options … */
    { value: 'damage-dealt', label: 'Damage dealt' },
    { value: 'damage-taken', label: 'Damage taken' },
];
const LEECH_SCOPE_OPTIONS = [
    { value: 'all', label: 'All damage' },
    { value: 'detonation', label: 'Detonations only' },
];
```

(b) In the heal/shield case: widen the basis `onChange` cast to the full union; add below the basis select:

```tsx
{config.basis === 'damage-dealt' && (
    <Select
        label="Leech scope"
        value={config.leechScope ?? 'all'}
        options={LEECH_SCOPE_OPTIONS}
        onChange={(value) =>
            updateConfig({ ...config, leechScope: value as 'all' | 'detonation' })
        }
    />
)}
{config.basis === 'damage-taken' && (
    <Checkbox
        label="Only when damage punches through shield"
        checked={config.requiresHpDamage ?? false}
        onChange={(checked) =>
            updateConfig({ ...config, requiresHpDamage: checked ? true : undefined })
        }
    />
)}
```

(Existing `Select`/`Checkbox` UI components only — no new primitives, per CLAUDE.md.)

- [ ] **Step 4: Run tests, then commit**

Run: `npx vitest run src/components/skills/`
Expected: PASS.

```bash
git add src/components/skills/
git commit -m "feat: leech basis/scope/punch-through fields in the skill editor"
```

---

### Task 10: Parser-coverage audit sweep

**Files:**
- Possibly modify: `scripts/auditSkills.allowlist.ts`
- Regenerates: `docs/skill-audit.md` (gitignored)

- [ ] **Step 1: Run the audit**

Run: `npm run audit:skills`
Expected: the leech ships (Magnolia, Valerian, Iridium, Opal, Tithonus, Pallas, Valkyrie, Quixilver, FrontLine, Malvex) no longer appear as heal/shield coverage gaps. The audit imports `buildShipAbilities` directly, so Task 2/3 changes flow automatically.

- [ ] **Step 2: Clean stale allowlist entries** — grep `scripts/auditSkills.allowlist.ts` for those ship names; remove entries whose reason was the unparsed leech (keep unrelated entries, e.g. Valkyrie's burst-reference allowlist from PR #86 if it covers a DIFFERENT rule — read each entry's rule id before touching it).

- [ ] **Step 3: Re-run audit + full parser tests, then commit (if allowlist changed)**

```bash
npm run audit:skills && npx vitest run src/utils/__tests__/ src/utils/abilities/
git add scripts/auditSkills.allowlist.ts
git commit -m "chore: drop stale leech allowlist entries after parser coverage"
```

---

### Task 11: Docs, changelog, handoff correction

**Files:**
- Modify: `docs/skill-model-coverage.md` (§5 rules, §6 verify list + counts)
- Modify: `src/pages/DocumentationPage.tsx` (healing-calc section)
- Modify: `src/constants/changelog.ts` (`UNRELEASED_CHANGES` — FOLD into the existing healing entry)
- Modify: `docs/superpowers/handoffs/2026-06-07-damage-leech-handoff.md`

- [ ] **Step 1: Coverage doc** — §5 adds the game-verified/user-decided leech rules: leech repairs draw heal crits unless "cannot critically hit"; standing leech = direct + DoT ticks + detonations; damage-taken procs are per-attack on the aggregate; leech procs emit no heal-performed (chain guard); Malvex "dealt to them" = taken; cast-rider basis = the cast's direct total (detonation excluded). §6 verify list adds: Magnolia DoT-tick leech, Quixilver punch-through reading, per-attack (vs per-hit) approximation. Update the §-header coverage counts.

- [ ] **Step 2: Handoff correction** — in the handoff's "What shipped in PR #87" section, fix the overstatement (per the spec's baseline-correction section): no `damage-taken` event, no `on-ally-damaged`/`on-self-damaged` triggers, no `onCritHit`; 8 live triggers at PR #87 (not 11); Cultivator/Isha repairs are on-cast per-turn passive heals. Add a line noting this increment shipped leech via credit-point hooks instead.

- [ ] **Step 3: In-app docs + changelog** — add a leech sentence to the DocumentationPage healing section; EDIT the existing healing changelog entry in place (one evolving entry — do not append).

- [ ] **Step 4: Commit**

```bash
git add -f docs/skill-model-coverage.md docs/superpowers/handoffs/2026-06-07-damage-leech-handoff.md
git add src/pages/DocumentationPage.tsx src/constants/changelog.ts
git commit -m "docs: damage-leech rules, verify list, handoff correction, changelog fold"
```

---

### Task 12: Final verification

- [ ] **Step 1: Full suite + lint**

Run: `npx vitest run && npm run lint`
Expected: all tests PASS (~1500+), zero lint warnings.

- [ ] **Step 2: Golden integrity check** — `git diff main -- src/utils/calculators/__tests__/__snapshots__/` shows ONLY added scenario entries (9-12), zero modified lines in existing snapshots.

- [ ] **Step 3: Grep discipline checks**

```bash
grep -rn "(?<=" src/ --include="*.ts" --include="*.tsx"   # expect: no matches
git log --oneline main..HEAD                               # sensible history
```

- [ ] **Step 4: Live verification (MAIN SESSION ONLY — never a subagent: dev server on :3002 holds the 212-ship fleet; restart with `npx vite --port 3002 --strictPort` if dead)** — on the Healing Calculator page: Magnolia self-sustain with Inferno ticking; Valerian Corrosion leech; Tithonus all-ally rider; Pallas ally rider (parses via "heals for"); Valkyrie burst heal on the detonation round; Quixilver as heal target under enemy bombardment (active rider + punch-through passive); Malvex shield growth per attack; Skill Editor round-trip (open a leech ship's skill, confirm basis/scope/checkbox render and re-save without drift).

- [ ] **Step 5: requesting-code-review / finishing-a-development-branch** per the superpowers flow (final whole-branch review, then PR).
