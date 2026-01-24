# MIMO Proxy Edge Function

This Supabase Edge Function proxies requests to the MIMO API to avoid CORS issues.

## Setup Instructions

### 1. Link your Supabase project

```bash
npx supabase link --project-ref your-project-ref
```

To find your project reference:
- Go to your Supabase dashboard
- The project ref is in the URL: `https://app.supabase.com/project/<project-ref>`
- Or check Settings > General > Reference ID

### 2. Set the MIMO API key as a secret

```bash
npx supabase secrets set MIMO_API_KEY=your_mimo_api_key_here
```

### 3. Deploy the function

```bash
npx supabase functions deploy mimo-proxy
```

### 4. Get your function URL

After deployment, your function will be available at:
```
https://<project-ref>.supabase.co/functions/v1/mimo-proxy
```

### 5. Set environment variable

Add to your `.env` file:
```bash
VITE_MIMO_PROXY_URL=https://<project-ref>.supabase.co/functions/v1/mimo-proxy
```

Replace `<project-ref>` with your actual Supabase project reference.

## Testing

You can test the function locally (requires Docker):

```bash
npx supabase functions serve mimo-proxy
```

Then test with:
```bash
curl -X POST http://localhost:54321/functions/v1/mimo-proxy \
  -H "Content-Type: application/json" \
  -d '{"model":"mimo-v2-flash","messages":[{"role":"user","content":"test"}]}'
```

## Notes

- The function handles CORS automatically
- Your MIMO API key is stored securely as a Supabase secret
- The function forwards all request parameters to the MIMO API

