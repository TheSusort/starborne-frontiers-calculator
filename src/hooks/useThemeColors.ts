import { useMemo } from 'react';
import { useTheme } from '../contexts/ThemeContext';

interface ThemeColors {
    bg: string;
    bgLighter: string;
    border: string;
    primary: string;
    primaryHover: string;
    text: string;
    textSecondary: string;
    accent: string;
    gridStroke: string;
    axisStroke: string;
}

const DARK_COLORS: ThemeColors = {
    bg: '#111827',
    bgLighter: '#1f2937',
    border: '#374151',
    primary: '#ec8c37',
    primaryHover: '#f7b06e',
    text: '#e5e7eb',
    textSecondary: '#9ca3af',
    accent: '#ec8c37',
    gridStroke: '#374151',
    axisStroke: '#9ca3af',
};

const SYNTHWAVE_COLORS: ThemeColors = {
    bg: '#0d0a2e',
    bgLighter: '#1a1050',
    border: '#2a1a5e',
    primary: '#ff2d9b',
    primaryHover: '#ff5eb5',
    text: '#e0d0ff',
    textSecondary: '#a090c0',
    accent: '#00d4ff',
    gridStroke: '#2a1a5e',
    axisStroke: '#a090c0',
};

export const useThemeColors = (): ThemeColors => {
    const { theme } = useTheme();
    return useMemo(() => (theme === 'synthwave' ? SYNTHWAVE_COLORS : DARK_COLORS), [theme]);
};
