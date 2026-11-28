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

## Audit, 2026-11-20

Skill: `unslop:unslop`, Phase 2. The skill asks for a reviewer subagent as the last step; none was dispatched (this audit ran without subagents), so the fresh-eyes pass was done by the auditor directly from screenshots and the DOM.

### What was checked

- Browser: the Browser pane (Chromium) and headless Chrome through `render.mjs`. **Safari: not checked.**
- Sizes: 1440x900 and 390x844 for all 19 states (setup 5, room 9, report 5); the render tier also ran at 375 and 1280.
- Schemes: light and dark for setup, report and the flow map; the room is dark by design. Room captions were also checked over the light placeholder (`?bg=light`).
- Mechanical: `rules.mjs check` on draft/ (css, html, js), `render.mjs` (overflow, focus ring, state stability, motion at rest, contrast from pixels, tap targets, readable text, broken images, script errors). No em dashes, exclamation marks, "TODO" or lorem in any text. No company or product names after the fix below.
- By hand: Tab through each screen (visible 2px ring on every stop, including the radio cards through `:has`), M and E on the room screen, the `@supports not selector(:has(*))` fallback, the ending-state progress bar, caption contrast over both placeholders.

### Findings

| # | Finding | Rule | Fix or reason kept |
|---|---|---|---|
| 1 | Header, draft bar and state-link anchors were 18 to 23px tall at 375 (34 FAILs) | RSP-2 | Fixed: `display: inline-block; padding: 4px 0` on those links (26px hit area, no layout change). 0 FAIL after. |
| 2 | Raw hex `#3b3d40` for placeholder text on the light backdrop | LAY-16 | Fixed: token `--on-place-light` (#33363a, about 8:1 on the light placeholder). |
| 3 | Room placeholder text named a company product ("Marble scene") | project constraint 6 | Fixed: now "placeholder for the 3D scene". |
| 4 | Room banners hugged the left edge while captions and controls sat in a centred 760px column | LAY-10 | Fixed: banners use the same 760px centred column. |
| 5 | Room loading showed "04:12 of 10:00, question 2 of 5" before the session had started | CPY-7 | Fixed: loading shows "00:00 of 10:00, not started". |
| 6 | Pressing M in the mic-denied state replaced "Mic blocked" with "Mic off"; Mute stayed live while ending | STA-1 | Fixed: Mute is disabled in `mic-denied` and `ending`, and the M shortcut respects that. |
| 7 | The "Interviewer" marker had a bright 2px border, so it read as a button | CMP-6 | Fixed: border is the hairline colour; accent border only while the interviewer speaks (colour only, width never changes). |
| 8 | `.visually-hidden` spans were measured 57 to 64px off the screen edge | LAY-12 | Fixed the position (`left: 0; top: 0`). The remaining "-1px" WARN on 7 spans is the 1px clipped text; kept, it is invisible by design and not a real overflow. |
| 9 | `.choice input { opacity: 0 }` flagged by MOT-6 | MOT-6 | Kept: it is a native radio overlaid on its own card, not a reveal that waits for a script. Without `:has()` support the `@supports` fallback shows the native radio. |

### Unchecked items from the builder, now checked

- `@supports not selector(:has(*))` fallback: checked by forcing the fallback rule on in the pane. Native radios show and the checked card still reads as selected by the radio itself. In the compact rows (style, length) the radio sits above the label text, which is plain but usable. Kept.
- M and E: M toggles Mute and the mic text, E moves to the ending state and disables End. Both are ignored with Ctrl, Cmd or Alt held and while focus is in a form field.
- Ending progress bar with no value: shows the browser's indeterminate bar, has an accessible name, and the banner says what is happening in words. Kept. It animates only while the state is active (native control).
- Caption contrast over light and dark placeholders: `render.mjs` reads the pixels behind the glyphs; 0 FAIL on both at 1440. The captions sit on a solid 90% scrim, no blur.

### Content rules

- One filled button per view: setup has Start session; room has the filled button only in the three states that need an action (mic-denied, provider-error, ending); report has none filled (Play and Show more are outlined). Confirmed in screenshots.
- The report makes no hiring prediction (it states so) and the room screen shows no feedback while the interview runs (the interviewer only asks questions and follow-ups).
- No horizontal scroll at 390 in any state.

### Not checked

- Safari (cannot be driven here).
- Real screen reader output; real microphone or audio.
- The draft has no print styles; not in scope.
- Screenshots in `media/screens/` are the rendered full page at 1440 wide from `render.mjs`, light scheme (the room is dark).
