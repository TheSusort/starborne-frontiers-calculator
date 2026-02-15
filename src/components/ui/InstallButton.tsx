import React from 'react';
import { Download } from 'lucide-react';
import { Button } from './Button';
import { useInstallPrompt } from '../../hooks/useInstallPrompt';

export const InstallButton: React.FC = () => {
    const { isInstallable, install } = useInstallPrompt();

    if (!isInstallable) return null;

    return (
        <Button variant="secondary" onClick={install} title="Install app" className="flex">
            <Download className="w-4 h-6 mr-auto inline-block" />
            Install App
        </Button>
    );
};
