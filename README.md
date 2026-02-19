# Word Garden — screenshot-matching UI + daily challenge + weak words + parent mode (build 20260218-004941)

## What’s included
- Header matches your HTML: **Garden** is light green + italic.
- Home screen: Start Learning, View Progress, Daily Challenge, Weak words.
- Learning flow matches screenshots:
  - Word card (definition, Swedish, example) + US/GB speech buttons
  - “I’m ready — test me →”
  - “Choose the correct definition” screen
- Progress screen matches screenshot sections:
  - Overall + per-level progress bars
  - Placement history
  - Word-by-word list with US/GB buttons + confidence dot
- Daily challenge (5 questions/day) with “🌸 Bloomed!” reward
- Weak word mode (practices words you struggle with)
- Leveling logic improved (70% mastered + 65% accuracy + 10 attempted)
- Parent mode screen (simple local gate) + server-checked generation

## Netlify env vars
- ANTHROPIC_API_KEY
- WORDGARDEN_ADMIN_PASSWORD
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
- (optional) ANTHROPIC_MODEL = claude-sonnet-4-6

## Notes
- Parent gate is local-only (hides controls from kids). Generation still checks server-side password.


## Progress sync across devices (Supabase)
This build stores *words* in Supabase (as before) and also optionally stores *progress* in Supabase so it can be shared across iPhone/iPad.

1) Run the updated `supabase.sql` (it creates `progress_sync` table).
2) Deploy to Netlify with `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.
3) In the app: Progress → Parent mode → set a **Sync code** (e.g. WG-ABC123) on device A.
4) On device B: enter the same Sync code. Progress will sync.

Security note: anyone who knows the Sync code can read/write that progress. Keep it private (treat it like a password).
