# Password Reset Specification

## Purpose

Define forgot-password and reset-password behavior for Supabase-backed authentication.

## Requirements

### Requirement: Forgot Password Request

The system MUST provide a public forgot-password flow that sends a Supabase recovery email without revealing whether an email exists.

#### Scenario: Request reset email

- GIVEN a visitor is on the forgot-password page
- WHEN they submit a syntactically valid email
- THEN the system displays a neutral success message
- AND the response does not reveal account existence

#### Scenario: Invalid email input

- GIVEN a visitor enters an invalid email
- WHEN they submit the form
- THEN the system shows a validation error before requesting reset delivery

### Requirement: Reset Password Completion

The system MUST provide a reset-password flow that accepts a valid recovery session and updates the password.

#### Scenario: Valid recovery session

- GIVEN a user opened a valid recovery link
- WHEN they submit a password meeting policy
- THEN the password is updated
- AND the user is redirected to login or app with clear next action

#### Scenario: Expired or invalid recovery session

- GIVEN the recovery link is expired or invalid
- WHEN the reset page loads or submit is attempted
- THEN the system shows a safe recovery error
- AND offers a path to request a new reset email

### Requirement: Password Reset Abuse Protection

The system MUST rate-limit password reset requests per email and source identity.

#### Scenario: Too many reset attempts

- GIVEN repeated reset attempts exceed the configured limit
- WHEN another request is submitted
- THEN the system rejects the request with a safe rate-limit message
