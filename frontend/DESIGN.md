# Design system: « Registre »

Internal tool of a French officine. The people using it are pharmacists and preparers at a back-office
PC or a tablet, between two patients: they open a fiche, fill it, and leave. The interface must read
like a well-kept register: calm, dense but legible, nothing that competes with the form itself.
Color, radius and elevation tokens are CSS variables defined in `src/index.css`; the type scale and
spacing are Tailwind v4's default theme variables (`--text-*`, `--spacing`), emitted by
`@import "tailwindcss"` in that file and deliberately not redefined. Components use the semantic Tailwind names
(`bg-background`, `text-muted-foreground`, …), never raw colors.

## Direction

- **Domain**: officine, préparatoire, ordonnancier (register), paraphe (initials), étiquette, flacon ambré, blouse.
- **Signature**: the green pharmacy cross (brand mark, `components/Brand.tsx`) and the **paraphe**:
  a profile's initials stamped in a ring of its color (`Paraphe` in `components/ProfileSwitcher.tsx`).
  Reuse the paraphe wherever a profile appears (header, owner badge, profile cards); the ring keeps the
  initials legible whatever color the admin picks (text stays `foreground`).
- **Rejected defaults**: neutral grey shadcn palette → green-tinted "blouse" neutrals and blue-black ink;
  Geist/Inter → Atkinson Hyperlegible Next; sidebar app → a single header with register-tab navigation.
- Color is scarce: the green (`primary`) marks the primary action, the current nav tab, focus and success.
  Everything else is ink on paper.

## Color (light « officine » / dark « nuit de garde »)

| Role (CSS var) | Name | Light | Dark | Use |
|---|---|---|---|---|
| `--background` | blouse | `oklch(0.985 0.004 165)` | `oklch(0.185 0.014 245)` | page |
| `--card` / `--popover` | papier | `oklch(1 0 0)` | `0.22` / `0.245` same hue | raised surfaces |
| `--foreground` | encre | `oklch(0.25 0.025 255)` | `oklch(0.95 0.006 165)` | text |
| `--muted-foreground` | encre douce | `oklch(0.5 0.02 255)` | `oklch(0.73 0.015 245)` | secondary text |
| `--muted` / `--secondary` | carrelage | `oklch(0.955 0.008 165)` | `oklch(0.26 0.014 245)` | quiet fills |
| `--accent` | menthe | `oklch(0.94 0.025 165)` | `oklch(0.28 0.02 200)` | hover, selected |
| `--primary` / `--ring` / `--success` | croix | `oklch(0.5 0.105 162)` | `oklch(0.76 0.12 162)` | main action, focus |
| `--destructive` | rouge | `oklch(0.54 0.19 27)` | `oklch(0.71 0.16 25)` | errors, delete |
| `--warning` / `--warning-surface` | ambre | `oklch(0.52 0.11 65)` / `0.97 0.03 85` | `0.8 0.12 80` / `0.26 0.03 80` | caution |
| `--border` | filet | `oklch(0.9 0.008 165)` | `white / 10%` | dividers, cards |
| `--input` | bord de champ | `oklch(0.64 0.015 255)` | `oklch(0.52 0.015 245)` | control outlines |

Contrast (computed, WCAG 2.1): text ≥ 4.5:1 everywhere (encre/blouse 15.3, encre douce/blouse 5.7,
croix/blanc 5.5, rouge/blanc 5.6; dark ≥ 6.2); control outlines ≥ 3:1 (1.4.11: 3.4 light, 3.1 dark).
Check new pairs before adding them.

## Type

- One family, self-hosted: **Atkinson Hyperlegible Next** (`@fontsource-variable/atkinson-hyperlegible-next`),
  drawn for character distinction (0/O, 1/l/I): references, dosages and initials read without doubt.
  Fallback `system-ui`. No network font.
- Scale (Tailwind steps, ≈ 1.2 ratio, 14 px body): caption `text-xs` 12 · body `text-sm` 14 ·
  lead `text-base` 16 · h3 `text-lg` 18 · h2 `text-xl` 20 · h1 `text-2xl` 24.
- Hierarchy by weight before size: 600 titles, 500 labels/nav, 400 body; `text-muted-foreground` for meta.
- Page h1: `text-2xl font-semibold tracking-tight` (`components/PageHeader.tsx`). Headings balance-wrap.
- `tabular-nums` on every changing number (references `10-2026-123`, dates, counters).
- French copy, sentence case, no-break space before `:` `;` `?` `!`.

## Spacing, radius, elevation

- 4 px base (Tailwind `--spacing`). Controls 32 px high (`h-8`), primary submit 36 px (`size="lg"`).
  Card padding 16 px (nova default), page gutter 16 px (tablet) / 24 px (`md:`), 24 px under the page header.
  Content max width `max-w-6xl` (1152 px); forms `max-w-lg`.
- Radius `--radius` 0.5rem: `rounded-lg` 8 px buttons/inputs, `rounded-xl` 11 px cards, `rounded-md` paraphe.
- Elevation: borders only (filet). Exception: the login card uses
  `shadow-overlay` (`--elevation-overlay`: 1 px ink ring + soft drop; ring only in dark); shadcn overlays keep their own shadow.

## Interactive states

- Hover: `bg-muted` / `bg-accent` tint, nav text goes from encre douce to encre.
- Selected: nav tab `aria-current=page` → encre text + 2 px croix underline; toggle `data-state=on`
  → menthe fill, croix text, 1 px croix inset ring (edited in `components/ui/toggle.tsx`).
- Focus: `focus-visible` 3 px ring `ring-ring/50` + ring-colored border; never removed.
- Disabled: 50 % opacity, no pointer. Invalid: `aria-invalid` + `data-invalid` on `Field` → rouge border and label.
- Pressed: `translate-y-px` (shadcn nova). Theme changes are instant (`disableTransitionOnChange`).

## Shell and slots (for U10–U12)

- `src/router.tsx`: every route and guard (`RequireAuth`, `RequireRole allow=…`, `RequireProfile`). Fill your
  page component; do not move paths. Placeholders use `PagePlaceholder`; replace its body with yours, keep
  `PageHeader` for the h1.
- `src/components/ProfileSwitcher.tsx`: header slot for the user account (U10 replaces the file, keeps the
  `ProfileSwitcher` export). `src/components/nav.ts`: header links per role.
- Toasts: `toast` from `sonner` (`<Toaster>` mounted in `main.tsx`). The API client already toasts 403s.
- Empty and status screens: shadcn `Empty`; full-page messages: `StatusPage`.
- Known gap: shadcn v4 components assume React 19 (ref as a prop); under React 18 a `ref` on `Input` etc. is
  dropped. Use ids for focus, or react-hook-form `Controller` (not `register`) until the component forwards refs.
