import React, { useEffect, useState } from 'react';
import { getLiveTraffic, LiveTraffic } from '../../services/adminService';

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
                <div className="h-32 bg-gray-700 rounded"></div>
            </div>
        );
    }

    return (
        <div className="card">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">Live Traffic</h3>
                <div className="flex items-center gap-2">
                    <span className="relative flex h-3 w-3">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                    </span>
                    <span className="text-xs text-gray-400">Live</span>
                </div>
            </div>

            <div className="grid grid-cols-3 gap-4 mb-4">
                <div className="text-center">
                    <div className="text-2xl font-bold text-white">
                        {traffic?.active_sessions ?? 0}
                    </div>
                    <div className="text-xs text-gray-400">Active Now</div>
                </div>
                <div className="text-center">
                    <div className="text-2xl font-bold text-green-400">
                        {traffic?.authenticated_users ?? 0}
                    </div>
                    <div className="text-xs text-gray-400">Logged In</div>
                </div>
                <div className="text-center">
                    <div className="text-2xl font-bold text-gray-400">
                        {traffic?.anonymous_sessions ?? 0}
                    </div>
                    <div className="text-xs text-gray-400">Anonymous</div>
                </div>
            </div>

            {traffic?.top_pages && traffic.top_pages.length > 0 && (
                <div>
                    <h4 className="text-sm text-gray-400 mb-2">Top Pages</h4>
                    <div className="space-y-1">
                        {traffic.top_pages.map((page) => (
                            <div key={page.path} className="flex justify-between text-sm">
                                <span className="text-gray-300 truncate max-w-[200px]">
                                    {page.path}
                                </span>
                                <span className="text-gray-500">{page.count}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};
