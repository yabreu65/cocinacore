# Engineering Standards Specification

## Purpose
Define non-negotiable engineering quality gates for CocinaCore MVP.

## Requirements

### Requirement: No unsafe any
The codebase MUST treat `@typescript-eslint/no-explicit-any` as an error and MUST NOT use unsafe `any` at trust boundaries.

#### Scenario: Explicit any introduced
- GIVEN a developer adds `any` to TypeScript code
- WHEN lint runs
- THEN lint MUST fail

#### Scenario: External data typed safely
- GIVEN data comes from an external API or database
- WHEN code consumes it
- THEN it MUST be narrowed with `unknown`, schemas, generated types, or DTOs

### Requirement: Typed boundaries
The system SHOULD use generated DB types, domain DTOs, typed external clients, typed API responses, and schema validation for untrusted input.

#### Scenario: RPC result mapping
- GIVEN a Supabase RPC response is received
- WHEN it is mapped into domain objects
- THEN the mapper SHALL use a declared response type and validation/narrowing

### Requirement: Secret safety
Server secrets MUST NOT be exposed through `NEXT_PUBLIC` variables or client bundles.

#### Scenario: AI key access
- GIVEN recipe generation needs an AI key
- WHEN the client requests generation
- THEN the key SHALL only be used server-side

### Requirement: Validation gates
Implementation MUST pass lint, typecheck, build, tests, and security/RLS tests before merge.

#### Scenario: Gate failure blocks merge
- GIVEN lint, typecheck, build, test, or RLS proof fails
- WHEN a change is reviewed
- THEN it MUST NOT be considered merge-ready

### Requirement: RLS proof
Multi-tenant reads/writes MUST include tests proving allowed same-tenant access and denied cross-tenant access.

#### Scenario: Cross-tenant write denied
- GIVEN Tenant A user attempts to write Tenant B row
- WHEN RLS tests run
- THEN the write MUST be denied
