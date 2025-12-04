import React, { useState } from 'react';
import { PageLayout } from '../../components/ui';
import { Button } from '../../components/ui/Button';
import Seo from '../../components/seo/Seo';
import { SEO_CONFIG } from '../../constants/seo';
import { DiffResult } from '../../types/diff';
import { generateDiff } from '../../utils/diff/diffCalculator';
import { generateLargeFileDiff } from '../../utils/diff/starborneDiffCalculator';
import { FileUpload, DiffResults } from '../../components/diff';
import { ExportedPlayData, isExportedPlayData } from '../../types/starborne';

const JsonDiffCalculatorPage: React.FC = () => {
    const [file1, setFile1] = useState<File | null>(null);
    const [file2, setFile2] = useState<File | null>(null);
    const [json1, setJson1] = useState<Record<string, unknown> | null>(null);
    const [json2, setJson2] = useState<Record<string, unknown> | null>(null);
    const [diffResults, setDiffResults] = useState<DiffResult[]>([]);
    const [isCalculating, setIsCalculating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [fileSize1, setFileSize1] = useState<number>(0);
    const [fileSize2, setFileSize2] = useState<number>(0);

    const handleFileUpload = async (file: File, fileNumber: 1 | 2) => {
        try {
            const text = await file.text();
            const parsed = JSON.parse(text) as Record<string, unknown>;

            if (fileNumber === 1) {
                setFile1(file);
                setJson1(parsed);
                setFileSize1(file.size);
            } else {
                setFile2(file);
                setJson2(parsed);
                setFileSize2(file.size);
            }

            setError(null);
        } catch (err) {
            setError(
                `Invalid JSON in file ${fileNumber}: ${err instanceof Error ? err.message : 'Unknown error'}`
            );
        }
    };

    const calculateDiff = () => {
        if (!json1 || !json2) {
            setError('Please upload both files before calculating differences.');
            return;
        }

        setIsCalculating(true);
        setError(null);

        // Use setTimeout to prevent UI blocking
        setTimeout(() => {
            try {
                let results: DiffResult[];

                // Use optimized diff for large files (5MB+)
                const totalSize = fileSize1 + fileSize2;
                const isLargeFile = totalSize > 5 * 1024 * 1024; // 5MB

                if (isLargeFile && isExportedPlayData(json1) && isExportedPlayData(json2)) {
                    results = generateLargeFileDiff(json1, json2);
                } else {
                    results = generateDiff(json1, json2);
                }

                setDiffResults(results);
            } catch (err) {
                setError(
                    `Error calculating differences: ${err instanceof Error ? err.message : 'Unknown error'}`
                );
            } finally {
                setIsCalculating(false);
            }
        }, 100);
    };

    const clearFiles = () => {
        setFile1(null);
        setFile2(null);
        setJson1(null);
        setJson2(null);
        setDiffResults([]);
        setError(null);
        setFileSize1(0);
        setFileSize2(0);
    };

    const formatFileSize = (bytes: number): string => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    return (
        <PageLayout title="JSON Diff Calculator">
            <Seo
                title={SEO_CONFIG.jsonDiff.title}
                description={SEO_CONFIG.jsonDiff.description}
                keywords={SEO_CONFIG.jsonDiff.keywords}
            />

            <div className="mb-8">
                <p className="text-gray-300 mb-6">
                    Compare two Starborne Frontiers JSON export files to see what has changed
                    between them. Upload your exported player data files to analyze differences in
                    units, equipment, and engineering.
                </p>
            </div>

            {/* File Upload Section */}
            <div className="card mb-6">
                <h2 className="text-xl font-semibold mb-4">Upload Files</h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                    <div>
                        <FileUpload
                            onFileSelect={(file) => handleFileUpload(file, 1)}
                            label="First JSON File (Original)"
                            disabled={isCalculating}
                        />
                        {file1 && (
                            <div className="mt-2 text-sm text-gray-400">
                                {file1.name} ({formatFileSize(fileSize1)})
                            </div>
                        )}
                    </div>

                    <div>
                        <FileUpload
                            onFileSelect={(file) => handleFileUpload(file, 2)}
                            label="Second JSON File (New)"
                            disabled={isCalculating}
                        />
                        {file2 && (
                            <div className="mt-2 text-sm text-gray-400">
                                {file2.name} ({formatFileSize(fileSize2)})
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex space-x-4">
                    <Button
                        onClick={calculateDiff}
                        disabled={!json1 || !json2 || isCalculating}
                        className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
                    >
                        {isCalculating ? 'Calculating...' : 'Calculate Differences'}
                    </Button>

                    <Button onClick={clearFiles} variant="secondary" disabled={isCalculating}>
                        Clear Files
                    </Button>
                </div>

                {error && (
                    <div className="mt-4 p-4 bg-red-900/20 border border-red-500/30">
                        <p className="text-red-400">{error}</p>
                    </div>
                )}
            </div>

            {/* Results Section */}
            {diffResults.length > 0 && <DiffResults diffResults={diffResults} />}

            {/* Information Section */}
            <div className="card mt-6">
                <h2 className="text-xl font-semibold mb-4">How It Works</h2>
                <div className="space-y-3 text-gray-300">
                    <p>
                        <strong>Small Files (&lt;5MB):</strong> Full recursive comparison of all
                        properties and nested objects.
                    </p>
                    <p>
                        <strong>Large Files (≥5MB):</strong> Optimized comparison focusing on key
                        Starborne Frontiers sections:
                    </p>
                    <ul className="list-disc list-inside ml-4 space-y-1">
                        <li>
                            <strong>Units:</strong> Level, Rank, Refit changes
                        </li>
                        <li>
                            <strong>Equipment:</strong> Level, Rank, and equipment reassignment
                            changes
                        </li>
                        <li>
                            <strong>Engineering:</strong> Level, Type, Attribute, and ModifierType
                            changes
                        </li>
                    </ul>
                    <p className="text-sm text-gray-400 mt-4">
                        Equipment changes are grouped with their equipped units for better
                        readability. Detailed Attributes fields are excluded to reduce verbosity in
                        large files.
                    </p>
                </div>
            </div>
        </PageLayout>
    );
};

export default JsonDiffCalculatorPage;
