# Skill Registry

**Delegator use only.** Any agent that launches sub-agents reads this registry to resolve compact rules, then injects them directly into sub-agent prompts. Sub-agents do NOT read this registry or individual SKILL.md files.

See `_shared/skill-resolver.md` for the full resolution protocol.

## User Skills

| Trigger | Skill | Path |
| --- | --- | --- |
| creating, opening, or preparing PRs for review. | branch-pr | /Users/yoryiabreu/.codex/skills/branch-pr/SKILL.md |
| PRs over 400 lines, stacked PRs, review slices. Split oversized changes into chained PRs that protect review focus. | chained-pr | /Users/yoryiabreu/.codex/skills/chained-pr/SKILL.md |
| writing guides, READMEs, RFCs, onboarding, architecture, or review-facing docs. | cognitive-doc-design | /Users/yoryiabreu/.codex/skills/cognitive-doc-design/SKILL.md |
| PR feedback, issue replies, reviews, Slack messages, or GitHub comments. | comment-writer | /Users/yoryiabreu/.codex/skills/comment-writer/SKILL.md |
| Docker containerization expert with deep knowledge of multi-stage builds, image optimization, container security, Docker Compose orchestration, and production deployment patterns. Use PROACTIVELY f... | docker-expert | /Users/yoryiabreu/.agents/skills/docker-expert/SKILL.md |
| — | e2e-testing | /Users/yoryiabreu/.codex/skills/e2e-testing/SKILL.md |
| Helps users discover and install agent skills when they ask questions like "how do I do X", "find a skill for X", "is there a skill that can...", or express interest in extending capabilities. This skill should be used when the user is looking for functionality that might exist as an installable skill. | find-skills | /Users/yoryiabreu/.agents/skills/find-skills/SKILL.md |
| — | frontend-feature | /Users/yoryiabreu/.codex/skills/frontend-feature/SKILL.md |
| Go tests, go test coverage, Bubbletea teatest, golden files. Apply focused Go testing patterns. | go-testing | /Users/yoryiabreu/.codex/skills/go-testing/SKILL.md |
| Generate or edit raster images when the task benefits from AI-created bitmap visuals such as photos, illustrations, textures, sprites, mockups, or transparent-background cutouts. Use when Codex should create a brand-new image, transform an existing image, or derive visual variants from references, and the output should be a bitmap asset rather than repo-native code or vector. Do not use when the task is better handled by editing existing SVG/vector/code-native assets, extending an established icon or logo system, or building the visual directly in HTML/CSS/canvas. | imagegen | /Users/yoryiabreu/.codex/skills/.system/imagegen/SKILL.md |
| creating GitHub issues, bug reports, or feature requests. | issue-creation | /Users/yoryiabreu/.codex/skills/issue-creation/SKILL.md |
| judgment day, dual review, adversarial review, juzgar. Run blind dual review, fix confirmed issues, then re-judge. | judgment-day | /Users/yoryiabreu/.codex/skills/judgment-day/SKILL.md |
| — | migration-guide | /Users/yoryiabreu/.codex/skills/migration-guide/SKILL.md |
| — | nestjs-service | /Users/yoryiabreu/.codex/skills/nestjs-service/SKILL.md |
| Use when the user asks how to build with OpenAI products or APIs and needs up-to-date official documentation with citations, help choosing the latest model for a use case, or model upgrade and prompt-upgrade guidance; prioritize OpenAI docs MCP tools, use bundled references only as helper context, and restrict any fallback browsing to official OpenAI domains. | openai-docs | /Users/yoryiabreu/.codex/skills/.system/openai-docs/SKILL.md |
| Create and scaffold plugin directories for Codex with a required `.codex-plugin/plugin.json`, optional plugin folders/files, valid manifest defaults, and personal-marketplace entries by default. Use when Codex needs to create a new personal plugin, add optional plugin structure, or generate or update marketplace entries for plugin ordering and availability metadata. | plugin-creator | /Users/yoryiabreu/.codex/skills/.system/plugin-creator/SKILL.md |
| — | prisma-model | /Users/yoryiabreu/.codex/skills/prisma-model/SKILL.md |
| — | security | /Users/yoryiabreu/.codex/skills/security/SKILL.md |
| new skills, agent instructions, documenting AI usage patterns. Create LLM-first skills with valid frontmatter. | skill-creator | /Users/yoryiabreu/.codex/skills/skill-creator/SKILL.md |
| Install Codex skills into $CODEX_HOME/skills from a curated list or a GitHub repo path. Use when a user asks to list installable skills, install a curated skill, or install a skill from another repo (including private repos). | skill-installer | /Users/yoryiabreu/.codex/skills/.system/skill-installer/SKILL.md |
| implementation, commit splitting, chained PRs, or keeping tests and docs with code. | work-unit-commits | /Users/yoryiabreu/.codex/skills/work-unit-commits/SKILL.md |

## Compact Rules

Pre-digested rules per skill. Delegators copy matching blocks into sub-agent prompts as `## Project Standards (auto-resolved)`.

### branch-pr

- Check for existing related issues before opening a PR; create/link an issue when needed.
- Keep PRs reviewable and intentional; avoid bundling unrelated changes.
- Use conventional commits; never add AI attribution or Co-Authored-By.
- Include concise rationale, testing evidence, and risk notes in PR descriptions.
- Prefer draft PRs until validation and review readiness are clear.

### chained-pr

- Use when a diff is likely over ~400 lines or spans independent review slices.
- Split changes by dependency order; each PR should be independently understandable.
- Keep tests/docs with the code slice they validate.
- Document stack order and what reviewers should review in each slice.
- Do not split changes that would force reviewers to reconstruct one atomic behavior across PRs.

### cognitive-doc-design

- Optimize docs for reader decision-making, not exhaustive dumping.
- Start with the problem, current state, and action the reader should take.
- Use progressive disclosure: summary first, details only where they reduce ambiguity.
- Prefer concrete examples and diagrams for architecture or workflows.
- Remove duplicated context and stale background unless it changes implementation choices.

### comment-writer

- Be warm, direct, and specific; avoid performative praise.
- State the actionable change and the reason it matters.
- Separate blockers from suggestions; do not over-escalate preferences.
- Use concise language suitable for GitHub/Slack comments.
- When disagreeing, explain the technical tradeoff and propose a path forward.

### docker-expert

- Use multi-stage builds and cache-friendly layer ordering.
- Pin runtime dependencies where reproducibility matters; avoid shipping dev tooling.
- Run as non-root in production images when possible.
- Keep secrets out of images and Compose files; use env injection or secret stores.
- Add healthchecks and explicit ports/volumes only when they reflect runtime behavior.

### e2e-testing

- Prefer user-visible flows and stable selectors over implementation details.
- Keep E2E tests deterministic; control auth, data setup, and network state.
- Capture traces/screenshots on failure when supported.
- Avoid broad sleeps; wait for semantic UI states or network completion.
- Separate smoke coverage from exhaustive edge-case testing.

### find-skills

- Use only when the user is asking to discover/install capabilities.
- Search existing installed skills before suggesting new ones.
- Recommend a skill only when it directly maps to the user’s task.
- Do not install or suggest adjacent tools without explicit user intent.
- Keep discovery concise and action-oriented.

### frontend-feature

- Read local framework/version instructions before editing frontend code.
- Prefer component boundaries that separate stateful containers from presentational UI.
- Keep UI copy consistent with existing product language.
- Validate with lint/typecheck/build and browser smoke checks when relevant.
- Avoid adding dependencies for simple UI behavior without a clear tradeoff.

### go-testing

- Use table-driven tests for pure logic and focused cases.
- Keep golden files intentional and provide update workflow.
- Prefer integration tests only where boundaries matter.
- Run targeted `go test` first, then package/all tests when risk warrants.
- Make failures diagnose behavior, not implementation details.

### imagegen

- Use the image generation tool for bitmap generation/editing requests.
- Do not use image generation for repo-native SVG/code assets when editing source is better.
- For edits, preserve user-provided image identity unless asked otherwise.
- Do not add download chatter after generating images.
- Refuse unsafe image requests and offer a clearly different safe alternative.

### issue-creation

- Check for existing related issues before creating a new one.
- Write issues with problem, impact, acceptance criteria, and validation notes.
- Keep scope narrow enough for one reviewable work unit.
- Label risks/dependencies when known.
- Do not create tracker clutter for vague ideas without clarifying outcome.

### judgment-day

- Run adversarial review from fresh context before declaring readiness.
- Separate confirmed defects from speculative improvements.
- Fix confirmed issues, then re-review the resulting diff.
- Prioritize correctness, tests, security, and reviewability over style nits.
- Report residual risks explicitly.

### migration-guide

- Identify source and target versions before proposing migration steps.
- Prefer official migration docs and changelogs for breaking changes.
- Sequence changes to keep the app buildable between steps where possible.
- Call out config, runtime, dependency, and API-level breakages separately.
- Validate with the project’s real test/build commands.

### nestjs-service

- Keep NestJS modules/services/controllers separated by responsibility.
- Validate DTOs at boundaries; avoid leaking persistence models into API contracts.
- Use dependency injection for external services and repositories.
- Test service logic independently from transport when possible.
- Keep transaction and auth boundaries explicit.

### openai-docs

- Use official OpenAI docs as the primary source for API/model guidance.
- Browse official sources when version/model/current behavior matters.
- Cite docs links for user-facing technical claims.
- Do not rely on stale memory for latest models, pricing, or API syntax.
- Keep implementation advice aligned with current SDK/docs.

### plugin-creator

- Create plugins with required `.codex-plugin/plugin.json` manifest.
- Prefer personal marketplace entries by default unless the user says otherwise.
- Keep manifest defaults valid and minimal.
- Add optional folders/files only when requested or needed.
- Do not invent unavailable plugin capabilities.

### prisma-model

- Model relations and constraints explicitly; avoid relying on application-only integrity.
- Plan migrations for safe data evolution, especially required fields.
- Keep generated client usage behind repository/service boundaries where possible.
- Validate indexes for query patterns, not just schema aesthetics.
- Run format/generate/migrate checks when touching Prisma schema.

### security

- Treat auth, secrets, tenant isolation, and injection surfaces as high-risk.
- Prefer deny-by-default access rules and explicit authorization checks.
- Do not expose server secrets through NEXT_PUBLIC or client bundles.
- Validate inputs at trust boundaries and avoid `any` around external data.
- For RLS/multi-tenant systems, prove tenant scoping on every read/write path.

### skill-creator

- Skills are runtime instruction contracts, not long human docs.
- Use concise frontmatter with trigger-first description.
- Include Activation Contract, Hard Rules, Decision Gates, Execution Steps, Output Contract, and References.
- Move large examples/schemas to local references instead of bloating SKILL.md.
- Make rules observable and testable.

### skill-installer

- Install only skills the user explicitly asks for or approves.
- Prefer curated skill names or explicit GitHub repo paths.
- Verify install location under CODEX_HOME skills.
- Do not replace existing skills without preserving or confirming changes.
- Summarize installed skill name, path, and trigger.

### work-unit-commits

- Plan commits as reviewable units with one coherent behavior per commit.
- Keep tests/docs with the code they validate.
- Use conventional commit messages only; never add AI attribution.
- Avoid mixing refactors with behavior changes unless necessary.
- Before committing, inspect diff and ensure no unrelated edits are included.

## Project Conventions

| File | Path | Notes |
| --- | --- | --- |
| AGENTS.md | /Users/yoryiabreu/proyectos/cocinacore/frontend/AGENTS.md | Frontend rule: Next.js version may have breaking changes; read relevant `node_modules/next/dist/docs/` docs before writing frontend code. |
| CLAUDE.md | /Users/yoryiabreu/proyectos/cocinacore/frontend/CLAUDE.md | Index file referencing `AGENTS.md`. |

Read the convention files listed above for project-specific patterns and rules. All referenced paths have been extracted — no need to read index files to discover more.
