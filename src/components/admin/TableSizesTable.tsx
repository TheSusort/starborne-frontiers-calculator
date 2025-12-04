import React from 'react';
import { TableInfo } from '../../services/systemHealthService';

interface TableSizesTableProps {
    tables: TableInfo[];
}

export const TableSizesTable: React.FC<TableSizesTableProps> = ({ tables }) => {
    // Calculate total size in MB
    const totalSizeMB = React.useMemo(() => {
        return tables.reduce((sum, table) => {
            // Parse size string (e.g., "123 MB" or "1234 kB")
            const match = table.total_size.match(/(\d+(?:\.\d+)?)\s*(\w+)/);
            if (match) {
                const value = parseFloat(match[1]);
                const unit = match[2].toLowerCase();
                if (unit === 'mb') return sum + value;
                if (unit === 'gb') return sum + value * 1024;
                if (unit === 'kb') return sum + value / 1024;
                if (unit === 'bytes') return sum + value / (1024 * 1024);
            }
            return sum;
        }, 0);
    }, [tables]);

    // Determine color based on size thresholds
    // Note: Actual Supabase usage includes ~15% overhead (WAL, temp files, etc.)
    // So we use lower thresholds to account for the real usage
    const getTotalSizeColor = () => {
        if (totalSizeMB >= 400) return 'text-red-500'; // ~460 MB real (92%)
        if (totalSizeMB >= 340) return 'text-orange-500'; // ~390 MB real (78%)
        if (totalSizeMB >= 290) return 'text-yellow-500'; // ~335 MB real (67%)
        return 'text-green-500';
    };

    const getTotalSizeBgColor = () => {
        if (totalSizeMB >= 400) return 'bg-red-500/10 border-red-500/50';
        if (totalSizeMB >= 340) return 'bg-orange-500/10 border-orange-500/50';
        if (totalSizeMB >= 290) return 'bg-yellow-500/10 border-yellow-500/50';
        return 'bg-green-500/10 border-green-500/50';
    };

    return (
        <div className="card">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-semibold">Database Tables</h3>
                <div className={`px-4 py-2 border ${getTotalSizeBgColor()}`}>
                    <span className="text-sm text-gray-400 mr-2">Total Size:</span>
                    <span className={`text-lg font-bold ${getTotalSizeColor()}`}>
                        {totalSizeMB.toFixed(2)} MB
                    </span>
                    <span className="text-xs text-gray-500 ml-2">/ 500 MB</span>
                </div>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                    <thead>
                        <tr className="border-b border-dark-border">
                            <th className="pb-3 font-semibold text-gray-300">Table Name</th>
                            <th className="pb-3 font-semibold text-gray-300 text-right">Rows</th>
                            <th className="pb-3 font-semibold text-gray-300 text-right">
                                Table Size
                            </th>
                            <th className="pb-3 font-semibold text-gray-300 text-right">Indexes</th>
                            <th className="pb-3 font-semibold text-gray-300 text-right">
                                Total Size
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {tables.map((table) => (
                            <tr
                                key={table.table_name}
                                className="border-b border-gray-800 hover:bg-dark transition-colors"
                            >
                                <td className="py-3 text-gray-200 font-mono text-xs">
                                    {table.table_name.replace('public.', '')}
                                </td>
                                <td className="py-3 text-right text-gray-300">
                                    {table.row_count.toLocaleString()}
                                </td>
                                <td className="py-3 text-right text-blue-400">
                                    {table.table_size}
                                </td>
                                <td className="py-3 text-right text-green-400">
                                    {table.indexes_size}
                                </td>
                                <td className="py-3 text-right text-yellow-400 font-semibold">
                                    {table.total_size}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
