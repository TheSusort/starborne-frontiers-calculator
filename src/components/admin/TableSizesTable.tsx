import React from 'react';
import { TableInfo } from '../../services/systemHealthService';

interface TableSizesTableProps {
    tables: TableInfo[];
}

export const TableSizesTable: React.FC<TableSizesTableProps> = ({ tables }) => {
    return (
        <div className="bg-dark-lighter p-6 border border-gray-700">
            <h3 className="text-xl font-semibold mb-4">Database Tables</h3>
            <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                    <thead>
                        <tr className="border-b border-gray-700">
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
