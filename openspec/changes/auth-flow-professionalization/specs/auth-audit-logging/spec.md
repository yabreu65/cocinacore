# Auth Audit Logging Specification

## Purpose

Define audit logging for security-sensitive authentication events.

## Requirements

### Requirement: Auth Event Recording

The system MUST record security-relevant auth events with actor, tenant, event type, timestamp, and safe metadata.

#### Scenario: Successful login recorded

- GIVEN a user signs in successfully
- WHEN authentication completes
- THEN an audit event is recorded with actor and tenant context

#### Scenario: Failed login recorded safely

- GIVEN a login attempt fails
- WHEN the failure is handled
- THEN an audit event is recorded without storing passwords, tokens, or secret values

### Requirement: Sensitive Flow Recording

The system MUST record password reset, MFA enrollment, MFA verification, invitation creation, and invitation acceptance events.

#### Scenario: Invitation accepted

- GIVEN an invitee accepts a valid invitation
- WHEN tenant membership is created
- THEN an audit event records inviter/invitee context where available

#### Scenario: MFA factor enrolled

- GIVEN a user successfully verifies a new MFA factor
- WHEN the factor becomes active
- THEN an audit event records MFA enrollment without storing factor secrets

### Requirement: Tenant-Scoped Audit Access

The system MUST protect audit logs with tenant and role boundaries.

#### Scenario: Tenant owner reads own audit events

- GIVEN an owner belongs to a tenant
- WHEN they request audit events for that tenant
- THEN only that tenant's allowed events are returned

#### Scenario: Cross-tenant audit access denied

- GIVEN a user belongs to tenant A
- WHEN they request tenant B audit events
- THEN access is denied
