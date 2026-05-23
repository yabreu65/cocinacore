# Auth RBAC Trial Specification

## Purpose
Define identity, role, invitation, and trial behavior for the MVP.

## Requirements

### Requirement: Authentication methods
The system MUST support email/password and Google OAuth sign-in.

#### Scenario: Email password login
- GIVEN valid email/password credentials
- WHEN the user signs in
- THEN the system SHALL create an authenticated session

#### Scenario: Google OAuth login
- GIVEN a valid Google OAuth response
- WHEN the user signs in
- THEN no additional in-app 2FA SHALL be required

### Requirement: Role-based access
The system MUST enforce Owner, Admin, and Member permissions per tenant.

#### Scenario: Admin manages members
- GIVEN an Admin belongs to a tenant
- WHEN they invite a user
- THEN the invitation SHALL be created for that tenant

#### Scenario: Member cannot manage roles
- GIVEN a Member is authenticated
- WHEN they attempt to change another member's role
- THEN the operation MUST be denied

### Requirement: Two-factor policy
Email/password users with Owner or Admin role MUST complete 2FA; Members MAY enable 2FA.

#### Scenario: Owner missing 2FA
- GIVEN an Owner uses email/password and has not enrolled 2FA
- WHEN they access the app
- THEN the system MUST require 2FA enrollment before privileged use

### Requirement: Invitations
Tenant invitations MUST last 30 days and accepted invitees SHALL become Members.

#### Scenario: Valid invite accepted
- GIVEN an invitation is less than 30 days old
- WHEN the invitee accepts
- THEN they SHALL become a Member of that tenant

#### Scenario: Expired invite rejected
- GIVEN an invitation is older than 30 days
- WHEN it is accepted
- THEN the system MUST reject it

### Requirement: Trial soft block
Each tenant SHALL have a 14-day trial; after expiry users MAY login and view data but MUST NOT generate recipes or upload PDFs.

#### Scenario: Expired trial view allowed
- GIVEN a tenant trial expired
- WHEN a member views existing recipes
- THEN the data SHALL be visible

#### Scenario: Expired trial write blocked
- GIVEN a tenant trial expired
- WHEN a member generates a recipe or uploads a PDF
- THEN the operation MUST be blocked
