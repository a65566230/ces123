# V2 Acceptance And Legacy Contraction Design

## Goal

Prove that the V2-only workflow can handle the representative `songmid`, `vkey`, and high-noise scenarios well enough to support the next Legacy contraction decisions.

## Scope

This MVP covers:

- one explicit-field acceptance scenario (`songmid`-style)
- one derived-field acceptance scenario (`vkey`-style)
- one high-noise acceptance scenario
- workflow-only assertions using the V2 surface
- documentation updates that stop describing completed V2 capabilities as missing

This MVP does not cover:

- live third-party benchmark execution
- actual Legacy alias deletion
- full benchmark report generation

## Acceptance Strategy

### Scenario A: Explicit field

Use `flow.find-signature-path` on a script set where `songmid` is an explicit business field. The expected outcome is a stable top candidate and direct validation actions.

### Scenario B: Derived field

Use `flow.find-signature-path` on a script set where `vkey` is written as a derived/final field. The expected outcome is that V2 still surfaces dynamic validation actions such as function trace and interceptor recommendations.

### Scenario C: High noise

Use a noisy script set with common library URLs and one meaningful target script. The expected outcome is that V2 recommends noise-reduction actions such as `debug.blackbox(action: 'addCommon')` in addition to the existing trace/interceptor path.

## Architecture

Implement these as integration tests using the V2 runtime only. Patch the session script inventory inputs in test scope rather than introducing complex new fixtures.

For the high-noise scenario, extend `flow.find-signature-path` recommendation generation to add a `debug.blackbox` recommendation when the script universe clearly contains common-library noise.

## Success Criteria

- V2-only tests cover the three representative scenarios
- high-noise scenarios recommend `debug.blackbox`
- migration docs no longer describe completed V2 capability work as missing
