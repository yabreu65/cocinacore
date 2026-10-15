#!/usr/bin/env bash
set -Eeuo pipefail
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
LOG=$(mktemp "${TMPDIR:-/tmp}/today-provider-fixture.XXXXXX.log")
PROVIDER_PID=''
cleanup() {
  if [[ -n "$PROVIDER_PID" ]]; then
    kill "$PROVIDER_PID" 2>/dev/null || true
    wait "$PROVIDER_PID" 2>/dev/null || true
  fi
  rm -f -- "$LOG"
}
trap cleanup EXIT

PORT=$(node -e 'const server = require("node:net").createServer(); server.listen(0, "127.0.0.1", () => { console.log(server.address().port); server.close(); });')
E2E_PROVIDER_PORT="$PORT" node "$ROOT/frontend/e2e/provider-server.mjs" >"$LOG" 2>&1 &
PROVIDER_PID=$!

node --input-type=module - "$PORT" <<'NODE'
import assert from 'node:assert/strict';

const port = Number(process.argv[2]);
const baseUrl = `http://127.0.0.1:${port}`;
let ready = false;
for (let attempt = 0; attempt < 50; attempt += 1) {
  try {
    const response = await fetch(`${baseUrl}/__e2e/health`);
    if (response.ok) {
      ready = true;
      break;
    }
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 50));
}
assert.equal(ready, true, 'provider should become healthy on its dynamically assigned port');

const todayResponse = await fetch(`${baseUrl}/v1beta/models/gemini-test:generateContent`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    generationConfig: {
      responseSchema: {
        type: 'OBJECT',
        properties: { options: { type: 'ARRAY', items: { type: 'OBJECT' } } },
      },
    },
  }),
});
assert.equal(todayResponse.status, 200);
const todayEnvelope = await todayResponse.json();
const todayText = todayEnvelope.candidates?.[0]?.content?.parts?.[0]?.text;
assert.equal(typeof todayText, 'string', 'Today fixture should return Gemini text envelope');
const today = JSON.parse(todayText);
assert.equal(today.options.length, 4, 'Today fixture should return four options');
assert.ok(today.options.every((option) => option.slot === 'lunch'), 'all options should use lunch slot');
assert.ok(today.options.every((option) => Array.isArray(option.ingredients) && option.ingredients.length > 0), 'all options should have ingredients');
assert.ok(today.options.every((option) => Number.isInteger(option.prepMinutes) && option.prepMinutes >= 1 && option.prepMinutes <= 240), 'prepMinutes should be an integer from 1 through 240');
const unsafe = today.options.filter((option) => option.title === 'Peanut bowl');
assert.equal(unsafe.length, 1, 'fixture should include exactly one Peanut bowl');
assert.ok(unsafe[0].ingredients.some((ingredient) => /peanut/i.test(typeof ingredient === 'string' ? ingredient : ingredient.name)), 'Peanut bowl should contain peanut ingredient');
assert.equal(today.options.length - unsafe.length, 3, 'fixture should include three safe candidates');

const mealPlanResponse = await fetch(`${baseUrl}/v1beta/models/gemini-test:generateContent`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    generationConfig: {
      responseJsonSchema: {
        type: 'OBJECT',
        properties: { period: { type: 'STRING' }, dayCount: { type: 'INTEGER' }, days: { type: 'ARRAY' } },
      },
    },
  }),
});
assert.equal(mealPlanResponse.status, 200);
const mealPlanEnvelope = await mealPlanResponse.json();
const mealPlanText = mealPlanEnvelope.candidates?.[0]?.content?.parts?.[0]?.text;
assert.equal(typeof mealPlanText, 'string');
const mealPlan = JSON.parse(mealPlanText);
assert.equal(mealPlan.period, 'week');
assert.equal(mealPlan.dayCount, 7);
assert.equal(mealPlan.days.length, 7);
assert.deepEqual(mealPlan.days.map((day) => day.dayIndex), [1, 2, 3, 4, 5, 6, 7]);
assert.ok(mealPlan.days.every((day) => day.meals.map((meal) => meal.mealType).join(',') === 'breakfast,lunch,dinner'));

const requestsResponse = await fetch(`${baseUrl}/__e2e/requests`);
assert.equal(requestsResponse.status, 200, 'request inspection endpoint should remain available');
const requests = await requestsResponse.json();
assert.equal(requests.generationCallCount, 2);
assert.equal((await fetch(`${baseUrl}/__e2e/reset`, { method: 'POST' })).status, 200, 'reset endpoint should remain available');
assert.equal((await (await fetch(`${baseUrl}/__e2e/requests`)).json()).generationCallCount, 0);
console.log('Today provider fixture contract passed');
NODE
