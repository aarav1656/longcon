# DESIGN.md: Long Con

Source: Hallmark catalog theme **Grid** (editorial genre), signal ink **red**. Swiss neo-grotesk sheet: exposed 12-column hairline grid, one family, one ink, geometry for marks, zero cards.

## Brief
- Audience: a hackathon judge or player who has two minutes and no wallet.
- Primary job of the screen: pitch a merchant and see exactly what the road allowed, and why.
- Tone: technical, austere. A ledger kept by a road authority.

## Tokens (theme layer, `web/src/style.css`)
| Token | Value |
|---|---|
| `--color-paper` | `oklch(99% 0.003 255)` |
| `--color-paper-2` | `oklch(97.2% 0.003 255)` |
| `--color-paper-3` | `oklch(94.5% 0.004 255)` |
| `--color-ink` | `oklch(16% 0.010 255)` |
| `--color-muted` | `oklch(46% 0.010 255)` |
| `--color-rule` | `oklch(88% 0.004 255)` |
| `--color-signal` | `oklch(55% 0.21 28)` (the only accent; `--color-focus` is the same) |

## Type
Archivo only (self-hosted via `@fontsource-variable/archivo`). Display 800 lowercase, tracking -0.045em, line-height 0.9, `clamp(52px, 10.5vw, 136px)` for the one plate, smaller steps elsewhere. Body 400 16px/1.5. Label voice 600 12px uppercase tracking 0.09em in `--color-muted`. Tabular figures on every number.

## Spacing and shape
4px base: 4, 8, 12, 16, 24, 32, 48, 80. Radius 0. No shadow. No gradient. Depth is hairlines, a 2px ink rule over each band, and the single plate.

## Marks
Period square, stepped bars (data-ful: loss cap used, credit cap used), border arrow (caravan), register mark. Every mark rides a column track.

## Motion
Hover: row ground to `paper-2`, title nudges 8px, 0.18s ease. The thinking clock steps in whole seconds. `prefers-reduced-motion: reduce` removes all transitions.

## Committed, refused and timed-out marks share one ink
Committed: solid period square. Refused: hollow period square. Timed out: dashed square. Words always accompany the mark.
