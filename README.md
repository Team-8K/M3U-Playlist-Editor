# Team 8K — Body-Only Playlist Editor

Standalone, fully-editable export of the Team 8K M3U Playlist Editor.
This build has **no site header and no site footer** — it is meant to be
embedded inside your own custom template (e.g. a Netlify subdomain page).

You own this code 100%. Nothing is locked. Edit, rebuild and deploy
anywhere you like.

## Stack

- Vite 5 + React 18 + TypeScript 5
- Tailwind CSS 3 + shadcn/ui components
- React Router 6
- 100% client-side (no backend, no telemetry)

## Run locally

```bash
npm install     # or: pnpm install / bun install
npm run dev     # http://localhost:8080
```

## Build for production

```bash
npm run build   # outputs to ./dist
```

Deploy the `dist/` folder to Netlify, Vercel, Cloudflare Pages, S3,
GitHub Pages — anywhere that serves static files.

The included `netlify.toml` already configures SPA fallback for React Router.

## Embedding in a custom template

The editor renders as a single React app mounted on `<div id="root">`
(see `index.html`). Two integration patterns:

### A) Use the whole app

Build it (`npm run build`) and drop `dist/` inside your template route,
e.g. `/editor/`. Make sure your host serves `index.html` for unknown
sub-paths (Netlify/Vercel do this automatically; Apache/Nginx need a
rewrite rule).

### B) Mount inside an existing page

Add a container to your template HTML:

```html
<div id="team8k-editor"></div>
```

Then in `src/main.tsx` change the mount target:

```ts
createRoot(document.getElementById("team8k-editor")!).render(<App />);
```

Build, then include the generated `dist/assets/*.js` and `*.css` from
your template page.

## File map

```
src/
├── pages/Index.tsx          ← Main editor page (body only)
├── components/
│   ├── LoaderPanel.tsx      ← Tabbed file/url/text loader
│   ├── CategoryGroup.tsx    ← Collapsible channel group
│   ├── SummarySidebar.tsx   ← Left stats sidebar
│   └── ui/                  ← shadcn primitives
├── lib/m3u.ts               ← M3U parser/exporter/dedupe
├── index.css                ← Design tokens + global styles
└── main.tsx                 ← App entry point
```

## Customising the look

All theme tokens live in `src/index.css` (`:root { --primary: ... }`)
and `tailwind.config.ts`. Change those once and the whole UI follows.

## License

Yours. Do whatever you want with it.
