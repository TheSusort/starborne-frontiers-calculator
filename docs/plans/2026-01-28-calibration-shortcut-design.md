# Calibration Shortcut from ShipCard

## Summary

Add a "Calibrate gear" shortcut to the ShipCard dropdown menu that navigates directly to the Gear page's Calibration tab with the ship pre-selected for analysis.

## Navigation Flow

```
ShipCard dropdown → "Calibrate gear" → /gear?tab=calibration&subTab=ship&shipId={shipId}
```

The URL params trigger:
1. Switch to "calibration" tab
2. Switch to "ship" sub-tab (Ship Analysis view)
3. Pre-select the ship in ShipSelector

## Files to Modify

### 1. ShipDisplay.tsx
Add dropdown menu item after "Simulate ship":
- Navigate to `/gear?tab=calibration&subTab=ship&shipId=${ship.id}`
- Use CalibrationIcon
- Label: "Calibrate gear"

### 2. GearPage.tsx
Read URL params and pass to children:
- Import `useSearchParams` from react-router-dom
- Read `tab`, `subTab`, `shipId` from URL
- Initialize `activeTab` from URL param (fallback to 'inventory')
- Pass `initialShipId` and `initialSubTab` to `GearCalibrationAnalysis`
- Clear URL params after reading (consistent with AutogearPage pattern)

### 3. GearCalibrationAnalysis.tsx
Accept and forward initialization props:
- New props: `initialShipId?: string`, `initialSubTab?: 'candidates' | 'ship'`
- Initialize `activeSubTab` from prop (fallback to 'candidates')
- Pass `initialShipId` to `ShipCalibrationAnalysis`

### 4. ShipCalibrationAnalysis.tsx
Pre-select ship on mount:
- New prop: `initialShipId?: string`
- Use `useShips` hook to look up ship by ID
- Set as `selectedShip` on mount if provided

## Implementation Notes

- Follow existing pattern from AutogearPage for URL param handling
- Clear URL params after initialization to keep URL clean
- CalibrationIcon already exists at `src/components/ui/icons/CalibrationIcon.tsx`
