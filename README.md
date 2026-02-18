# Word Garden — Practice + Placement + Word list (build 20260218-000818)

This build adds:
- Home screen with Placement Test (like your screenshot)
- Placement test (10 questions)
- Practice session (8 words/day, mixed new + review) with:
  - multiple choice
  - type from definition
  - fill in blank
  - Swedish → English
- Word list screen (search + grouped by level)

## Netlify env vars
- ANTHROPIC_API_KEY
- WORDGARDEN_ADMIN_PASSWORD
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
- (optional) ANTHROPIC_MODEL = claude-sonnet-4-6

## Deploy
Push to GitHub and Netlify will build automatically.
