# Invitation Security Specification

## Purpose

Define secure tenant invitation tokens and delivery behavior.

## Requirements

### Requirement: Secure Invitation Tokens

The system MUST generate cryptographically strong invitation tokens and MUST NOT expose predictable token material.

#### Scenario: Invitation created

- GIVEN an owner/admin invites a member
- WHEN the invitation is created
- THEN the token is random and unguessable
- AND only a safe token representation is stored or compared

#### Scenario: Expired invitation

- GIVEN an invitation is expired
- WHEN the invitee attempts acceptance
- THEN the system rejects the invitation with a safe message

### Requirement: Invitation Email Delivery

The system SHOULD send invitation emails through the configured production email provider or Supabase-supported delivery path.

#### Scenario: Invitation email sent

- GIVEN an invitation is created with a valid email
- WHEN delivery is configured
- THEN the invitee receives a link containing the invitation token

#### Scenario: Email delivery unavailable

- GIVEN delivery is not configured
- WHEN an invitation is created
- THEN the system provides a safe manual-link fallback for authorized inviters only

### Requirement: Invitation Acceptance Boundaries

The system MUST enforce email, tenant, expiry, and single-use constraints during invitation acceptance.

#### Scenario: Valid invitation accepted

- GIVEN an invitee opens a valid unused invitation
- WHEN they authenticate and accept
- THEN membership is created for the invitation tenant and role
- AND the invitation becomes used

#### Scenario: Reused invitation rejected

- GIVEN an invitation was already accepted or revoked
- WHEN it is submitted again
- THEN acceptance is denied
