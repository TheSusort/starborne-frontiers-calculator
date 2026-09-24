import type { SavedAutogearConfig } from '../autogear';
import type { AutogearShipConfig } from '../../utils/autogear/runShipOptimizer';

/**
 * Type-only tripwire for #549: `AutogearPage.applySavedConfigs` restores a saved config into
 * live page state with `{ ...savedConfig, ... }` — a plain object spread, which silently drops
 * any saved key whose live counterpart has a different name (an excess property on a
 * non-literal spread is not a type error). This fails `tsc` when a saved key has no live
 * counterpart of the same name.
 *
 * This file has no runtime behaviour — it exists only for `tsc --noEmit` to check. `shipId` is
 * excluded because it is saved-only: the live config map is already keyed by ship id
 * (`Record<string, AutogearShipConfig>` in `useAutogearShipConfigs`), so no live field carries
 * it.
 */
type SavedKeyExcludingShipId = Exclude<keyof SavedAutogearConfig, 'shipId'>;

// The `[X] extends [Y]` tuple wrapping suppresses conditional-type distribution over the
// `SavedKeyExcludingShipId` union — without it, a single mismatched member would resolve to
// `never` and vanish from the union instead of failing the whole check.
type EverySavedKeyExistsOnLiveConfig = [SavedKeyExcludingShipId] extends [keyof AutogearShipConfig]
    ? true
    : false;

const _assertSavedKeysRestoreCleanly: EverySavedKeyExistsOnLiveConfig = true;
