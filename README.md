# Word Garden (Vite + Netlify) — build 20260217-230536

This package fixes the Babel inline-script syntax issues by using a proper Vite React build.

## Deploy
1) Push to GitHub
2) Netlify → Add new site → Import from Git
3) Set env vars in Netlify:
- ANTHROPIC_API_KEY
- WORDGARDEN_ADMIN_PASSWORD
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
4) Redeploy

## Admin
Progress → tap 🔒 3 times → enter password → Generate.

## Supabase
Run `supabase.sql` in Supabase SQL editor (creates `words`).
