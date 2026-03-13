# Browser Captcha Design

## Goal

Add a first-class V2 `browser.captcha` tool that groups captcha detection, wait, and config behavior behind the browser surface.

## Scope

This MVP covers:

- `action: detect | wait | config`
- per-session config state
- AI detector reuse with fallback behavior

This MVP does not cover:

- solver integration
- automatic headless/headed switching
- captcha-specific fixtures

## API Shape

Inputs:

- `sessionId`
- `action: 'detect' | 'wait' | 'config'`
- optional `timeout`
- optional config fields:
  - `autoDetectCaptcha`
  - `autoSwitchHeadless`
  - `captchaTimeout`

Outputs:

- detect: `captchaDetected` and `captchaInfo`
- wait: completion result
- config: effective session config

## Architecture

Create an `AICaptchaDetector` from the session LLM on demand. Store config on the session object so `config` and `wait` share the same timeout defaults within one session.

Keep `browser.captcha` as an expert/legacy helper because it is a reachability gate, not a workflow-first default.

## Testing

Integration:

- config round-trip
- detect on the basic fixture returning `false`
- wait on a no-captcha page returning `true`

Unit:

- catalog presence
- core profile exclusion
