import React from 'react';
import { Button } from './Button';
import { ChevronLeftIcon, ChevronRightIcon } from './icons';

interface PaginationProps {
    currentPage: number;
    totalPages: number;
    onPageChange: (page: number) => void;
    scrollToTop?: boolean;
    className?: string;
}

export const Pagination: React.FC<PaginationProps> = ({
    currentPage,
    totalPages,
    onPageChange,
    scrollToTop = true,
    className = '',
}) => {
    if (totalPages <= 1) {
        return null;
    }

    const handlePageChange = (page: number) => {
        onPageChange(page);
        if (scrollToTop) {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    };

    const visiblePages = Array.from({ length: totalPages }, (_, i) => i + 1).filter((page) => {
        return page === 1 || page === totalPages || Math.abs(page - currentPage) <= 1;
    });

    return (
        <div className={`mt-6 flex justify-center items-center space-x-2 ${className}`}>
            <Button
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
                variant="secondary"
                size="sm"
                aria-label="Previous page"
            >
                <ChevronLeftIcon />
            </Button>

            <div className="flex items-center space-x-1">
                {visiblePages.map((page, index, array) => {
                    const showEllipsis = index > 0 && array[index - 1] !== page - 1;
                    return (
                        <React.Fragment key={page}>
                            {showEllipsis && <span className="px-2">...</span>}
                            <Button
                                onClick={() => handlePageChange(page)}
                                variant={currentPage === page ? 'primary' : 'secondary'}
                                size="sm"
                            >
                                {page}
                            </Button>
                        </React.Fragment>
                    );
                })}
            </div>

            <Button
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
                variant="secondary"
                size="sm"
                aria-label="Next page"
            >
                <ChevronRightIcon />
            </Button>
        </div>
    );
};
