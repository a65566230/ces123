# Browser Stealth Design

## Goal

Add a first-class V2 `browser.stealth` tool that applies anti-detection initialization scripts and realistic platform user-agent behavior to a Playwright-backed session.

## Scope

This MVP covers:

- `action: apply`
- optional `platform: windows | mac | linux`
- stealth init script injection
- realistic user-agent override

This MVP does not cover:

- per-script toggles
- launch-argument mutation after session creation
- stealth diagnostics scoring

## API Shape

Inputs:

- `sessionId`
- `action: 'apply'`
- `platform?: 'windows' | 'mac' | 'linux'`

Outputs:

- `action`
- `platform`
- `applied`

## Architecture

Reuse `StealthScripts2025.injectAll()` and `StealthScripts2025.setRealisticUserAgent()`. Apply these to the current Playwright page before subsequent navigations so the init scripts take effect on the next document.

Keep `browser.stealth` as an expert/legacy helper because it is a site-reachability capability, not a workflow-first default.

## Testing

Integration:

- apply stealth before navigation
- navigate to the fixture page
- confirm `navigator.webdriver` is hidden and vendor/user agent shaping is present

Unit:

- catalog presence
- core profile exclusion
