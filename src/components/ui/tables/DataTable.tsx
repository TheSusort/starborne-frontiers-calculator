import React, { ReactNode } from 'react';
import { Loader } from '../Loader';
import { Pagination } from '../Pagination';

export interface Column<T> {
    key: string;
    label: string;
    sortable?: boolean;
    align?: 'left' | 'right' | 'center';
    render?: (item: T, index: number) => ReactNode;
    className?: string;
}

interface DataTableProps<T> {
    data: T[];
    columns: Column<T>[];
    loading?: boolean;
    emptyMessage?: string;
    getRowKey: (item: T, index: number) => string;
    onSort?: (field: string) => void;
    sortBy?: string;
    sortDirection?: 'asc' | 'desc';
    pagination?: {
        currentPage: number;
        totalPages: number;
        totalItems: number;
        pageSize: number;
        onPageChange: (page: number) => void;
        showItemCount?: boolean;
    };
    className?: string;
    rowClassName?: (item: T, index: number) => string;
}

export function DataTable<T>({
    data,
    columns,
    loading = false,
    emptyMessage = 'No data available',
    getRowKey,
    onSort,
    sortBy,
    sortDirection,
    pagination,
    className = '',
    rowClassName,
}: DataTableProps<T>) {
    const handleSort = (column: Column<T>) => {
        if (column.sortable && onSort) {
            onSort(column.key);
        }
    };

    const getSortIcon = (column: Column<T>) => {
        if (!column.sortable || !onSort) return null;
        if (sortBy !== column.key) {
            return <span className="text-gray-600">⇅</span>;
        }
        return sortDirection === 'asc' ? (
            <span className="text-primary">↑</span>
        ) : (
            <span className="text-primary">↓</span>
        );
    };

    const getAlignmentClass = (align?: 'left' | 'right' | 'center') => {
        switch (align) {
            case 'right':
                return 'text-right';
            case 'center':
                return 'text-center';
            default:
                return 'text-left';
        }
    };

    return (
        <div className={`card ${className}`}>
            <div className="overflow-x-auto">
                <table className="w-full text-left">
                    <thead>
                        <tr className="border-b border-dark-border">
                            {columns.map((column) => (
                                <th
                                    key={column.key}
                                    className={`pb-3 font-semibold text-gray-300 ${
                                        column.align === 'right' ? 'text-right' : ''
                                    } ${
                                        column.sortable && onSort
                                            ? 'cursor-pointer hover:text-primary transition-colors'
                                            : ''
                                    } ${column.className || ''} ${
                                        column.key === columns[0].key ? 'ps-3' : ''
                                    } ${
                                        column.key === columns[columns.length - 1].key ? 'pe-3' : ''
                                    }`}
                                    onClick={() => handleSort(column)}
                                >
                                    <div
                                        className={`flex items-center gap-2 ${
                                            column.align === 'right' ? 'justify-end' : ''
                                        }`}
                                    >
                                        {column.label} {getSortIcon(column)}
                                    </div>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr>
                                <td
                                    colSpan={columns.length}
                                    className="py-3 text-center text-gray-400"
                                >
                                    <Loader size="sm" />
                                </td>
                            </tr>
                        ) : data.length === 0 ? (
                            <tr>
                                <td
                                    colSpan={columns.length}
                                    className="py-3 text-center text-gray-400"
                                >
                                    {emptyMessage}
                                </td>
                            </tr>
                        ) : (
                            data.map((item, index) => (
                                <tr
                                    key={getRowKey(item, index)}
                                    className={`border-b border-gray-800 hover:bg-dark-lighter transition-colors ${
                                        rowClassName ? rowClassName(item, index) : ''
                                    }`}
                                >
                                    {columns.map((column) => (
                                        <td
                                            key={column.key}
                                            className={`py-3 ${getAlignmentClass(column.align)} ${
                                                column.key === columns[0].key ? 'ps-3' : ''
                                            } ${
                                                column.key === columns[columns.length - 1].key
                                                    ? 'pe-3'
                                                    : ''
                                            } ${column.className || ''}`}
                                        >
                                            {column.render
                                                ? column.render(item, index)
                                                : (() => {
                                                      const value = (
                                                          item as Record<string, unknown>
                                                      )[column.key];
                                                      if (value === null || value === undefined)
                                                          return '-';
                                                      if (
                                                          typeof value === 'string' ||
                                                          typeof value === 'number'
                                                      ) {
                                                          return value;
                                                      }
                                                      return String(value);
                                                  })()}
                                        </td>
                                    ))}
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {pagination && pagination.totalPages > 1 && (
                <div className="flex justify-between items-center mt-4 px-3">
                    {pagination.showItemCount !== false && (
                        <div className="text-sm text-gray-400">
                            Showing {(pagination.currentPage - 1) * pagination.pageSize + 1} to{' '}
                            {Math.min(
                                pagination.currentPage * pagination.pageSize,
                                pagination.totalItems
                            )}{' '}
                            of {pagination.totalItems}
                        </div>
                    )}
                    <Pagination
                        currentPage={pagination.currentPage}
                        totalPages={pagination.totalPages}
                        onPageChange={pagination.onPageChange}
                        className="mt-0"
                    />
                </div>
            )}
        </div>
    );
}
