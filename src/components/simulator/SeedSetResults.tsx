import React from 'react';
import type { SeedSetAggregate } from '../../utils/simulator/seededRuns';
import SimulatorVerdict from './SimulatorVerdict';
import ShipBreakdownTable from './ShipBreakdownTable';

interface Props {
    aggregate: SeedSetAggregate;
}

/** Aggregate view for a multi-seed run: the headline tiles and the per-ship breakdown. Picking a
 *  single seed to replay is `SeedStrip`'s job. */
const SeedSetResults: React.FC<Props> = ({ aggregate }) => (
    <div className="space-y-4">
        <SimulatorVerdict aggregate={aggregate} />
        <ShipBreakdownTable roster={aggregate.roster} perActorMean={aggregate.perActorMean} />
    </div>
);

export default SeedSetResults;
