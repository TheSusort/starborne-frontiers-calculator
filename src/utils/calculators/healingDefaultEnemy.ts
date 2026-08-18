/**
 * The stat block a default enemy starts from. Shared by the healing page (the card a user adds)
 * and the adapter (the PRACTICE TARGET it synthesizes when the roster is empty), so the two
 * cannot drift into two different numbers.
 *
 * These are the basis for any `basis:'damage-dealt'` heal or shield rider, which is why the
 * practice target reuses them rather than zeroing defence: emptying the roster then means exactly
 * one thing — nothing shoots back — instead of also silently maximizing damage-scaled repair.
 *
 * None of them may be 0. An `hp` of 0 makes an enemy that is already destroyed, so the healer's
 * cast delivers nothing to it and every `damage-dealt` rider silently pays out zero; a `security`
 * of 0 would make the healer's outbound debuffs land strictly MORE often than they did before the
 * run became positional.
 *
 * This module deliberately imports NOTHING. `EnemyAttackerInput` lives in `healingEngineAdapter.ts`,
 * which imports *this* module, and a value-level cycle between the two would be a real one.
 * `attack` and `hacking` are absent on purpose: the practice target's whole distinction is that it
 * has no attack, and an absent `hacking` already defaults to the engine's 200 — the same number the
 * page's card seeds — so there is nothing for a constant to keep in step.
 */
export const DEFAULT_ENEMY_HP = 40_000;
export const DEFAULT_ENEMY_DEFENCE = 5_000;
export const DEFAULT_ENEMY_SECURITY = 100;
export const DEFAULT_ENEMY_SPEED = 50;
