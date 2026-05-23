# RAG PDF Library Specification

## Purpose
Define secure PDF library behavior and RAG retrieval boundaries.

## Requirements

### Requirement: PDF ownership
PDFs MUST be private to a tenant by default; global SaaS PDFs SHALL be readable by all tenants.

#### Scenario: Tenant PDF private
- GIVEN Tenant A uploaded a private PDF
- WHEN Tenant B searches PDFs
- THEN Tenant A PDF chunks MUST NOT be returned

#### Scenario: Global PDF readable
- GIVEN a global PDF exists
- WHEN any authenticated tenant searches
- THEN matching global chunks SHALL be eligible

### Requirement: Global PDF management
Only Platform Owner MUST be able to create or delete global SaaS PDFs.

#### Scenario: Tenant admin denied global delete
- GIVEN a tenant Admin is authenticated
- WHEN they delete a global PDF
- THEN the operation MUST be denied

### Requirement: Upload limits
Home tenants MUST be limited to 5 PDFs; Professional tenants MUST be limited to 15 PDFs.

#### Scenario: Home limit reached
- GIVEN a Home tenant already has 5 PDFs
- WHEN a member uploads another PDF
- THEN the upload MUST be rejected

#### Scenario: Professional upload allowed
- GIVEN a Professional tenant has 14 PDFs
- WHEN a member uploads one PDF
- THEN the upload SHALL succeed

### Requirement: Retrieval scope
RAG retrieval MUST search global chunks and current tenant private chunks only.

#### Scenario: Scoped retrieval
- GIVEN Tenant A and Tenant B both have private PDFs
- WHEN Tenant A searches
- THEN results SHALL include global and Tenant A chunks only

### Requirement: Source citation
Generated or searched recipes MUST cite source as global PDF, tenant PDF, or AI-generated.

#### Scenario: Cited PDF result
- GIVEN a recipe uses retrieved chunks
- WHEN the result is saved
- THEN each cited source SHALL include source type and PDF reference
