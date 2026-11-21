# Unslop notes, round one (constraints)

Run before drawing anything (spec AC-19). Skill: `unslop:unslop`, Phase 1, 2026-11-20.
Audit round (Phase 2) runs again before phase 1 sign-off.

## Constraints taken from the skill (Phase 1)

Floor rules are never waived. (R) marks a reflex rule that may be waived in a comment with evidence.

- Effects: no gradients on text or controls, no indigo to violet, no glassmorphism, no blurred orbs, no glow or colored shadows, no pure black on pure white, no blob shapes, no cream-paper default. Secondary text is tinted from its surface.
- Type: one declared family stack and a short scale (7 sizes or fewer, none under 12px). No eyebrows, no tracked-caps labels, no italic-serif accents, no blanket tight tracking. Heading levels in order, each a visible step from the next. Measure 75ch at most, body leading 1.4 or more. Monospace only for data.
- Layout: no card in a card. Separate with spacing, then hairline, then tint, then card. Radii and gaps from the scale only. No three-equal-cards reflex (R), no stat strips, no section numbers, no hero metric, no default dashboard shell. One element visibly dominant. More space above a heading than below. 16px gutter at 375px. Hover, focus and selection never move layout.
- Components: no colored left-border strips, no icon in a tinted tile above a heading, no sparkle or "AI" badges. Every control does something or is labelled as not connected. One filled control per view.
- Icons: none unless they do a job. No emoji in chrome.
- Motion: only on state change, never `transition: all`, transform and opacity only, `prefers-reduced-motion` guard. Nothing hidden at rest.
- Copy: verb plus object labels. No "Get started", "Learn more", no elevate, unlock, seamless. No exclamation marks, no cheerleading, no invented numbers, names or quotes. No middle-dot meta strings, no arrows glued to links, no status dots, no filler people.
- States: empty, loading, error and populated all designed. Visible focus on everything interactive. AA contrast in both themes. Never colour alone. Semantic elements. Accessible names. No broken image, no script error.
- Responsive: check at 375px (draft target 390px): no horizontal scroll, tap targets 24px or more (44px for the start action).

## Project constraints (this repo)

1. The room view is the hero of the room screen. Nothing competes with it: controls sit at the edges and stay small.
2. Captions are legible over a splat background: a solid scrim behind caption text (no blur), 4.5:1 contrast or better, large enough to read at arm's length.
3. The report is text first. Quoted lines from the transcript are the content. No charts unless there are four or more real data points, and no score ring.
4. No stock gradients and no decorative icons. An icon appears only when it names a state the user must act on (mic muted, recording). Everything else is words.
5. Calm tone for a nervous user: plain short sentences, no encouragement, no grades, no exclamation marks, no em dashes.
6. All draft content is invented. No real company, person or question bank.
7. Setup works at 390px and by keyboard alone.
8. Start is the single filled control on setup. Retry, links and the state links are outlined or plain.

## Decisions (type, color, space)

- Family: system UI stack. No web font, no CDN.
- Scale: 0.8125rem, 0.9375rem, 1.0625rem (body), 1.25rem, 1.75rem. Five sizes.
- Color: one accent (deep blue) plus one signal (brick red, errors only), over neutrals. Dark mode flips the same tokens.
- Space: 8px unit, steps 4, 8, 16, 24, 40, 64.
- Radius: 6px for controls and cards, nothing else. No shadows at all.
