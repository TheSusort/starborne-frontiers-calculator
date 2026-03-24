import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

export type Theme = 'dark' | 'synthwave';

interface ThemeContextValue {
    theme: Theme;
    setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const STORAGE_KEY = 'app_theme';

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [theme, setThemeState] = useState<Theme>(() => {
        const stored = localStorage.getItem(STORAGE_KEY);
        return stored === 'synthwave' ? 'synthwave' : 'dark';
    });

    const setTheme = useCallback((newTheme: Theme) => {
        // VHS static glitch transition
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed; inset: 0; z-index: 99999; pointer-events: none;
            background: url('/images/transition.jpg');
            background-size: cover;
            animation: vhs-glitch 250ms steps(4) forwards;
            mix-blend-mode: darken;
        `;

        // Inject keyframes if not already present
        if (!document.getElementById('vhs-glitch-style')) {
            const style = document.createElement('style');
            style.id = 'vhs-glitch-style';
            style.textContent = `
                @keyframes vhs-glitch {
                    0% { opacity: 1; transform: scaleY(1) translateX(0); }
                    15% { opacity: 1; transform: scaleY(1.02) translateX(-3px); }
                    30% { opacity: 1; transform: scaleY(0.98) translateX(5px); }
                    50% { opacity: 1; transform: scaleY(1) translateX(-2px); }
                    70% { opacity: 1; transform: scaleY(1.01) translateX(3px); }
                    85% { opacity: 1; transform: scaleY(0.99) translateX(-4px); }
                    100% { opacity: 0; transform: scaleY(1) translateX(0); }
                }
            `;
            document.head.appendChild(style);
        }

        document.body.appendChild(overlay);

        // Swap theme immediately
        setTimeout(() => {
            setThemeState(newTheme);
            localStorage.setItem(STORAGE_KEY, newTheme);
            if (newTheme === 'dark') {
                document.documentElement.removeAttribute('data-theme');
            } else {
                document.documentElement.setAttribute('data-theme', newTheme);
            }
        }, 80);

        // Remove overlay after animation
        setTimeout(() => overlay.remove(), 300);
    }, []);

    // Sync attribute on mount (in case FOUC script didn't run)
    useEffect(() => {
        if (theme === 'dark') {
            document.documentElement.removeAttribute('data-theme');
        } else {
            document.documentElement.setAttribute('data-theme', theme);
        }
    }, [theme]);

    return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
};

export const useTheme = (): ThemeContextValue => {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
};
