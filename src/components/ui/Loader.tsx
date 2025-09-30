export const Loader = ({ size = 'lg' }: { size?: 'sm' | 'lg' }) => {
    return (
        <div className={`flex justify-center items-center ${size === 'sm' ? '' : 'min-h-[50vh]'}`}>
            <div
                className={`animate-spin rounded-full ${size === 'sm' ? 'h-6 w-6' : 'h-12 w-12'} border-t-2 border-b-2 border-primary`}
            ></div>
        </div>
    );
};
