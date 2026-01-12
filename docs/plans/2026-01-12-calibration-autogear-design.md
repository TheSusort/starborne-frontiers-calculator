# Smart Calibration Handling in Autogear

**Date:** 2026-01-12

## Problem

Calibrated gear gives stat bonuses only to the ship it's calibrated to. Currently, autogear recommends calibrated gear for any ship, which leads to suboptimal recommendations since other ships won't receive the calibration bonus.

## Solution

By default, exclude calibrated gear from autogear unless it's calibrated to the target ship. Add an override checkbox for users who want to reassign calibrated gear anyway.

## Design

### Data Model

No changes needed. Existing `GearPiece.calibration.shipId` tracks which ship gear is calibrated to.

**New config option:**
```typescript
// In shipConfigs state (AutogearPage.tsx)
includeCalibratedGear: boolean  // default: false
```

### Inventory Filtering

**Location:** `AutogearPage.tsx` lines 293-353 (existing filter chain)

**New filter rule:**
```typescript
// Exclude calibrated gear for other ships (unless override enabled)
if (gear.calibration?.shipId && gear.calibration.shipId !== ship.id) {
    if (!shipConfig.includeCalibratedGear) {
        return false;
    }
}
```

**Behavior:**
- Gear calibrated to *this* ship → always included
- Gear calibrated to *another* ship → excluded by default
- Gear with no calibration → unaffected (follows existing rules)
- Override enabled → calibrated gear for other ships is included

### Scoring with Calibration Awareness

**Key insight:** Imported calibrated gear already has boosted main stats stored. So:
- Gear calibrated to target ship → use stored stats as-is (already includes bonus)
- Gear calibrated to other ship → reverse the calibration bonus to get true base stats

**Implementation:**
```typescript
const getGearForShip = (id: string) => {
    const gear = shipConfig.useUpgradedStats
        ? getUpgradedGearPiece(id)
        : getGearPiece(id);

    if (!gear) return undefined;

    // If calibrated to a DIFFERENT ship, reverse the bonus
    if (gear.calibration?.shipId && gear.calibration.shipId !== ship.id) {
        return removeCalibrationStats(gear);
    }

    return gear; // Calibrated to this ship or uncalibrated - use as-is
};
```

### UI Changes

**Location:** `AutogearSettingsModal.tsx`

**New checkbox:**
- Label: "Include calibrated gear"
- Tooltip: "Include gear calibrated to other ships. These will be scored using base stats (without calibration bonus)."
- Default: Unchecked

## Files to Modify

1. **`src/utils/gear/calibrationCalculator.ts`**
   - Export `removeCalibrationStats(gear)` function using existing `_reverseCalibrationStatValue` logic

2. **`src/pages/manager/AutogearPage.tsx`**
   - Add `includeCalibratedGear` to `shipConfigs` state (default: `false`)
   - Add calibration filter in `availableInventory` (~line 293)
   - Create calibration-aware gear getter before calling `findOptimalGear`

3. **`src/components/autogear/AutogearSettingsModal.tsx`**
   - Add checkbox for "Include calibrated gear"
   - Wire up prop and handler

4. **`src/contexts/AutogearConfigContext.tsx`** (if configs are persisted)
   - Add `includeCalibratedGear` to saved config schema

## No Changes Needed

- Autogear strategies (filtering/scoring handled externally)
- Database schema
- Gear type definitions
