interface CubedwebAuthResponse {
    token: string;
}

interface CubedwebHangarResponse {
    status: string;
    hangarUrl: string;
}

// Efficient base64 conversion for large files
const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result === 'string') {
                // Remove the data URL prefix (e.g., "data:application/json;base64,")
                const base64 = reader.result.split(',')[1];
                resolve(base64);
            } else {
                reject(new Error('Failed to convert file to base64'));
            }
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
    });
};

export const uploadToCubedweb = async (
    file: File,
    hangarName: string
): Promise<{ success: boolean; hangarUrl?: string; error?: string }> => {
    const PUBLIC_KEY = import.meta.env.VITE_CUBEDWEB_PUBLIC_KEY || '';
    const BASE_URL = 'https://frontiers.cubedweb.net';

    // Validate file size (50MB limit to be safe)
    const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB in bytes
    if (file.size > MAX_FILE_SIZE) {
        return {
            success: false,
            error: `File size (${(file.size / 1024 / 1024).toFixed(1)}MB) exceeds the maximum allowed size of 50MB`,
        };
    }

    try {
        // Step 1: Authenticate to get token
        const authResponse = await fetch(`${BASE_URL}/api/authenticate`, {
            method: 'POST',
            headers: {
                'X-Auth-Token': PUBLIC_KEY,
                'Content-Type': 'application/json',
            },
        });

        if (!authResponse.ok) {
            throw new Error(`Authentication failed: ${authResponse.statusText}`);
        }

        const authData: CubedwebAuthResponse = await authResponse.json();
        const token = authData.token;

        // Step 2: Convert file to base64 using a more efficient method for large files
        let base64Data: string;
        try {
            base64Data = await fileToBase64(file);
        } catch (error) {
            throw new Error(
                `Failed to convert file to base64: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
        }

        // Step 3: Upload hangar data
        const timestamp = Date.now();
        const hangarResponse = await fetch(`${BASE_URL}/api/hangars`, {
            method: 'POST',
            headers: {
                'X-Auth-Token': PUBLIC_KEY,
                'X-Auth-Signature': token,
                'X-Auth-Timestamp': timestamp.toString(),
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                name: hangarName,
                data: base64Data,
            }),
        });

        if (!hangarResponse.ok) {
            throw new Error(`Upload failed: ${hangarResponse.statusText}`);
        }

        const hangarData: CubedwebHangarResponse = await hangarResponse.json();

        if (hangarData.status === 'success') {
            return {
                success: true,
                hangarUrl: hangarData.hangarUrl,
            };
        } else {
            throw new Error('Upload was not successful');
        }
    } catch (error) {
        console.error('Error uploading to cubedweb:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred',
        };
    }
};
