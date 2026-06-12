# OAuth Callback Specification

## Purpose

Define OAuth callback handling for provider sign-in and post-auth redirects.

## Requirements

### Requirement: OAuth Session Exchange

The system MUST provide an OAuth callback route that exchanges provider callback parameters for a Supabase session.

#### Scenario: Successful OAuth callback

- GIVEN a user returns from a supported OAuth provider
- WHEN the callback contains a valid authorization code
- THEN the system exchanges it for a session
- AND redirects the user to the requested `next` destination or default app route

#### Scenario: OAuth callback failure

- GIVEN a user returns from an OAuth provider with an error or invalid code
- WHEN the callback is processed
- THEN the system redirects to login with a safe human-readable error

### Requirement: Redirect Safety

The system MUST prevent open redirects from OAuth callback and auth redirects.

#### Scenario: External next URL rejected

- GIVEN the callback includes an external `next` URL
- WHEN the callback validates the redirect target
- THEN the system ignores the external target
- AND redirects to the default app route

### Requirement: Provider Error Mapping

The system SHOULD map provider and Supabase OAuth errors to stable user-facing messages.

#### Scenario: Provider denies access

- GIVEN the provider returns an access-denied error
- WHEN the callback handles it
- THEN the user sees a clear message that sign-in was cancelled or denied
