# Security Tenancy Specification

## Purpose
Define tenant isolation and platform administration for CocinaCore's shared-database SaaS MVP.

## Requirements

### Requirement: Tenant isolation
The system MUST store tenant-owned data with `tenant_id` and MUST enforce tenant scoping on every read and write.

#### Scenario: Member reads tenant data
- GIVEN a Member belongs to Tenant A
- WHEN they request Tenant A recipe history
- THEN only Tenant A rows SHALL be returned

#### Scenario: Cross-tenant read is denied
- GIVEN a Member belongs to Tenant A
- WHEN they request Tenant B private data
- THEN the request MUST return no Tenant B rows

### Requirement: Deny-by-default RLS
The database MUST enable RLS for tenant-owned tables and SHALL only permit access through explicit policies.

#### Scenario: Missing policy denies access
- GIVEN a table has RLS enabled and no matching policy
- WHEN an authenticated user queries it
- THEN PostgreSQL MUST deny access

### Requirement: Platform Owner separation
The system MUST distinguish Platform Owner from tenant Owner/Admin/Member roles.

#### Scenario: Platform Owner manages global settings
- GIVEN a user has Platform Owner privileges
- WHEN they manage global SaaS content
- THEN the operation SHALL be allowed without making them a tenant member

#### Scenario: Tenant Owner cannot manage platform data
- GIVEN a tenant Owner is not Platform Owner
- WHEN they attempt platform-only management
- THEN the operation MUST be denied

### Requirement: Tenant type
Each tenant MUST be classified as Home or Professional at signup and SHALL preserve that type for plan limits and AI routing.

#### Scenario: Signup selects tenant type
- GIVEN a new tenant signs up
- WHEN they choose Home or Professional
- THEN the tenant record MUST store that type

#### Scenario: Invalid tenant type rejected
- GIVEN a signup request has an unknown tenant type
- WHEN it is submitted
- THEN the system MUST reject it
