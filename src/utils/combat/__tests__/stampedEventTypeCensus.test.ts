import { describe, it, expect } from 'vitest';
import type { CombatEvent } from '../events';
import type { StampedEventType } from '../triggers';

// ---------------------------------------------------------------------------
// #466 follow-up: neither hand-enumerated list in triggers.ts (`StampedEventType`, the union;
// `REACTIVE_STAMPED_EVENT_TYPES`, the Set built from it) was updated when 'steal-performed' was
// added to events.ts carrying `& ReactiveStamp`. The Set's own exhaustiveArrayOf<StampedEventType>
// helper (triggers.ts) already guarantees the Set can never drift from the `StampedEventType`
// union at compile time — a member missing from that array literal is a tsc error. What was
// missing was the OTHER half: nothing checked `StampedEventType` itself against the real source
// of truth, the CombatEvent union in events.ts.
//
// This file closes that half. It derives the expected tag set directly from `CombatEvent` — no
// hand-typed list to restate and silently let drift again.
//
// WHY THIS CANNOT BE A RUNTIME (`expect(...)`) CHECK: `ReactiveStamp`'s three fields
// (`reactive?`, `duringTurnOf?`, `triggerActorId?`) are all optional, so — as triggers.ts's own
// comment on `makeReactiveStampingBus` notes — `Extract<CombatEvent, ReactiveStamp>` (an
// assignability check) matches the ENTIRE union: every variant is structurally compatible with an
// object that merely doesn't set three optional fields. There is also no runtime value to inspect
// — `CombatEvent` is erased at compile time, and no production code builds a "list of every event
// type" array to read. So the only thing that can distinguish "this variant was declared
// `& ReactiveStamp`" from "this variant just happens to be assignable to it" is TypeScript's
// `keyof`, which reports a type's own declared member names (including optional ones) rather than
// doing an assignability check. That distinction only exists at the type level, so the assertion
// below is a type-level one: a broken invariant fails `npx tsc --noEmit`, not `expect()`. The
// `it` block exists only so this file still reports as a real (trivially-passing) vitest test —
// the load-bearing check is the type alias below it, which the pre-commit hook's tsc step covers.
// ---------------------------------------------------------------------------

/** Every `CombatEvent['type']` tag whose variant declares (even optionally) `reactive` —
 *  i.e. was intersected with `& ReactiveStamp` in events.ts. Distributes the conditional over
 *  the union so each tag is checked against its OWN variant, not the union of all variants. */
type DerivedStampedEventType = {
    [K in CombatEvent['type']]: 'reactive' extends keyof Extract<CombatEvent, { type: K }>
        ? K
        : never;
}[CombatEvent['type']];

/** Standard distributive-safe type-equality check (the "two functions" trick — a plain
 *  `A extends B ? B extends A ? ...` gets confused by union distribution on either side). */
type TypeEqual<A, B> =
    (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** If this fails to compile, `StampedEventType` (triggers.ts) has drifted from the CombatEvent
 *  union: some variant now carries `& ReactiveStamp` (or had it removed) without triggers.ts's
 *  hand-enumerated list being swept to match. Expand `DerivedStampedEventType` in the tsc error
 *  to see the correct set, and update `StampedEventType` (which also feeds
 *  `REACTIVE_STAMPED_EVENT_TYPES` via `exhaustiveArrayOf`, so one edit fixes both lists). */
type AssertStampedEventTypeMatchesUnion =
    TypeEqual<StampedEventType, DerivedStampedEventType> extends true
        ? true
        : {
              error: 'StampedEventType (triggers.ts) is out of sync with the CombatEvent union (events.ts)';
              derivedFromCombatEvent: DerivedStampedEventType;
              handWrittenInTriggersTs: StampedEventType;
          };

const _typeLevelCheck: AssertStampedEventTypeMatchesUnion = true;

describe('StampedEventType tracks the CombatEvent ReactiveStamp union', () => {
    it('is checked at the type level (see AssertStampedEventTypeMatchesUnion above) — this only pins the file as a real vitest test', () => {
        expect(true).toBe(true);
    });
});
