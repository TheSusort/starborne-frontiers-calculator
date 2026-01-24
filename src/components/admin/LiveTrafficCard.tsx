import React, { useEffect, useState } from 'react';
import { getLiveTraffic, LiveTraffic } from '../../services/adminService';
import { StatCard } from '../ui/StatCard';

const REFRESH_INTERVAL = 10_000; // 10 seconds

export const LiveTrafficCard: React.FC = () => {
    const [traffic, setTraffic] = useState<LiveTraffic | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchTraffic = async () => {
            const data = await getLiveTraffic();
            setTraffic(data);
            setLoading(false);
        };

        fetchTraffic();
        const interval = setInterval(fetchTraffic, REFRESH_INTERVAL);

        return () => clearInterval(interval);
    }, []);

    if (loading) {
        return (
            <div className="card animate-pulse">
                <div className="h-24 bg-gray-700 rounded"></div>
            </div>
        );
    }

    return (
        <>
            <div className="grid grid-cols-3 gap-4">
                <StatCard title="Active now" value={traffic?.active_sessions ?? 0} color="green" />
                <StatCard title="Logged in currently" value={traffic?.authenticated_users ?? 0} />
                <StatCard title="Anonymous sessions" value={traffic?.anonymous_sessions ?? 0} />
            </div>
        </>
    );
};
