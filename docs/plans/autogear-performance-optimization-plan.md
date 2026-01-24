# Autogear Performance Optimization Plan

## Current Performance Analysis

Based on the performance metrics from a test run:

- **Total Time**: ~19.9 seconds
- **GeneticAlgorithm**: 19,895.9ms
- **CalculateTotalStats**: 13,652.6ms (11,499 calls, 1.19ms avg) - **BIGGEST BOTTLENECK**
- **CalculateFitness**: 16,608.7ms (18,400 calls, 0.90ms avg)
- **CalculateTotalScore**: 16,598.2ms (18,400 calls, 0.90ms avg)
- **CalculateSetCount**: 2,866.4ms (11,499 calls, 0.25ms avg)
- **EvaluatePopulation**: 16,617.7ms (23 calls, 722.51ms avg)

## Performance Timer Overhead Analysis

The performance tracker is called **18,400+ times** during a single optimization run. Each call involves:

- Map lookups (`this.timers.get(name)`)
- Array operations (`this.stack.push/pop`)
- Object property assignments
- `performance.now()` calls (can be expensive in tight loops)

**Estimated overhead**: 5-15% of total runtime (1-3 seconds)

## Identified Bottlenecks

### 1. CalculateTotalStats (13.6s - 68% of total time)

- Called 11,499 times at 1.19ms each
- Issues:
    - Multiple `Object.values()` calls on equipment/implants
    - Redundant gear lookups via `getGearPiece()`
    - Set counting done twice (once here, once in scoring)
    - Multiple `Object.assign()` calls for stat copying
    - No caching of gear piece lookups

### 2. Redundant Set Counting (2.9s)

- Set counting happens in both `calculateTotalStats` and `calculateTotalScore`
- Equipment is iterated multiple times for the same purpose

### 3. Cache Key Generation

- String operations and sorting on every call
- `Object.entries()` + `filter()` + `sort()` + `map()` + `join()` chain
- Called 18,400 times

### 4. Gear Piece Lookups

- `getGearPiece()` called repeatedly for the same gear IDs
- No memoization/caching of lookups within a single optimization run

## Optimization Strategies

### Priority 1: Quick Wins (Expected: 20-30% improvement)

#### 1.1 Disable Performance Tracking in Production

- **Impact**: 5-15% improvement (1-3 seconds)
- **Effort**: Low
- **Risk**: None
- **Implementation**:
    - Add environment check or feature flag
    - Or make timer calls no-ops when disabled

#### 1.2 Optimize Performance Timer

- **Impact**: 2-5% improvement if keeping timers
- **Effort**: Low
- **Risk**: None
- **Implementation**:
    - Cache `performance.now()` results
    - Use simpler data structures
    - Batch timer operations

#### 1.3 Cache Gear Piece Lookups

- **Impact**: 5-10% improvement
- **Effort**: Low
- **Risk**: Low
- **Implementation**:
    - Create a memoized version of `getGearPiece` for the optimization run
    - Cache results in a Map keyed by gear ID

### Priority 2: Medium Effort (Expected: 30-50% improvement)

#### 2.1 Optimize CalculateTotalStats

- **Impact**: 20-30% improvement (3-4 seconds)
- **Effort**: Medium
- **Risk**: Medium (core calculation logic)
- **Implementation**:
    - Pre-compute equipment entries once
    - Reuse set count from scoring instead of recalculating
    - Reduce `Object.assign()` calls (direct property assignment)
    - Batch gear processing

#### 2.2 Eliminate Redundant Set Counting

- **Impact**: 5-10% improvement (1-2 seconds)
- **Effort**: Medium
- **Risk**: Low
- **Implementation**:
    - Calculate set count once in `calculateTotalScore`
    - Pass it to `calculateTotalStats` or cache it
    - Reuse the same set count object

#### 2.3 Optimize Cache Key Generation

- **Impact**: 3-5% improvement
- **Effort**: Medium
- **Risk**: Low
- **Implementation**:
    - Pre-sort equipment entries
    - Use faster string concatenation
    - Cache intermediate key parts

### Priority 3: Advanced Optimizations (Expected: 10-20% additional improvement)

#### 3.1 Optimize Object Operations

- **Impact**: 2-5% improvement
- **Effort**: Medium-High
- **Risk**: Medium
- **Implementation**:
    - Replace `Object.values()` with direct iteration where possible
    - Reduce `Object.assign()` calls
    - Use direct property access

#### 3.2 Batch Operations

- **Impact**: 2-5% improvement
- **Effort**: High
- **Risk**: Medium
- **Implementation**:
    - Process multiple individuals in parallel batches
    - Use Web Workers for heavy calculations (if applicable)

#### 3.3 Algorithm Tuning

- **Impact**: Variable (could reduce iterations)
- **Effort**: High
- **Risk**: High (may affect result quality)
- **Implementation**:
    - Reduce population size or generations
    - Improve early termination criteria
    - Better initial population seeding

## Implementation Plan

### Phase 1: Quick Wins (1-2 hours)

1. Add conditional performance tracking
2. Implement gear piece lookup caching
3. Optimize performance timer implementation

### Phase 2: Core Optimizations (3-4 hours)

1. Refactor `calculateTotalStats` to eliminate redundancies
2. Share set count between functions
3. Optimize cache key generation

### Phase 3: Advanced Optimizations (4-6 hours)

1. Optimize object operations
2. Consider algorithm parameter tuning
3. Profile and measure improvements

## Expected Results

- **Phase 1**: 20-30% improvement → **14-16 seconds** (from 19.9s)
- **Phase 2**: Additional 30-50% → **7-10 seconds**
- **Phase 3**: Additional 10-20% → **6-8 seconds**

**Target**: Reduce runtime from 15-40 seconds to **5-10 seconds**

## Testing Strategy

1. Run before/after benchmarks on the same test case
2. Verify results are identical (no correctness regressions)
3. Measure improvement at each phase
4. Test with different inventory sizes and ship configurations

## Risk Assessment

- **Low Risk**: Performance timer optimization, gear caching
- **Medium Risk**: `calculateTotalStats` refactoring (core logic)
- **High Risk**: Algorithm parameter changes (may affect quality)

## Notes

- The performance timer overhead is significant but easy to eliminate
- `calculateTotalStats` is the biggest bottleneck and should be prioritized
- Caching strategies can provide significant wins with low risk
- Consider keeping performance tracking as an optional debug feature
