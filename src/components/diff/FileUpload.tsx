import React from 'react';
import { Button } from '../ui/Button';

interface FileUploadProps {
    onFileSelect: (file: File) => void;
    label: string;
    accept?: string;
    disabled?: boolean;
}

export const FileUpload: React.FC<FileUploadProps> = ({
    onFileSelect,
    label,
    accept = '.json',
    disabled = false,
}) => {
    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            onFileSelect(file);
        }
    };

    return (
        <div className="flex flex-col space-y-2">
            <label className="text-sm font-medium text-gray-300">{label}</label>
            <input
                type="file"
                accept={accept}
                onChange={handleFileChange}
                disabled={disabled}
                className="hidden"
                id={`diff-file-input-${label.replace(' ', '-')}`}
            />
            <Button
                variant="secondary"
                onClick={() =>
                    document.getElementById(`diff-file-input-${label.replace(' ', '-')}`)?.click()
                }
            >
                Upload File
            </Button>
        </div>
    );
};
