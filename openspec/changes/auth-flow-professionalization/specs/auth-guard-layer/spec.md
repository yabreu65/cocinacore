# Auth Guard Layer Specification

## Purpose

Define centralized auth state, route protection, validation, and auth-specific rate limiting.

## Requirements

### Requirement: Centralized Auth State

The system MUST expose a centralized auth layer with session, user, tenant, role, loading, and MFA state.

#### Scenario: Auth state available to pages

- GIVEN an authenticated user opens a protected page
- WHEN the page reads auth state
- THEN it receives the current user, tenant, role, and loading status from one shared source

#### Scenario: Session changes

- GIVEN Supabase auth state changes
- WHEN the session is refreshed, signed in, or signed out
- THEN the centralized auth state updates consistently

### Requirement: Route Guard Enforcement

The system MUST enforce route guards for authentication, tenant membership, role, and MFA before showing protected content.

#### Scenario: Unauthenticated protected route

- GIVEN no valid session exists
- WHEN a protected route is requested
- THEN the user is redirected to login with a safe `next` value

#### Scenario: Insufficient role for owner route

- GIVEN an authenticated non-owner requests an owner route
- WHEN guards evaluate the request
- THEN access is denied before privileged content is displayed

### Requirement: Auth Form Validation and Errors

The system MUST validate auth form inputs and map backend errors to safe user-facing messages.

#### Scenario: Invalid login payload

- GIVEN a login form has invalid email or missing password
- WHEN submitted
- THEN validation errors are shown without calling the auth provider

#### Scenario: Backend auth error

- GIVEN Supabase returns an auth error
- WHEN the UI displays feedback
- THEN the message is stable, localized, and does not reveal sensitive internals

### Requirement: Auth Rate Limiting

The system MUST rate-limit login, signup, password reset, and invitation acceptance attempts at a server-controlled boundary before calling the external auth provider or mutating tenant membership.

#### Scenario: Login limit exceeded

- GIVEN repeated failed login attempts exceed the configured threshold
- WHEN another login is submitted
- THEN the system blocks the attempt temporarily with a safe message

#### Scenario: Signup limit exceeded

- GIVEN repeated signup attempts exceed the configured threshold for the same source identity
- WHEN another signup is submitted
- THEN the system blocks the attempt temporarily with a safe message

#### Scenario: Invitation acceptance limit exceeded

- GIVEN repeated invitation acceptance attempts exceed the configured threshold
- WHEN another invitation acceptance is submitted
- THEN the system blocks the attempt temporarily with a safe message
