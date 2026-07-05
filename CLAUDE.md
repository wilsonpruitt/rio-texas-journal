@AGENTS.md

## TODO: Vercel Web Analytics (free on Hobby — flip on)
This project collects zero page-view data today. Next session that touches this project:
1. Vercel dashboard → this project → Analytics tab → Enable.
2. Add the snippet — static HTML: `<script defer src="/_vercel/insights/script.js"></script>` in `<head>` (in the BUILD TEMPLATE if pages are generated); Next.js: same tag in the root layout.
3. Deploy, verify tag on the live site, then DELETE this section.
Pattern proven on acta/bonaventure 2026-07-03 — details in memory `reference_vercel-hobby-analytics`.
