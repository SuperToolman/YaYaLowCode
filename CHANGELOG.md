# Changelog

All notable changes to this project will be documented in this file.

## 2026-06-26

### Added

- Added Rust backend based on Axum and SeaORM for apps, forms, schemas, versions, navigation, and form records.
- Added PostgreSQL-backed dynamic form schema storage and form record persistence.
- Added automatic frontend API client generation with `@hey-api/openapi-ts` before `pnpm dev`.
- Added MyApp application card actions including open, enable/disable, rename, settings entry, and delete flow.
- Added application-level form navigation with built-in system pages.
- Added grouped navigation with recursive form/group structure and drag-based ordering.
- Added form designer workbench with:
  - outline tree
  - component palette
  - data sources panel
  - unified action editor
  - schema source viewer
- Added Monaco-based action editor for unified lifecycle and event scripting.
- Added form preview modal powered by the runtime renderer.
- Added runtime form pages with built-in submit/data views and drawer-based record creation.
- Added form schema version history, publish, and restore capabilities.

### Changed

- Reworked designer workbench into a compact icon-only left rail with resizable content panel.
- Replaced several native or ad hoc UI interactions with HeroUI-based components.
- Simplified action editing flow by auto-syncing code before preview/save/publish.
- Updated preview/runtime execution path to share a single runtime form renderer.
- Optimized designer header layout, version restore interaction, and contextual controls.

### Fixed

- Fixed multiple nested button hydration issues in navigation and action menus.
- Fixed incorrect form navigation behavior and routing back to the wrong page.
- Fixed preview update loops that caused `Maximum update depth exceeded`.
- Fixed duplicate debug event key collisions in preview logs.
- Reduced unnecessary runtime remounts by removing `JSON.stringify(...)` keys in preview/runtime wrappers.
- Fixed multiple layout and indentation issues in the form navigation sidebar.

## Notes

- Runtime pages use published schema by default.
- Designer preview uses draft schema by default.
