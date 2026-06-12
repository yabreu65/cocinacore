# MFA Enrollment Specification

## Purpose

Define MFA enrollment, verification, and enforcement for privileged users.

## Requirements

### Requirement: TOTP Enrollment

The system MUST allow authenticated users with owner or admin role to enroll a TOTP factor using Supabase MFA.

#### Scenario: User enrolls TOTP

- GIVEN an authenticated eligible user opens MFA setup
- WHEN they request enrollment
- THEN the system displays a QR code or secret
- AND asks for a verification code before activating the factor

#### Scenario: Invalid enrollment code

- GIVEN an enrollment challenge is active
- WHEN the user submits an invalid TOTP code
- THEN the system keeps the factor unverified
- AND shows a safe retry message

### Requirement: Privileged Role Enforcement

The system MUST require verified MFA for owner/admin access when the user's role is owner or admin and the account uses password-based authentication.

#### Scenario: Owner without verified MFA

- GIVEN an authenticated owner has not completed MFA
- WHEN they access a privileged route
- THEN the system redirects to MFA enrollment or verification

#### Scenario: Owner with verified MFA

- GIVEN an authenticated owner has verified MFA assurance
- WHEN they access a privileged route
- THEN the system allows the request to continue

#### Scenario: Admin without verified MFA

- GIVEN an authenticated admin has not completed MFA
- WHEN they access a privileged route
- THEN the system redirects to MFA enrollment or verification

#### Scenario: Admin with verified MFA

- GIVEN an authenticated admin has verified MFA assurance
- WHEN they access a privileged route
- THEN the system allows the request to continue

#### Scenario: OAuth privileged user

- GIVEN an authenticated owner/admin uses an OAuth provider and policy does not require password-based MFA
- WHEN they access a privileged route
- THEN the system does not require TOTP enrollment for that request

### Requirement: MFA Backup Codes

The system MUST generate one-time backup codes after successful MFA enrollment and MUST invalidate each code after use. Successful backup-code verification MUST satisfy the same privileged-route MFA gate as TOTP verification for the current session.

#### Scenario: Backup codes generated after enrollment

- GIVEN a user successfully verifies a new TOTP factor
- WHEN enrollment completes
- THEN the system displays backup codes once
- AND stores only a non-reversible representation

#### Scenario: Backup code used once

- GIVEN a user has an unused backup code
- WHEN they verify MFA with that backup code
- THEN access is allowed
- AND the backup code cannot be used again

#### Scenario: Backup code rejected by guards after failure

- GIVEN a user submits an invalid or already-used backup code
- WHEN privileged-route guards evaluate MFA status
- THEN the user remains blocked from privileged access

#### Scenario: Backup codes regenerated

- GIVEN a user is authenticated with verified MFA
- WHEN they regenerate backup codes
- THEN old backup codes are invalidated
- AND new backup codes are displayed once

### Requirement: MFA Recovery UX

The system SHOULD provide recovery guidance that directs the user to backup-code verification or support when MFA verification fails or the factor is unavailable.

#### Scenario: MFA unavailable

- GIVEN a privileged user cannot complete MFA
- WHEN they attempt access
- THEN the system explains the recovery path without exposing security-sensitive details
