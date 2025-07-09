interface CubedwebAuthResponse {
    token: string;
}

interface CubedwebHangarResponse {
    status: string;
    hangarUrl: string;
}

export const uploadToCubedweb = async (
    file: File,
    hangarName: string
): Promise<{ success: boolean; hangarUrl?: string; error?: string }> => {
    const PUBLIC_KEY = import.meta.env.CUBEDWEB_PUBLIC_KEY || '';
    const BASE_URL = 'http://frontiers.cubedweb.net';

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

        // Step 2: Convert file to base64
        const fileBuffer = await file.arrayBuffer();
        const base64Data = btoa(String.fromCharCode(...new Uint8Array(fileBuffer)));

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
