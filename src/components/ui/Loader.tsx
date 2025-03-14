interface LoaderProps {
    size?: 'sm' | 'md' | 'lg';
}

export const Loader: React.FC<LoaderProps> = ({ size = 'lg' }) => {
    const sizeClasses = {
        sm: 'h-4 w-4 border-primary',
        md: 'h-8 w-8 border-primary',
        lg: 'h-12 w-12 border-primary',
    };

    return (
        <div className={`flex justify-center items-center ${size === 'lg' ? 'min-h-[50vh]' : ''}`}>
            <div
                className={`animate-spin rounded-full border-t-2 border-b-2 border-primary ${sizeClasses[size]}`}
            ></div>
        </div>
    );
};
