// Supabase Edge Function to proxy MIMO API requests
// This avoids CORS issues by making the request server-side

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MIMO_API_URL = 'https://api.xiaomimimo.com/v1';
const MIMO_API_KEY = Deno.env.get('MIMO_API_KEY');

interface MimoRequest {
    model: string;
    messages: Array<{
        role: string;
        content: string;
    }>;
    max_completion_tokens?: number;
    temperature?: number;
    top_p?: number;
    stream?: boolean;
    response_format?: { type: string };
    thinking?: { type: string };
}

serve(async (req) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers':
                    'authorization, x-client-info, apikey, content-type',
            },
        });
    }

    // Only allow POST requests
    if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
            status: 405,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
        });
    }

    // Note: Supabase Edge Functions require authentication by default
    // The client should send Authorization: Bearer <anon-key> header
    // If you want to make this function public, you can remove this check
    // or configure it in Supabase dashboard

    // Check API key
    if (!MIMO_API_KEY) {
        return new Response(JSON.stringify({ error: 'MIMO_API_KEY not configured' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    try {
        // Parse request body
        const body: MimoRequest = await req.json();

        // Make request to MIMO API
        const response = await fetch(`${MIMO_API_URL}/chat/completions`, {
            method: 'POST',
            headers: {
                'api-key': MIMO_API_KEY,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });

        // Get response data
        const data = await response.json();

        // Return response with CORS headers
        return new Response(JSON.stringify(data), {
            status: response.status,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
        });
    } catch (error) {
        console.error('MIMO proxy error:', error);
        return new Response(
            JSON.stringify({
                error: 'Internal server error',
                message: error instanceof Error ? error.message : 'Unknown error',
            }),
            {
                status: 500,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                },
            }
        );
    }
});
