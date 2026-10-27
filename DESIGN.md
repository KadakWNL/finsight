---
name: FinSight
description: Themed transaction investigation workspace with a square sidebar selection.
colors:
  primary: "#7c3aed"
  primary-foreground: "#ffffff"
  ring: "#7c3aed"
  selection: "#e5e5e5"
  background: "#ffffff"
  foreground: "#0f0f0f"
  surface: "#ffffff"
  surface-muted: "#f2f2f2"
  surface-hover: "#e5e5e5"
  secondary-text: "#606060"
  subtle-text: "#707070"
  border: "#dedede"
  control-border: "#898989"
  notice: "#f5f3ff"
  notice-error: "#fff4e5"
  error-text: "#963b17"
  error-line: "#c76b2b"
  dark-primary: "#a78bfa"
  dark-primary-foreground: "#160c2d"
  dark-ring: "#a78bfa"
  dark-selection: "#272727"
  dark-background: "#0f0f0f"
  dark-foreground: "#f1f1f1"
  dark-surface: "#181818"
  dark-surface-muted: "#222222"
  dark-surface-hover: "#303030"
  dark-secondary-text: "#aaaaaa"
  dark-subtle-text: "#9b9b9b"
  dark-border: "#333333"
  dark-control-border: "#6f6f6f"
  dark-notice: "#211b30"
  dark-notice-error: "#3a2d20"
  dark-error-text: "#f8bf8a"
  dark-error-line: "#e9ab70"
typography:
  display:
    fontFamily: "IBM Plex Sans, Segoe UI, system-ui, sans-serif"
    fontSize: "44px"
    fontWeight: 650
    lineHeight: 1.15
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "IBM Plex Sans, Segoe UI, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.03em"
  title:
    fontFamily: "IBM Plex Sans, Segoe UI, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 650
    lineHeight: 1.4
  body:
    fontFamily: "IBM Plex Sans, Segoe UI, system-ui, sans-serif"
    fontSize: "15px"
    lineHeight: 1.5
  label:
    fontFamily: "IBM Plex Sans, Segoe UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
  identifier:
    fontFamily: "ui-monospace, monospace"
    fontSize: "12px"
rounded:
  navigation: "0"
  badge: "4px"
  control: "5px"
  button: "0.375rem"
  notice: "6px"
  panel: "8px"
spacing:
  compact: "8px"
  control-gap: "12px"
  group-gap: "16px"
  inset: "20px"
  panel: "24px"
  header: "32px"
  workspace: "40px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.button}"
    padding: "0.5rem 1rem"
  button-primary-dark:
    backgroundColor: "{colors.dark-primary}"
    textColor: "{colors.dark-primary-foreground}"
    rounded: "{rounded.button}"
    padding: "0.5rem 1rem"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.button}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  navigation-active:
    backgroundColor: "{colors.selection}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.navigation}"
    padding: "10px 12px"
  navigation-active-dark:
    backgroundColor: "{colors.dark-selection}"
    textColor: "{colors.dark-foreground}"
    rounded: "{rounded.navigation}"
    padding: "10px 12px"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.panel}"
  status-label:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.secondary-text}"
    rounded: "{rounded.badge}"
    padding: "3px 7px"
  theme-switch:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.secondary-text}"
    rounded: "{rounded.control}"
    width: "44px"
    height: "44px"
---

# Design System: FinSight

## Overview

This design record describes the implemented UI in [globals.css](src/app/globals.css), [layout.tsx](src/app/layout.tsx), and the [workspace shell](src/components/workspace/app-shell.tsx). The user accepted this visual direction on 2026-10-27; its scope is recorded in [PRODUCT.md](PRODUCT.md#user-commitments).

The transaction workspace uses violet accents, bordered work panels and a persistent desktop sidebar. Light and dark modes share layout and component shapes. No brand metaphor has been established.

**Key Characteristics:**

- Square active sidebar items with a filled selection surface.
- Theme-aware neutral surfaces with violet action and focus colors.
- Tables, masked context and recorded evidence lead the workspace.
- IBM Plex Sans supplies the shared text family.

## Colors

The frontmatter records the theme primitives from the stylesheet. Unprefixed names map to the light root properties; `dark-` names map to the corresponding properties under `data-theme=dark`.

The sidecar's tonal ramps are generated swatch previews. They do not define additional application colors.

### Primary

The primary violet colors identify links and primary actions. The selection colors fill active navigation items. The ring colors identify keyboard focus.

### Neutral

Background is the canvas; surface is the sidebar, header, panel and input fill. Muted and hover surfaces distinguish table headings, secondary content and interaction states. Secondary and subtle text separate supporting copy from record content. Control borders are stronger than panel dividers.

Notices and field errors use dedicated semantic colors. Risk badges have separate low, medium, high and critical palettes in both themes; their exact pairs remain in [globals.css](src/app/globals.css). Keep the written risk label alongside its color.

**The Theme Pair Rule.** Use the semantic CSS properties so a surface, its text and its border change together across themes.

## Typography

[layout.tsx](src/app/layout.tsx) loads the local variable IBM Plex Sans file with the `--font-plex` variable and a declared weight range of 100-700. The stylesheet uses Segoe UI and system sans fallbacks. Full identifiers use the separate monospace role.

The frontmatter records the sign-in display, page heading, panel title, body, field label and identifier roles. The sign-in display reduces to 30px at the small-screen breakpoint. Table content uses 14px text; metadata and table headings use 12px. Numeric amounts use tabular figures.

## Layout

The desktop sidebar is 216px expanded and 72px collapsed; the workspace body reserves the corresponding left margin. A button beside the brand toggles these states. It contains implemented navigation, role context and a Settings gear. The header contains the environment label, theme control and session actions.

Main content has a maximum width of 1480px and desktop padding of 40px. Repeated panel insets use the frontmatter spacing steps. Filters use four columns, reduce to two at 1200px, and become one at 480px. Detail content reduces from two columns to one at 900px.

At 800px and below, the sidebar hides and the body margin clears. A native disclosure menu presents the same destinations. Selecting a destination closes it. Transaction and work tables scroll within their containers, with minimum widths of 900px and 670px respectively.

The sign-in surface has two columns on larger screens and stacks at 600px. [globals.css](src/app/globals.css) owns all breakpoint values and overlapping media rules.

## Elevation & Depth

Work panels use tonal surfaces and thin borders. The native dialog carries the stylesheet's modal shadow and dark backdrop; its exact shadow is recorded in the sidecar. Sidebar selection has no shadow.

The loading indicator rotates continuously and stops under reduced-motion preferences. Other documented controls have no added motion treatment.

## Shapes

Navigation items have square corners, including the active fill. Controls and panels use the modest radii recorded in the frontmatter. The loading indicator remains circular.

**The Square Selection Rule.** Keep the sidebar and its square active item surface. Do not add a curved left active marker, a pill shape or an active-item shadow.

## Components

### Buttons

The shared [Button](src/components/ui/button.tsx) uses the primary color pair, medium text and a minimum height of 44px. Its disabled state blocks pointer events and reduces opacity. Secondary buttons use surface and foreground with a border, and gain the hover surface on pointer hover. Button links use the control radius and the same minimum height.

Keyboard focus uses a visible ring. The primary button has no distinct hover color in its current implementation; do not infer an additional shade from the palette.

### Inputs and fields

Text inputs, selects and textareas use a surface fill with a control border and the control radius. Their minimum height is 44px; textareas start at 120px. Native radio controls are 18px inside clickable choice rows at least 64px high, with a selected border and focus ring. Invalid inputs and selects use the error line. Disabled controls use the muted surface, while placeholders use subtle text.

### Panels and tables

Work panels clip their contents within the panel radius. Headings and table rows use dividers. Table headings use muted surfaces, and body rows receive a muted fill on hover. Numeric values retain tabular alignment; long identifiers can wrap in disclosures.

### Status and risk labels

Status labels use a muted surface and supporting text. Risk labels pair their severity word with a colored fill and text. These small labels use the badge radius, without changing the square navigation geometry.

### Navigation and theme switch

Expanded sidebar links pair an icon with a text label, subdued default text and a muted hover fill. Collapsed links keep accessible names and show labels on hover or keyboard focus. `aria-current=page` selects the full square item surface. The mobile menu exposes full labels in a bordered surface. [Workspace preferences](docs/discovery-ui.md#settings-and-display-preferences) document persistence and defaults.

The [theme switch](src/components/workspace/theme-switch.tsx) is a 44px square control with the control radius and an accessible action label. Initialization reads `finsight-theme` from local storage before rendering; without a valid stored choice it uses the system color preference.

The switch becomes available after client initialization and stores an explicit light or dark choice. System changes apply while no choice is stored, and storage events synchronize tabs. Storage failures leave the current in-memory toggle usable.

## Do's and Don'ts

- Do retain the desktop sidebar and the mobile menu for the implemented destinations.
- Do use semantic theme properties for component colors.
- Do retain visible keyboard focus and written risk labels.
- Do preserve scrollable tables and access to full identifiers.
- Don't add a curved left active marker or rounded active navigation items.
- Don't treat a risk color as a fraud verdict.
- Don't treat visual acceptance as proof of accessibility or workflow acceptance.
