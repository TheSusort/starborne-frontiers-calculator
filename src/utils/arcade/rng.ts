/** mulberry32. The whole generator state is one uint32 stored on the game, so a seed replays a run. */
export function nextRandom(state: { rngState: number }): number {
    state.rngState = (state.rngState + 0x6d2b79f5) >>> 0;
    let t = state.rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** The seed every simulation of one checkpoint row uses: fixed by the run's seed and the row. */
export function challengeSeed(runSeed: number, checkpointId: number): number {
    const state = { rngState: (runSeed ^ Math.imul(checkpointId, 0x9e3779b1)) >>> 0 };
    return Math.floor(nextRandom(state) * 4294967296) >>> 0;
}
