#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
node - "$ROOT" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const root = process.argv[2];
const runnerPath = path.join(root, 'scripts/test-culinary-profile-connected-e2e.sh');
const fail = (message) => {
  console.error(`culinary profile connected E2E contract failure: ${message}`);
  process.exit(1);
};

if (!fs.existsSync(runnerPath)) {
  fail('isolated connected-profile E2E runner is missing');
}
const runner = fs.readFileSync(runnerPath, 'utf8');
const stripShellComments = (source) => {
  let result = '';
  let quote = '';
  let escaped = false;
  let comment = false;
  for (const char of source) {
    if (comment) {
      if (char === '\n') {
        result += char;
        comment = false;
      }
      continue;
    }
    if (escaped) {
      result += char;
      escaped = false;
      continue;
    }
    if (char === '\\' && quote !== "'") {
      result += char;
      escaped = true;
      continue;
    }
    if (quote) {
      result += char;
      if (char === quote) quote = '';
    } else if (char === "'" || char === '"') {
      quote = char;
      result += char;
    } else if (char === '#' && (result.length === 0 || /\s/.test(result.at(-1)))) {
      comment = true;
    } else {
      result += char;
    }
  }
  return result;
};
const executable = stripShellComments(runner);
const has = (pattern) => pattern.test(runner);
const hasExecutable = (pattern) => pattern.test(executable);

const selectorStart = executable.indexOf('TARGET=');
const firstSideEffect = Math.min(...[
  executable.indexOf('trap cleanup EXIT'),
  executable.indexOf('mktemp -d'),
  executable.indexOf('image inspect'),
  executable.indexOf('container ls'),
].filter((index) => index >= 0));
if (!/TARGET=\$\{1-profile\}/.test(executable) ||
    !/profile\)\s+PLAYWRIGHT_SPEC='e2e\/specs\/culinary-profile-connected\.spec\.ts'/.test(executable) ||
    !/today\)\s+PLAYWRIGHT_SPEC='e2e\/specs\/today-recommendations-connected\.spec\.ts'/.test(executable) ||
    !/meal-planner\)\s+PLAYWRIGHT_SPEC='e2e\/specs\/meal-planner-connected\.spec\.ts'/.test(executable) ||
    selectorStart < 0 || selectorStart >= firstSideEffect ||
    !/\$#/.test(executable.slice(0, firstSideEffect)) ||
    !/case\s+"\$TARGET"/.test(executable.slice(0, firstSideEffect)) ||
    !/\*\)[\s\S]{0,250}(?:exit\s+[1-9]|fail\s+)/.test(executable.slice(0, firstSideEffect))) {
  fail('runner must default to M1 profile, map explicit today and meal-planner selectors to their exact specs, and reject unknown/extra selectors before side effects');
}
const wrapperPath = path.join(root, 'scripts/test-culinary-profile-today-connected-e2e.sh');
if (!fs.existsSync(wrapperPath)) fail('dedicated M2.2 connected E2E wrapper is missing');
const wrapper = fs.readFileSync(wrapperPath, 'utf8');
if (!/ROOT=\$\(CDPATH=\s*cd\s+--\s+"\$\(dirname\s+--\s+"\$0"\)\/\.\."\s+&&\s+pwd\)/.test(wrapper) ||
    !/exec\s+bash\s+"\$ROOT\/scripts\/test-culinary-profile-connected-e2e\.sh"\s+today/.test(wrapper) ||
    /\$@|\$\*/.test(wrapper) || !/\$#/.test(wrapper) ||
    !/(?:-ne\s+0|!=\s+0)/.test(wrapper)) {
  fail('M2.2 wrapper must resolve the repository root, select only today, and reject extra arguments');
}
const mealPlannerWrapperPath = path.join(root, 'scripts/test-culinary-profile-meal-planner-connected-e2e.sh');
if (!fs.existsSync(mealPlannerWrapperPath)) fail('dedicated meal-planner connected E2E wrapper is missing');
const mealPlannerWrapper = fs.readFileSync(mealPlannerWrapperPath, 'utf8');
if (!/ROOT=\$\(CDPATH=\s*cd\s+--\s+"\$\(dirname\s+--\s+"\$0"\)\/\.\."\s+&&\s+pwd\)/.test(mealPlannerWrapper) ||
    !/exec\s+bash\s+"\$ROOT\/scripts\/test-culinary-profile-connected-e2e\.sh"\s+meal-planner/.test(mealPlannerWrapper) ||
    /\$@|\$\*/.test(mealPlannerWrapper) || !/\$#/.test(mealPlannerWrapper) ||
    !/(?:-ne\s+0|!=\s+0)/.test(mealPlannerWrapper)) {
  fail('meal-planner wrapper must resolve the repository root, select only meal-planner, and reject every argument');
}
const playwrightInvocation = executable.split('\n').find((line) => /playwright test/.test(line)) || '';
if (!/playwright test\s+"?\$PLAYWRIGHT_SPEC"?/.test(playwrightInvocation) ||
    /playwright test\s+e2e\/specs\//.test(playwrightInvocation)) {
  fail('Playwright must receive only the selected exact allowlisted spec');
}
if (!/\benv\s+(?=[^\n]*\bplaywright test\b)(?=[^\n]*-u\s+E2E_USER_EMAIL\b)(?=[^\n]*-u\s+E2E_USER_PASSWORD\b)[^\n]*\bplaywright test\s+"?\$PLAYWRIGHT_SPEC"?/.test(playwrightInvocation)) {
  fail('isolated Playwright invocation must unset inherited E2E_USER_EMAIL and E2E_USER_PASSWORD');
}

// The runner may name .env files only in exclusion rules, never as input or dotenv configuration.
if (/(?:dotenv\/config|dotenv\.config|--env-file)/i.test(runner) ||
    /(?:^|\n\s*|[;&|]\s*)(?:source|\.)\s+["']?[^;\n]*\.env/i.test(runner) ||
    /(?:^|\n\s*|[;&|]\s*)(?:cat|head|tail|less|more)\s+["']?[^;\n]*\.env/i.test(runner) ||
    /(?:readFileSync|readFile|createReadStream|openSync)\s*\(\s*["'`][^"'`]*\.env/i.test(runner)) {
  fail('runner must not read or load any .env* file');
}
if (!has(/(?:--exclude(?:=|\s+)["']?\.env\*|--exclude=["']?\.env\*|\.env\*[^\n]*(?:exclude|ignore)|(?:exclude|ignore)[^\n]*\.env\*)/i) ||
    !has(/(?:--exclude(?:=|\s+)["']?\.git(?:\/\*|["'\s]|$)|\.git(?:\/\*)?[^\n]*(?:exclude|ignore)|(?:exclude|ignore)[^\n]*\.git)/i) ||
    !has(/(?:--exclude(?:=|\s+)["']?(?:\*\/)?node_modules(?:\/\*|["'\s]|$)|node_modules(?:\/\*)?[^\n]*(?:exclude|ignore)|(?:exclude|ignore)[^\n]*node_modules)/i) ||
    !has(/(?:--exclude(?:=|\s+)["']?(?:\*\/)?\.next(?:\/\*|["'\s]|$)|\.next(?:\/\*)?[^\n]*(?:exclude|ignore)|(?:exclude|ignore)[^\n]*\.next)/i)) {
  fail('sanitized source copy must exclude .env*, .git, node_modules, and .next');
}
if (hasExecutable(/(?:\bnpm\s+(?:install|i|ci|add|update|upgrade)\b|\bnpx\b|\bdocker\s+pull\b|\bcompose\s+pull\b|--pull(?:\s+|=)(?!never\b)(?:always|missing)\b)/i) ||
    !has(/--pull=never/)) {
  fail('runner must not install, invoke npx, or pull images; every image start must use --pull=never');
}
for (const image of ['pgvector/pgvector:pg16', 'redis:7-alpine']) {
  if (!runner.includes(image)) fail(`runner must use the exact preinstalled image ${image}`);
}
if (!has(/image\s+inspect/) ||
    !has(/(?:PG_IMAGE|POSTGRES_IMAGE|DATABASE_IMAGE)[^\n]*pgvector\/pgvector:pg16/i) ||
    !has(/(?:REDIS_IMAGE|CACHE_IMAGE)[^\n]*redis:7-alpine/i)) {
  fail('runner must verify the exact preinstalled PostgreSQL and Redis images before starting containers');
}
const runStarts = [...runner.matchAll(/(?:docker|\$\{DOCKER\[@\]\})[^\n]*\brun\s+--pull=never[^\n]*/g)];
if (runStarts.length < 2) {
  fail('both database and Redis container starts must be statically guarded by --pull=never');
}
if (!has(/127\.0\.0\.1::5432/) || !has(/127\.0\.0\.1::6379/) ||
    !has(/(?:docker|\$\{DOCKER\[@\]\})[^\n]*port[\s\S]{0,500}127\.0\.0\.1/) ||
    !has(/(?:HOST_PORT|PG_PORT)[^\n]*(?:random|published|port)|(?:random|published|port)[^\n]*(?:HOST_PORT|PG_PORT)/i) ||
    !has(/(?:REDIS_HOST_PORT|HOST_REDIS_PORT|REDIS_PORT)[^\n]*(?:random|published|port)|(?:random|published|port)[^\n]*(?:REDIS_HOST_PORT|HOST_REDIS_PORT|REDIS_PORT)/i)) {
  fail('Postgres and Redis must use random host ports bound only to 127.0.0.1 and use their published ports');
}
if (!has(/--tmpfs[^\n]*\/(?:var\/lib\/postgresql\/data|var\/lib\/postgresql)/) ||
    !has(/--tmpfs[^\n]*\/data(?:[:,\s]|$)/)) {
  fail('Postgres data and Redis data must each be backed by tmpfs, not persistent storage');
}
if (!has(/COCINACORE_SKIP_DOTENV=1/) ||
    !has(/(?:env\s+[^\n]*|export\s+[^\n]*)COCINACORE_SKIP_DOTENV=1[\s\\]|COCINACORE_SKIP_DOTENV=1[^\n]*run-migrations\.js/)) {
  fail('migration execution must explicitly set COCINACORE_SKIP_DOTENV=1');
}
if (!has(/(?:DATABASE_URL|REDIS_URL|AUTH_SECRET)[^\n]*(?:local|127\.0\.0\.1|localhost)/i) ||
    !has(/COCINACORE_ISOLATED_E2E=1/) ||
    !has(/E2E_PROVIDER_PORT="\$PROVIDER_PORT"/) ||
    !has(/(?:GEMINI_BASE_URL|provider-server\.mjs)[^\n]*(?:127\.0\.0\.1|localhost)|(?:127\.0\.0\.1|localhost)[^\n]*(?:GEMINI_BASE_URL|provider-server\.mjs)/)) {
  fail('runner must provide synthetic local service credentials, matching local provider port, and guarded E2E opt-in');
}
if (!has(/culinary-profile-connected\.spec\.ts/) ||
    !has(/today-recommendations-connected\.spec\.ts/) ||
    !has(/meal-planner-connected\.spec\.ts/) ||
    !has(/playwright test "?\$PLAYWRIGHT_SPEC"?/)) {
  fail('runner must invoke only an exact guarded allowlisted connected spec');
}
const mealPlannerSpecPath = path.join(root, 'frontend/e2e/specs/meal-planner-connected.spec.ts');
if (!fs.existsSync(mealPlannerSpecPath)) fail('connected meal-planner spec is missing');
const mealPlannerSpec = fs.readFileSync(mealPlannerSpecPath, 'utf8');
const providerBase = mealPlannerSpec.match(
  /const\s+([A-Za-z_$][\w$]*)\s*=\s*`http:\/\/127\.0\.0\.1:\$\{process\.env\.E2E_PROVIDER_PORT\s*\?\?\s*['"]?4319['"]?\}`/,
);
if (!providerBase) {
  fail('meal-planner provider base must derive from E2E_PROVIDER_PORT with the 4319 local fallback');
}
const providerBaseName = providerBase[1].replace(/\$/g, '\\$');
for (const endpoint of ['requests', 'reset']) {
  const endpointPattern = new RegExp(
    'const\\s+[A-Za-z_$][\\w$]*\\s*=\\s*`\\$\\{' + providerBaseName + '\\}/__e2e/' + endpoint + '`',
  );
  if (!endpointPattern.test(mealPlannerSpec)) {
    fail(`meal-planner provider ${endpoint} URL must use the derived provider base and exact /__e2e/${endpoint} endpoint`);
  }
}
const sanitizerPath = path.join(root, 'scripts/lib/redact-diagnostic-stream.mjs');
if (!fs.existsSync(sanitizerPath) || !has(/redact-diagnostic-stream\.mjs/) ||
    !has(/(?:cp\s+-cR|physical[ -]copy|copy[ -]dependency[ -]tree)/i) ||
    !has(/package\.json/) || !has(/package-lock\.json/) ||
    !has(/shasum\s+-a\s+256/) ||
    !has(/PACKAGE_JSON_MATCH=YES/) || !has(/PACKAGE_LOCK_MATCH=YES/) ||
    !has(/WORKSPACE_EXISTS=YES/) || !has(/NODE_MODULES_EXISTS=YES/) ||
    !has(/NODE_MODULES_IS_SYMLINK=NO/) || !has(/NODE_MODULES_INSIDE_WORKSPACE=YES/) ||
    !has(/realpath/) ||
    !has(/case\s+"\$NODE_MODULES_REALPATH\//) ||
    has(/\bln\s+-s\b/) ||
    has(/printf[^\n]*(?:NODE_MODULES|node_modules)[^\n]*\$ROOT/)) {
  fail('external node_modules symlink defect: dependencies must be physically copied into the workspace, hash-matched, and realpath-contained');
}
if (!has(/playwright\.config\.ts/) ||
    !has(/(?:cp|install|copy|COPYFILE|copyFile|writeFile)[^\n]*playwright\.config\.ts/) ||
    !has(/(?:127\.0\.0\.1|localhost)/) ||
    !has(/(?:random|mktemp|\$RANDOM|randomUUID|port)[^\n]*(?:PORT|HOST|playwright|config)|(?:PORT|HOST|playwright|config)[^\n]*(?:random|mktemp|\$RANDOM|randomUUID|port)/i)) {
  fail('only a copied Playwright config may be patched, and its server/provider endpoints must use random loopback ports');
}
if (hasExecutable(/(?:sed\s+-i|perl\s+-pi|writeFile(?:Sync)?\s*\([^\n]*playwright\.config\.ts)/) &&
    !has(/(?:COPY_CONFIG|CONFIG_COPY|PLAYWRIGHT_CONFIG_COPY|TEMP_CONFIG|WORKSPACE)[^\n]*playwright\.config\.ts/i)) {
  fail('Playwright config modifications must target the temporary copied config, never the repository config');
}
if (!has(/trap[^\n]*(?:EXIT|INT|TERM)/) ||
    !has(/(?:docker|\$\{DOCKER\[@\]\})[^\n]*container\s+inspect/) ||
    !has(/(?:docker|\$\{DOCKER\[@\]\})[^\n]*container\s+ls/) ||
    !has(/(?:verified absent|removed and verified absent|absent after exact)/i) ||
    !has(/rm\s+-f[^\n]*(?:CONTAINER_ID|candidate_id|container_id)/) ||
    !has(/rm\s+-rf[^\n]*(?:WORKSPACE|TEMP|TMPDIR)/) ||
    !has(/(?:-e|!\s+-e)[^\n]*(?:WORKSPACE|TEMP|TMPDIR)/)) {
  fail('EXIT/signal cleanup must target exact owned container IDs and temporary copy, then verify both absent');
}
const instrumentedMarkers = [
  'M2_E2E_HARNESS_START', 'M2_E2E_POSTGRES_CONTAINER_CREATED', 'M2_E2E_REDIS_CONTAINER_CREATED',
  'M2_E2E_POSTGRES_ISOLATION_VERIFIED', 'M2_E2E_REDIS_ISOLATION_VERIFIED',
  'M2_E2E_POSTGRES_READY', 'M2_E2E_REDIS_READY', 'M2_E2E_MIGRATION_PROCESS_START',
  'M2_E2E_MIGRATION_PROCESS_EXIT', 'M2_E2E_PLAYWRIGHT_START', 'M2_E2E_PLAYWRIGHT_EXIT',
  'M2_E2E_CLEANUP_START', 'M2_E2E_CLEANUP_COMPLETE', 'POSTGRES_LOOPBACK=YES',
  'REDIS_LOOPBACK=YES', 'POSTGRES_TMPFS=YES', 'REDIS_TMPFS=YES',
  'POST_INVENTORY_MATCH=', 'ZERO_M2_TEST_GARBAGE=YES',
];
if (instrumentedMarkers.some((marker) => !runner.includes(marker)) ||
    !has(/MIGRATION_START id=/) || !has(/MIGRATION_OK id=/)) {
  fail('runner must timestamp harness stages and each migration start/completion, isolation, cleanup, and inventory result');
}
if (!has(/docker\s+container\s+ls/) && !has(/container\s+ls/) ||
    !has(/docker\s+network\s+ls|network\s+ls/) ||
    !has(/docker\s+volume\s+ls|volume\s+ls/) ||
    !has(/shasum\s+-a\s+256/) ||
    !has(/save_inventory\s+PRE/) || !has(/save_inventory\s+POST/) ||
    !has(/%s_%s_COUNT=%s\\n%s_%s_SHA256=%s/) ||
    !has(/cmp\s+-s[\s\S]{0,400}PRE_containers\.txt[\s\S]{0,400}PRE_networks\.txt[\s\S]{0,400}PRE_volumes\.txt/) ||
    !has(/chmod\s+700/) || !has(/mkdir\s+-m\s+700/) ||
    /inventory_entries|while IFS=.*entry.*printf.*CONTAINERS/.test(runner)) {
  fail('runner must keep sorted exact inventories private and report only counts/full SHA-256 with byte-for-byte comparison');
}
if (!has(/(?:docker|\$\{DOCKER\[@\]\})[^\n]*\bevents[\s\S]{0,400}label=.*LABEL_KEY.*RUN_ID/) ||
    !has(/events --filter[\s\S]{0,300}> "\$FORENSICS\/events\.log"/) ||
    /M2_E2E_OWNED_EVENT_SNAPSHOT_BEGIN|printf[^\n]*events\.log/.test(runner) ||
    !has(/EVENT_PID/) ||
    !has(/(?:docker|\$\{DOCKER\[@\]\})[^\n]*\bexec[^\n]*psql[\s\S]{0,100}SELECT 1/) ||
    !has(/redis-cli ping/) ||
    !has(/POSTGRES_PRE_MIGRATION_SELECT/) || !has(/POSTGRES_POST_MIGRATION_SELECT/) ||
    !has(/REDIS_PRE_MIGRATION_PING/) || !has(/REDIS_PRE_PLAYWRIGHT_PING/) ||
    !has(/MIGRATION_PID/) || !has(/MIGRATION_EXIT_CODE/) || !has(/MIGRATION_SIGNAL/)) {
  fail('runner must capture owned Docker events, child exit, and post-readiness PostgreSQL/Redis probes');
}
const eventCaptureStart = runner.indexOf('capture_owned_events() {');
const eventCaptureEnd = runner.indexOf('capture_sanitized_state() {', eventCaptureStart);
const eventCapture = eventCaptureStart < 0 || eventCaptureEnd < 0
  ? '' : stripShellComments(runner.slice(eventCaptureStart, eventCaptureEnd));
const lifecyclePath = path.join(root, 'scripts/lib/connected-e2e-event-lifecycle.sh');
const lifecycleHelper = fs.existsSync(lifecyclePath) ? fs.readFileSync(lifecyclePath, 'utf8') : '';
const lifecycleExecutable = stripShellComments(lifecycleHelper);
const eventSanitizerWaitRequired =
  !runner.includes('. "$ROOT/scripts/lib/connected-e2e-event-lifecycle.sh"') ||
  !/connected_e2e_event_lifecycle\s+"\$\{producer_pid:-\}"\s+"\$\{sanitizer_pid:-\}"/.test(eventCapture);
const producerStop = lifecycleExecutable.indexOf('kill -TERM "$producer_pid"');
const producerBoundWait = lifecycleExecutable.indexOf('connected_e2e_wait_bounded "$producer_pid"');
const sanitizerDrain = lifecycleExecutable.indexOf('connected_e2e_wait_bounded "$sanitizer_pid" "$drain_attempts"');
const timeoutRecord = lifecycleExecutable.indexOf('stage=timeout');
const sanitizerTerm = lifecycleExecutable.indexOf('kill -TERM "$sanitizer_pid"');
const sanitizerKill = lifecycleExecutable.indexOf('kill -KILL "$sanitizer_pid"');
const eventSanitizerLifecycleSafe = producerStop >= 0 && producerBoundWait > producerStop &&
  sanitizerDrain > producerBoundWait && timeoutRecord > sanitizerDrain && sanitizerTerm > timeoutRecord &&
  sanitizerKill > sanitizerTerm && /wait\s+"\$pid"/.test(lifecycleExecutable) &&
  /kill -0/.test(lifecycleExecutable) && /ps -o stat=/.test(lifecycleExecutable);
const lifecycleFixturePath = path.join(root, 'scripts/tests/test-culinary-profile-event-lifecycle.sh');
const lifecycleFixture = fs.existsSync(lifecycleFixturePath) ? fs.readFileSync(lifecycleFixturePath, 'utf8') : '';
const eventLifecycleRecordsTimeoutAndOutcome =
  /\. "\$ROOT\/scripts\/lib\/connected-e2e-event-lifecycle\.sh"/.test(lifecycleFixture) &&
  /connected_e2e_event_lifecycle/.test(lifecycleFixture) &&
  /normal-markers/.test(lifecycleFixture) && /external-term/.test(lifecycleFixture) &&
  /external-kill/.test(lifecycleFixture) && /sanitizer-error/.test(lifecycleFixture) &&
  /owned-timeout-kill/.test(lifecycleFixture) && /partial event password/.test(lifecycleFixture) &&
  /docker event password=/.test(lifecycleFixture) && /fixture-timeout-secret/.test(lifecycleFixture) &&
  /stage=%s pid=%s exit=%s signal=%s cause=%s/.test(lifecycleExecutable) &&
  /owned-timeout/.test(lifecycleExecutable) && /external-term/.test(lifecycleExecutable) &&
  /external-kill/.test(lifecycleExecutable) && /sanitizer-error/.test(lifecycleExecutable) &&
  /owned-timeout-term/.test(lifecycleExecutable) && /owned-timeout-kill/.test(lifecycleExecutable) &&
  /EVENT_LIFECYCLE stage=timeout pid=%s exit=unknown/.test(lifecycleExecutable) &&
  /connected_e2e_event_lifecycle/.test(eventCapture) &&
  /cp\s+"\$FORENSICS\/events\.log"\s+"\$FORENSICS\/owned-events\.log"/.test(eventCapture) &&
  /EVENT_LIFECYCLE_FAILED/.test(eventCapture) &&
  /CONNECTED_E2E_EVENT_CAUSE.*sanitizer-error/.test(eventCapture) &&
  runner.includes('if [[ "$SANITIZATION_FAILED" == 1 || "$EVENT_LIFECYCLE_FAILED" == 1 ]]; then status=1; fi');
const failureStart = runner.indexOf('capture_failure_evidence() {');
const cleanupStart = runner.indexOf('cleanup() {', failureStart);
const failureBlock = failureStart < 0 || cleanupStart < 0 ? '' : runner.slice(failureStart, cleanupStart);
const failureOrder = [
  'capture_owned_events',
  'capture_sanitized_state "$PG_ID"',
  'capture_sanitized_state "$REDIS_ID"',
  'capture_container_logs "$PG_ID"',
  'capture_container_logs "$REDIS_ID"',
  'M2_E2E_FAILURE',
];
let priorIndex = -1;
for (const marker of failureOrder) {
  const index = failureBlock.indexOf(marker);
  if (index <= priorIndex) fail('failure evidence must be captured in order before cleanup: events, state, PostgreSQL logs, Redis logs, failure marker');
  priorIndex = index;
}
if (/Config\.Env|\.Config\.Env/.test(runner) ||
    !has(/State\.OOMKilled/) || !has(/State\.ExitCode/) || !has(/RestartCount/) ||
    !has(/State\.StartedAt/) || !has(/State\.FinishedAt/)) {
  fail('failure inspect must be sanitized to state fields and never include container environment');
}
if (runStarts.some((match) => /--rm\b/.test(match[0]))) {
  fail('owned containers must remain inspectable until failure evidence is captured; cleanup removes exact IDs afterward');
}
const logStart = runner.indexOf('capture_container_logs() {');
const failureFunctionStart = runner.indexOf('capture_failure_evidence() {', logStart);
const logsBlock = logStart < 0 || failureFunctionStart < 0 ? '' : runner.slice(logStart, failureFunctionStart);
if (!logsBlock.includes('logs --timestamps') ||
    !/logs --timestamps[\s\S]{0,180}\| node "\$ROOT\/scripts\/lib\/redact-diagnostic-stream\.mjs" > "\$output"/.test(logsBlock) ||
    /logs --timestamps[^\n]*(?:tee|cat|printf)/.test(logsBlock) ||
    !/print_bounded_summary\(\)/.test(runner) ||
    !/node "\$ROOT\/scripts\/lib\/redact-diagnostic-stream\.mjs" --summary/.test(runner)) {
  fail('PostgreSQL and Redis logs must pipe directly through the sanitizer into private files without raw stdout');
}
const stateSummaryFiles = [
  '"$FORENSICS/postgres-state.txt"',
  '"$FORENSICS/redis-state.txt"',
];
const boundedStateSummaryLoop = failureBlock.match(/for log in([^;\n]*)\s*; do([\s\S]*?)done/);
if (!boundedStateSummaryLoop ||
    stateSummaryFiles.some((file) => !boundedStateSummaryLoop[1].includes(file)) ||
    !/print_bounded_summary\s+"\$log"\s*>\s*"\$WORKSPACE\/summary\.tmp"/.test(boundedStateSummaryLoop[2]) ||
    !/printf\s+'%s\\n'\s+"\$summary_line"/.test(boundedStateSummaryLoop[2]) ||
    failureBlock.indexOf('print_bounded_summary "$log"') > failureBlock.indexOf('mark M2_E2E_FAILURE')) {
  fail('failure output must print bounded redactor summaries of both private PostgreSQL and Redis state reports before cleanup');
}
if (!has(/node "\$ROOT\/scripts\/lib\/redact-diagnostic-stream\.mjs" --summary/) ||
    !has(/playwright-raw\.log/) || !has(/playwright\.log/) ||
    !has(/node "\$ROOT\/scripts\/lib\/redact-diagnostic-stream\.mjs" < "\$PLAYWRIGHT_RAW" > "\$PLAYWRIGHT_SAFE"/) ||
    !has(/migration\.log/) ||
    !has(/schema_migrations/) || !has(/MIGRATION_LEDGER_COUNT=/) || !has(/DB_MIGRATE_VERIFY=PASS/)) {
  fail('diagnostic summaries must be bounded and sanitized; migration trace and isolated ledger must be verified');
}
if (!has(/mark\s+["']?POSTGRES_TMPFS=YES["']?/) || !has(/mark\s+["']?REDIS_TMPFS=YES["']?/) ||
    !has(/mark\s+["']?POSTGRES_LOOPBACK=YES["']?/) || !has(/mark\s+["']?REDIS_LOOPBACK=YES["']?/) ||
    !has(/mark\s+["']?POST_INVENTORY_MATCH=\$POST_INVENTORY_MATCH["']?/) ||
    !has(/mark\s+["']?ZERO_M2_TEST_GARBAGE=YES["']?/) ||
    !has(/mark\s+"\$label=YES"/) ||
    !has(/mark\s+M2_E2E_PRE_INVENTORY_START/) || !has(/mark\s+M2_E2E_PRE_INVENTORY_COMPLETE/) ||
    !has(/mark\s+M2_E2E_POST_INVENTORY_START/) || !has(/mark\s+M2_E2E_POST_INVENTORY_COMPLETE/)) {
  fail('isolation, probe, inventory, and final cleanup proof markers must be timestamped');
}
if (!has(/utc_now\(\)[\s\S]{0,100}toISOString/) || !has(/mark\(\)[\s\S]{0,100}utc_now/)) {
  fail('all timestamped markers must use an explicit UTC timestamp source');
}
const requiredStageMarkers = [
  'HARNESS_START', 'POSTGRES_CONTAINER_CREATED', 'REDIS_CONTAINER_CREATED',
  'MIGRATION_PROCESS_START', 'MIGRATION_PROCESS_EXIT', 'MIGRATION_VERIFY_PASS',
  'PLAYWRIGHT_START', 'PLAYWRIGHT_STARTED=YES', 'PLAYWRIGHT_EXIT',
  'CLEANUP_START', 'CLEANUP_COMPLETE', 'POSTGRES_READY', 'REDIS_READY',
];
if (requiredStageMarkers.some((marker) => {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return !new RegExp(`\\bmark\\s+["']?${escaped}(?:["']?(?:\\s|$))`).test(runner);
})) {
  fail('runner must emit every exact timestamped lifecycle marker, including Playwright start state and readiness');
}
const migrationLoopStart = runner.indexOf('while IFS= read -r migration_line');
const migrationLoopEnd = runner.indexOf('done < "$FORENSICS/migration.log"', migrationLoopStart);
const migrationLoop = migrationLoopStart < 0 || migrationLoopEnd < 0
  ? '' : runner.slice(migrationLoopStart, migrationLoopEnd);
if (!migrationLoop.includes('MIGRATION_START id=') ||
    !migrationLoop.includes('MIGRATION_OK id=') ||
    !/while[\s\S]{0,500}(?:redact-diagnostic-stream\.mjs|migration\.log)/.test(runner) ||
    runner.indexOf('wait "$MIGRATION_PID"') < runner.indexOf('MIGRATION_START id=') ||
    !/migration\.log[\s\S]{0,100}done/.test(runner)) {
  fail('per-migration timestamp markers must consume the sanitized migration stream while it runs, not after wait/completion');
}
const ledgerStart = runner.indexOf('verify_migration_ledger() {');
const ledgerEnd = runner.indexOf('\n}\nverify_migration_ledger', ledgerStart);
const ledgerCheck = ledgerStart < 0 || ledgerEnd < 0 ? '' : runner.slice(ledgerStart, ledgerEnd);
if (!ledgerCheck.includes('expected_migrations.txt') ||
    !/source_count=\$\(awk 'END \{ print NR\+0 \}' "\$FORENSICS\/expected_migrations\.txt"\)/.test(ledgerCheck) ||
    !/ledger_count=\$\(awk 'END \{ print NR\+0 \}' "\$FORENSICS\/ledger_migrations\.txt"\)/.test(ledgerCheck) ||
    !/\[\[\s+"\$ledger_count"\s+==\s+"\$source_count"/.test(ledgerCheck) ||
    !/cmp\s+-s\s+"\$FORENSICS\/expected_migrations\.txt"\s+"\$FORENSICS\/ledger_migrations\.txt"/.test(ledgerCheck) ||
    !/while\s+IFS=\s*read\s+-r\s+migration_file[\s\S]*?mark\s+"MIGRATION_\$\{migration_file%\.sql\}=PASS"[\s\S]*?done\s+<\s+"\$FORENSICS\/expected_migrations\.txt"/.test(ledgerCheck) ||
    /\b13\b/.test(ledgerCheck)) {
  fail('migration ledger verification must compare dynamic source/ledger counts and full filename lists, then mark each expected migration without a hard-coded count');
}
if (!/for log in[\s\S]{0,300}owned-events\.log/.test(runner)) {
  fail('bounded failure event summary must include the sanitized owned Docker event stream');
}
if (!/(?:SANITIZATION_FAILED|LOG_SANITIZATION_FAILED)=1/.test(runner) ||
    !/if\s+\[\[?[^\n]*(?:SANITIZATION_FAILED|LOG_SANITIZATION_FAILED)[^\n]*\]\]?;?\s*then[\s\S]{0,250}(?:status=1|exit 1)/.test(runner)) {
  fail('any diagnostic sanitization failure must set fail-closed global or exit status');
}
const playwrightWait = runner.indexOf('wait "$PLAYWRIGHT_PID"');
const startedFileAssignment = runner.match(/PLAYWRIGHT_STARTED_FILE=([^\n]+)/);
const reporterUsesWorkspace = /(?:cp|install|copyFile|writeFileSync|writeFile)[^\n]*(?:reporter|PLAYWRIGHT_REPORTER)[^\n]*(?:WORKSPACE|SOURCE)|(?:WORKSPACE|SOURCE)[^\n]*(?:reporter|PLAYWRIGHT_REPORTER)/i.test(runner);
const reporterConfigured = /(?:reporter|reporters)[^\n]*(?:PLAYWRIGHT_REPORTER|reporter)/i.test(runner);
const startedWatcher = runner.indexOf('PLAYWRIGHT_STARTED_FILE', Math.max(0, runner.indexOf('PLAYWRIGHT_PID=$!')));
const startedMarker = runner.indexOf('PLAYWRIGHT_STARTED=YES', Math.max(0, runner.indexOf('PLAYWRIGHT_PID=$!')));
const playwrightWaitAfterStart = playwrightWait >= 0 && startedWatcher >= 0 && startedWatcher < playwrightWait && startedMarker > startedWatcher && startedMarker < playwrightWait;
const watcherStart = runner.indexOf('PLAYWRIGHT_PID=$!');
const watcherEnd = runner.indexOf(') &\n PLAYWRIGHT_START_WATCHER_PID=$!', watcherStart);
const watcherBlock = watcherStart < 0 || watcherEnd < 0 ? '' : runner.slice(watcherStart, watcherEnd);
const watcherLoopEnd = watcherBlock.lastIndexOf('done');
const sentinelAfterLoop = watcherLoopEnd >= 0 &&
  /if\s+\[\[\s+-f\s+"\$PLAYWRIGHT_STARTED_FILE"\s+\]\][\s\S]{0,120}mark PLAYWRIGHT_STARTED=YES/.test(watcherBlock.slice(watcherLoopEnd));
const contractFailures = [];
if (eventSanitizerWaitRequired) {
  contractFailures.push('runner must invoke the sourceable event lifecycle helper with its exact producer and sanitizer PIDs');
}
if (!eventSanitizerLifecycleSafe) {
  contractFailures.push('event lifecycle helper must stop the producer, boundedly drain sanitizer EOF, record timeout before TERM/KILL escalation, and reap exact PIDs');
}
if (!eventLifecycleRecordsTimeoutAndOutcome) {
  contractFailures.push('event lifecycle helper must record stage, exact PID, exit, signal, and known/unknown cause for normal, timeout, TERM, KILL, and sanitizer error while preserving safe partial output');
}
const playwrightSuccessGate = runner.slice(runner.lastIndexOf('if [[ "$PLAYWRIGHT_EXIT_CODE"'), runner.indexOf("fail 'guarded Playwright spec failed.'"));
const playwrightSuccessRequiresStarted = /PLAYWRIGHT_EXIT_CODE/.test(playwrightSuccessGate) &&
  /(?:PLAYWRIGHT_STARTED_FILE|PLAYWRIGHT_STARTED=YES)/.test(playwrightSuccessGate);
if (!playwrightSuccessRequiresStarted) {
  contractFailures.push('successful Playwright completion must require both exit code zero and observed onTestBegin start sentinel/PLAYWRIGHT_STARTED=YES');
}
const reporterFunctionStart = runner.indexOf('generate_reporter() {');
const reporterFunctionEnd = runner.indexOf('\nREPORTER\n}', reporterFunctionStart) + '\nREPORTER'.length;
const reporterFunction = reporterFunctionStart < 0 || reporterFunctionEnd < 0
  ? '' : runner.slice(reporterFunctionStart, reporterFunctionEnd);
const reporterHereDocStart = reporterFunction.indexOf("cat <<'REPORTER'\n");
const reporterHereDocEnd = reporterFunction.indexOf('\nREPORTER', reporterHereDocStart);
const playwrightResultReporter = reporterHereDocStart < 0 || reporterHereDocEnd < 0
  ? '' : reporterFunction.slice(reporterHereDocStart + "cat <<'REPORTER'\n".length, reporterHereDocEnd);
const playwrightResultTemplate = playwrightResultReporter.match(/PLAYWRIGHT_RESULT[^`]+/)?.[0] || '';
const selectedSpecPassedToPlaywright = /PLAYWRIGHT_SELECTED_SPEC="\$\{PLAYWRIGHT_SPEC##\*\/\}"/.test(runner);
if (!playwrightResultReporter.includes('PLAYWRIGHT_SELECTED_SPEC') ||
    !playwrightResultReporter.includes('PLAYWRIGHT_RESULT') ||
    !playwrightResultReporter.includes('onTestEnd') ||
    !playwrightResultReporter.includes('onEnd') ||
    !playwrightResultReporter.includes('test.outcome()') ||
    !playwrightResultReporter.includes("outcome === 'expected'") ||
    !playwrightResultReporter.includes("outcome === 'flaky'") ||
    !playwrightResultReporter.includes("outcome === 'unexpected'") ||
    !playwrightResultReporter.includes("outcome === 'skipped'") ||
    !playwrightResultTemplate ||
    !playwrightResultTemplate.startsWith('PLAYWRIGHT_RESULT spec=${this.selectedSpec} total=${total} passed=${passed} flaky=${flaky} failed=${failed} skipped=${skipped} status=${result.status}') ||
    /test\.(?:title|titlePath)|result\.(?:error|errors)|(?:file|location|stack)/i.test(playwrightResultTemplate) ||
    !selectedSpecPassedToPlaywright) {
  contractFailures.push('generated reporter must emit only the fixed selected-basename final-outcome aggregate and Playwright status; selected basename must be supplied to Playwright');
}
const resultProtocol = /PLAYWRIGHT_RESULT spec=\$\{this\.selectedSpec\} total=\$\{total\} passed=\$\{passed\} flaky=\$\{flaky\} failed=\$\{failed\} skipped=\$\{skipped\} status=\$\{result\.status\}/;
const safeResultParser = runner.slice(
  runner.indexOf('PLAYWRIGHT_SAFE='),
  runner.indexOf("fail 'guarded Playwright spec failed.'"),
);
if (!resultProtocol.test(playwrightResultReporter) ||
    !playwrightResultReporter.includes("const allowedFailureFiles = new Set(['today-recommendations-connected.spec.ts', 'meal-planner-connected.spec.ts'])") ||
    !playwrightResultReporter.includes("const allowedSelectedSpecs = new Set(['culinary-profile-connected.spec.ts', 'today-recommendations-connected.spec.ts', 'meal-planner-connected.spec.ts'])") ||
    !playwrightResultReporter.includes('allowedSelectedSpecs.has(this.selectedSpec)') ||
    !safeResultParser.includes("const allowedSelectedSpecs = new Set(['culinary-profile-connected.spec.ts', 'today-recommendations-connected.spec.ts', 'meal-planner-connected.spec.ts'])") ||
    !safeResultParser.includes('allowedSelectedSpecs.has(selectedSpec)') ||
    !safeResultParser.includes('allowedSelectedSpecs.has(match[1])') ||
    !safeResultParser.includes('PLAYWRIGHT_SAFE') ||
    !safeResultParser.includes('PLAYWRIGHT_RESULT') ||
    !safeResultParser.includes('resultLines.length !== 1') ||
    !safeResultParser.includes('Number.isSafeInteger') ||
    !safeResultParser.includes('maxResultCount = 1000') ||
    !safeResultParser.includes('(0|[1-9][0-9]{0,3})') ||
    !safeResultParser.includes('match[1] !== selectedSpec') ||
    !safeResultParser.includes('passed + flaky + failed + skipped !== total') ||
    !safeResultParser.includes('passed + flaky + failed <= 0') ||
    !safeResultParser.includes("process.stdout.write(resultLines[0] + '\\n')") ||
    !safeResultParser.includes('statusValues') ||
    !selectedSpecPassedToPlaywright ||
    !/mark\s+"\$PLAYWRIGHT_VALIDATED_RESULT"/.test(runner) ||
    !/mark\(\)\s*\{[^\n]*utc_now/.test(runner)) {
  contractFailures.push('parent must parse exactly one result only from PLAYWRIGHT_SAFE, validate allowlisted selected basename, bounded safe counts, sum and status, reject zero executed tests, and timestamp only validated fields');
}
const missingSummaryDiagnostic = runner.slice(runner.indexOf('PLAYWRIGHT_SAFE='), runner.indexOf("fail 'guarded Playwright spec failed.'"));
if (!playwrightResultReporter.includes('PLAYWRIGHT_ONEND_SENTINEL_PATH') ||
    !playwrightResultReporter.includes("fs.writeFileSync(reporterFile, 'observed\\n'") ||
    !missingSummaryDiagnostic.includes('PLAYWRIGHT_RESULT_DIAGNOSTIC') ||
    !missingSummaryDiagnostic.includes('raw_prefix_count=') ||
    !missingSummaryDiagnostic.includes('safe_prefix_count=') ||
    !missingSummaryDiagnostic.includes('on_end=') ||
    !missingSummaryDiagnostic.includes('parser=') ||
    !/new Set\(\[['"](?:accepted|missing_raw|duplicate_raw|missing_safe|duplicate_safe|invalid_format|invalid_counts|invalid_spec|unsafe_input|parser_error)['"][^\]]*\]\)/.test(missingSummaryDiagnostic) ||
    !missingSummaryDiagnostic.includes('Number.isSafeInteger') ||
    !/PLAYWRIGHT_ONEND_SENTINEL_PATH="\$WORKSPACE\//.test(runner)) {
  contractFailures.push('missing-summary diagnostics must distinguish private onEnd observation, bounded raw/sanitized prefix counts, and accepted/fixed-enum parser outcome without exposing untrusted values');
}
const exitCleanupStart = runner.indexOf('cleanup() {');
const exitCleanupEnd = runner.indexOf('\n}\ntrap cleanup EXIT', exitCleanupStart);
const exitCleanupBlock = exitCleanupStart < 0 || exitCleanupEnd < 0
  ? '' : runner.slice(exitCleanupStart, exitCleanupEnd);
const cleanupExitMarker = exitCleanupBlock.indexOf('mark "RUNNER_EXIT_STATUS=$status"');
const cleanupExit = exitCleanupBlock.indexOf('exit "$status"', cleanupExitMarker);
if (cleanupExitMarker < 0 || cleanupExit < cleanupExitMarker ||
    exitCleanupBlock.slice(cleanupExitMarker).trim().replace(/\s+/g, ' ') !== 'mark "RUNNER_EXIT_STATUS=$status" exit "$status"') {
  contractFailures.push('cleanup must emit timestamped RUNNER_EXIT_STATUS=$status after final status mutation and immediately before exit "$status"');
}
if (!runner.includes('onTestBegin') || !reporterUsesWorkspace || !reporterConfigured ||
    !startedFileAssignment || !/WORKSPACE/.test(startedFileAssignment[1]) ||
    !/(?:mktemp|RUN_ID|randomUUID|randomBytes|urandom)/i.test(startedFileAssignment[1]) ||
    !playwrightWaitAfterStart ||
    !/(?:while|until)[^\n]*(?:PLAYWRIGHT_STARTED_FILE|started_file)[^\n]*[\s\S]{0,300}PLAYWRIGHT_STARTED=YES/.test(runner) ||
    !sentinelAfterLoop ||
    /wait "\$PLAYWRIGHT_PID"[\s\S]{0,500}grep[^\n]*(?:PLAYWRIGHT_RAW|PLAYWRIGHT_SAFE)[\s\S]{0,200}PLAYWRIGHT_STARTED=YES/.test(runner)) {
  contractFailures.push('Playwright start proof must come from a generated/copied onTestBegin reporter writing a unique workspace file, observed by a live pre-wait watcher (never post-exit reporter grep), including a sentinel check after the loop');
}
const migrationWait = runner.indexOf('wait "$MIGRATION_PID" || MIGRATION_EXIT_CODE=$?');
const migrationClear = runner.indexOf("MIGRATION_PID='';", migrationWait);
const playwrightNormalWait = runner.indexOf('wait "$PLAYWRIGHT_PID" || PLAYWRIGHT_EXIT_CODE=$?');
const playwrightClear = runner.indexOf("PLAYWRIGHT_PID=''", playwrightNormalWait);
if (migrationWait < 0 || migrationClear <= migrationWait ||
    playwrightNormalWait < 0 || playwrightClear <= playwrightNormalWait) {
  fail('normal migration and Playwright completion must clear their child PIDs after wait and before EXIT cleanup can signal a recycled PID');
}
if (/\b(?:killall|pkill)\b/.test(executable)) {
  fail('owned process cleanup must not use broad killall/pkill');
}
const cleanupFunctionStart = runner.indexOf('cleanup() {');
const cleanupFunctionEnd = runner.indexOf('\n}\ntrap cleanup EXIT', cleanupFunctionStart);
const cleanupBlock = cleanupFunctionStart < 0 || cleanupFunctionEnd < 0
  ? '' : runner.slice(cleanupFunctionStart, cleanupFunctionEnd);
const workspaceRemoval = cleanupBlock.indexOf('rm -rf -- "$WORKSPACE"');
const ownedChildCleanup = runner.match(/(?:function\s+)?cleanup_owned_children\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);
const ownedChildBlock = ownedChildCleanup ? ownedChildCleanup[0] : '';
const recursiveTreeCleanup = /(?:pgrep|ps)[\s\S]*?(?:cleanup_owned_children|owned_child)[\s\S]*?(?:kill|TERM)[\s\S]*?(?:wait|kill\s+-0)[\s\S]*?(?:absent|verify|kill\s+-0)/i.test(ownedChildBlock) &&
  /cleanup_owned_children/.test(ownedChildBlock.slice(ownedChildBlock.indexOf('{') + 1));
const cleanupCallsChildren = ['MIGRATION_PID', 'PLAYWRIGHT_PID'].every((pid) =>
  new RegExp(`cleanup_owned_children[^\\n]*\\$\\{?${pid}\\}?`).test(cleanupBlock.slice(0, workspaceRemoval))) &&
  /capture_owned_events/.test(cleanupBlock.slice(0, workspaceRemoval));
if (!ownedChildBlock || !recursiveTreeCleanup || !cleanupCallsChildren || workspaceRemoval < 0) {
  contractFailures.push('cleanup must recursively terminate, wait for, and prove absence of owned process descendants for event, migration, and Playwright roots before workspace removal');
}
const recursiveWaitsAreObserved = ownedChildBlock &&
  [...ownedChildBlock.matchAll(/\bwait\s+["']?\$root_pid["']?/g)].every((wait) => {
    const preceding = ownedChildBlock.slice(0, wait.index);
    const lastKill = Math.max(preceding.lastIndexOf('kill -KILL "$root_pid"'), preceding.lastIndexOf('kill -TERM "$root_pid"'));
    const afterSignal = preceding.slice(lastKill + 1);
    return lastKill >= 0 && /(?:if\s+!\s+kill\s+-0\s+"\$root_pid"|ps\s+-o\s+stat=[^\n]*"\$root_pid"[^\n]*\bZ)/.test(afterSignal);
  });
if (!recursiveWaitsAreObserved) {
  contractFailures.push('recursive cleanup may wait for an owned PID only after observing that exact PID terminated or became a zombie; KILL followed by an unconditional wait is unbounded');
}
const outerCleanupWaitsAreObserved = ['MIGRATION_PID', 'PLAYWRIGHT_PID'].every((pid) => {
  const start = cleanupBlock.indexOf(`cleanup_owned_children "$${pid}"`);
  if (start < 0) return false;
  const nextRoot = cleanupBlock.indexOf('cleanup_owned_children "$', start + 1);
  const segment = cleanupBlock.slice(start, nextRoot < 0 ? workspaceRemoval : nextRoot);
  return !new RegExp(`\\bwait\\s+["']?\\$\\{?${pid}\\}?["']?`).test(segment) ||
    new RegExp(`(?:if\\s+!\\s+kill\\s+-0\\s+["']?\\$\\{?${pid}\\}?["']?|ps\\s+-o\\s+stat=[^\\n]*["']?\\$\\{?${pid}\\}?["']?[^\\n]*\\bZ)[\\s\\S]{0,160}wait\\s+["']?\\$\\{?${pid}\\}?["']?`).test(segment);
});
if (!outerCleanupWaitsAreObserved) {
  contractFailures.push('outer cleanup must not blindly wait again after recursive cleanup has already returned its bounded termination result');
}
for (const childPid of ['MIGRATION_PID', 'PLAYWRIGHT_PID']) {
  const stop = new RegExp(`kill[^\\n]*\\$\\{?${childPid}\\}?`);
  const wait = new RegExp(`wait[^\\n]*\\$\\{?${childPid}\\}?`);
  if (workspaceRemoval < 0 || !stop.test(cleanupBlock.slice(0, workspaceRemoval)) ||
      !wait.test(cleanupBlock.slice(0, workspaceRemoval))) {
    fail(`EXIT/INT/TERM cleanup must stop and wait for owned ${childPid} before deleting the workspace`);
  }
}

const playwrightFailureMetadata = playwrightResultReporter;
const stackFramePattern = playwrightFailureMetadata.match(/const framePattern = ([^\n]+);/);
if (!stackFramePattern ||
    !stackFramePattern[1].includes('today-recommendations|meal-planner') ||
    stackFramePattern[1].includes('culinary-profile-connected') ||
    !playwrightFailureMetadata.includes("new Set(['today-recommendations-connected.spec.ts', 'meal-planner-connected.spec.ts'])") ||
    !playwrightFailureMetadata.includes('validatedLocation(declarationFile')) {
  fail('stack-frame failure locations must accept only the allowlisted Today and meal-planner specs, never the M1 profile spec');
}
if (!playwrightFailureMetadata.includes("const allowedFailureFiles = new Set(['today-recommendations-connected.spec.ts', 'meal-planner-connected.spec.ts'])") ||
    !playwrightFailureMetadata.includes('onTestEnd') ||
    !playwrightFailureMetadata.includes('onTestBegin') ||
    !playwrightFailureMetadata.includes('PLAYWRIGHT_FAILURE_METADATA_FILE') ||
    !playwrightFailureMetadata.includes('file') ||
    !playwrightFailureMetadata.includes('line') ||
    !playwrightFailureMetadata.includes('column') ||
    !playwrightFailureMetadata.includes('allowedFailureFiles') ||
    !playwrightFailureMetadata.includes('maxFailures = 20') ||
    !playwrightFailureMetadata.includes('this.failureCount >= maxFailures') ||
    !playwrightFailureMetadata.includes('stack') ||
    !playwrightFailureMetadata.includes('maxStackLength = 8192') ||
    !playwrightFailureMetadata.includes('boundedStack = stack.slice(0, maxStackLength)') ||
    !playwrightFailureMetadata.includes('declaration') ||
    !runner.includes("new Set(['stack', 'declaration'])") ||
    !playwrightFailureMetadata.includes('source') ||
    !/Number\.isSafeInteger\(line\)[\s\S]{0,120}line < 1/.test(playwrightFailureMetadata) ||
    !/Number\.isSafeInteger\(column\)[\s\S]{0,120}column < 1/.test(playwrightFailureMetadata) ||
    !/const record\s*=\s*\{\s*\.\.\.location\s*,\s*source\s*\}/.test(playwrightFailureMetadata) ||
    !/JSON\.stringify\(record\)/.test(playwrightFailureMetadata) ||
    !runner.includes("Object.keys(item).sort().join(',') !== 'column,file,line,source'") ||
    !runner.includes('PLAYWRIGHT_FAILURE_METADATA_FILE=') ||
    !runner.includes('PLAYWRIGHT_FAILURE_METADATA_FILE')) {
  fail('Playwright metadata must retain only a bounded validated allowlisted source location, use declaration fallback, and exclude all error/test data');
}
if (!has(/PLAYWRIGHT_FAILURE_METADATA_FILE/) ||
    !runner.includes(".split('\\n').filter(Boolean).slice(0, 20)") ||
    !has(/print_playwright_failure_metadata\s+"\$FORENSICS\/playwright-failures\.jsonl"/) ||
    !has(/PLAYWRIGHT_FAILURE source=\$\{item\.file\}:\$\{item\.line\}:\$\{item\.column\}/)) {
  fail('only a validated source location may be reported from private Playwright failure metadata');
}
if (contractFailures.length > 0) {
  for (const failure of contractFailures) console.error(`culinary profile connected E2E contract failure: ${failure}`);
  process.exit(1);
}
// These are in-container Docker exec probes; deliberately do not constrain the separate host-side DATABASE_URL/PG_HOST_PORT wiring.
const postgresExecLines = executable.split('\n').filter((line) =>
  /(?:["']?\$\{DOCKER\[@\]\}["']?|\bdocker\b)\s+exec\b/.test(line));
const readinessInvocation = postgresExecLines.find((line) => /\bpg_isready\b/.test(line)) || '';
const preMigrationProbeStart = executable.indexOf('postgres_probe() {');
const preMigrationProbeEnd = executable.indexOf('redis_probe()', preMigrationProbeStart);
const preMigrationProbeBlock = preMigrationProbeStart < 0 || preMigrationProbeEnd < 0
  ? '' : executable.slice(preMigrationProbeStart, preMigrationProbeEnd);
const psqlInvocations = postgresExecLines.filter((line) => /\bpsql\b/.test(line));
const preMigrationPsqlInvocation = psqlInvocations.find((line) => /SELECT\s+1/.test(line)) || '';
const probeArgumentsPresent = (line) => /(?:^|\s)-h\s+127\.0\.0\.1(?:\s|$)/.test(line) &&
  /(?:^|\s)-p\s+5432(?:\s|$)/.test(line) &&
  /(?:^|\s)-U\s+"?\$DB_USER"?(?:\s|$)/.test(line) &&
  /(?:^|\s)-d\s+"?\$DB_NAME"?(?:\s|$)/.test(line) &&
  !/\$\{?PG_HOST_PORT\}?/.test(line);
const everyPsqlUsesContainerTcp = psqlInvocations.length > 0 && psqlInvocations.every(probeArgumentsPresent);
const safeProbeMarker = executable.split('\n').find((line) => /POSTGRES_PROBE_ENDPOINT/.test(line)) || '';
if (!probeArgumentsPresent(readinessInvocation)) {
  fail('in-container pg_isready must use explicit loopback TCP/5432 and the expected DB user/name');
}
if (!probeArgumentsPresent(preMigrationPsqlInvocation) ||
    !/SELECT\s+1/.test(preMigrationProbeBlock) ||
    !/postgres_probe\s+POSTGRES_PRE_MIGRATION_SELECT/.test(executable)) {
  fail('pre-migration psql SELECT 1 must use explicit loopback TCP/5432 and the expected DB user/name');
}
if (!everyPsqlUsesContainerTcp) {
  fail('every in-container psql call, including migration-ledger inspection, must use explicit loopback TCP/5432');
}
if (!/DATABASE_URL=.*@127\.0\.0\.1:\$\{PG_HOST_PORT\}/.test(executable)) {
  fail('host-side migration DATABASE_URL must retain the published loopback PG_HOST_PORT');
}
if (!safeProbeMarker.includes('POSTGRES_PROBE_ENDPOINT=tcp://127.0.0.1:5432') ||
    /(?:DB_PASSWORD|PGPASSWORD|DATABASE_URL|DB_USER|DB_NAME|AUTH_SECRET|TOKEN|PASSWORD|SECRET)=/.test(safeProbeMarker)) {
  fail('PostgreSQL probe endpoint marker must be credential-free');
}
const { spawnSync } = require('node:child_process');
const reporterCheck = spawnSync('bash', [runnerPath, '--check-reporter'], {
  cwd: root,
  encoding: 'utf8',
  timeout: 10000,
  maxBuffer: 64 * 1024,
});
if (reporterCheck.error || reporterCheck.status !== 0) {
  const outcome = reporterCheck.error?.code === 'ETIMEDOUT'
    ? 'timed out after 10 seconds'
    : `exited with status ${reporterCheck.status ?? 'unknown'}`;
  fail(`offline generated-reporter syntax preflight ${outcome}`);
}
const reporterCheckOutput = `${reporterCheck.stdout || ''}${reporterCheck.stderr || ''}`;
const successMarkers = reporterCheckOutput.match(/^CULINARY_PROFILE_REPORTER_SYNTAX=PASS$/gm) || [];
if (successMarkers.length !== 1 || successMarkers[0].length > 64) {
  fail('offline generated-reporter syntax preflight must emit exactly one bounded CULINARY_PROFILE_REPORTER_SYNTAX=PASS marker');
}
const reporterCheckBranch = runner.indexOf("if [[ \"$#\" -eq 1 && \"$1\" == '--check-reporter' ]]");
const lifecycleSource = runner.indexOf('. "$ROOT/scripts/lib/connected-e2e-event-lifecycle.sh"');
const runIdGeneration = runner.indexOf('RUN_ID=');
if (!runner.includes('--check-reporter') ||
    (runner.match(/cat <<'REPORTER'/g) || []).length !== 1 ||
    !/generate_reporter\s*\|\s*node\s+--check\s+--input-type=module\s+-/.test(runner) ||
    !runner.includes("generate_reporter > \"$PLAYWRIGHT_REPORTER\"") ||
    reporterCheckBranch < 0 || lifecycleSource < 0 || runIdGeneration < 0 ||
    reporterCheckBranch >= lifecycleSource || reporterCheckBranch >= runIdGeneration) {
  fail('offline reporter preflight must syntax-check the same generated JavaScript as the harness before lifecycle or run-ID side effects');
}
const forbiddenPreflightOutput = /M2_E2E_(?:HARNESS_START|POSTGRES_CONTAINER_CREATED|REDIS_CONTAINER_CREATED|MIGRATION_PROCESS_START|PLAYWRIGHT_START)|(?:docker|playwright test|run-migrations\.js)/i;
if (forbiddenPreflightOutput.test(reporterCheckOutput)) {
  fail('reporter syntax preflight must not start Docker, migrations, or Playwright');
}
console.log('culinary profile connected E2E static safety contract passed');
NODE
