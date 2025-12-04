import React, { useState } from 'react';
import { Tooltip } from '../ui/layout/Tooltip';
import { getRandomJoke } from '../../constants/jokes';

export const JokeCorner: React.FC = () => {
    const [isVisible, setIsVisible] = useState(false);
    const [currentJoke, setCurrentJoke] = useState(getRandomJoke());

    const handleMouseEnter = () => {
        setCurrentJoke(getRandomJoke());
        setIsVisible(true);
    };

    return (
        <div className="fixed bottom-4 right-4 z-50">
            <div className="relative">
                <button
                    className="w-8 h-8 rounded-full bg-primary hover:bg-primary-hover flex items-center justify-center text-white transition-colors duration-200"
                    onMouseEnter={handleMouseEnter}
                    onMouseLeave={() => setIsVisible(false)}
                    aria-label="Show random joke"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                    </svg>
                </button>
                <Tooltip isVisible={isVisible} className="w-72 card p-4 shadow-lg">
                    <p>{currentJoke}</p>
                </Tooltip>
            </div>
        </div>
    );
};

export default JokeCorner;
