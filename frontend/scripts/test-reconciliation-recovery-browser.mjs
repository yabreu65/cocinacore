// Actual React panel in Chromium with intercepted synthetic HTTP. No app
// server, credentials, database or external network are used.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'vite';
import { chromium } from '@playwright/test';

const frontend = fileURLToPath(new URL('../', import.meta.url));
const sessionId = '44444444-4444-4444-8444-444444444444';
const inventoryId = '88888888-8888-4888-8888-888888888888';
const session = {
  id: sessionId,
  mealPlanId: 'plan-1',
  dayIndex: 1,
  mealType: 'lunch',
  recipeId: 'recipe-1',
  versionId: 'version-1',
  status: 'completed',
  currentStep: 1,
  totalSteps: 1,
  version: 3,
  instructionSnapshot: {
    servings: 2,
    ingredients: [{ name: 'Arroz', quantity: '600', unit: 'g' }],
    steps: [{ index: 1, title: 'Arroz', instruction: 'Cocinar' }],
  },
};
const inventory = [
  {
    id: inventoryId,
    ingredientName: 'Arroz',
    normalizedName: 'arroz',
    quantity: '1',
    unit: 'kg',
    expirationDate: null,
  },
];
const receipt = { operationId: 'operation-1', movementCount: 1 };
const link = '\0next-link-fixture';
const result = await build({
  configFile: false,
  logLevel: 'error',
  root: frontend,
  resolve: { dedupe: ['react', 'react-dom'], alias: { '@': path.join(frontend, 'src') } },
  esbuild: { jsx: 'automatic' },
  oxc: { jsx: { runtime: 'automatic' } },
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  plugins: [
    {
      name: 'reconciliation-browser-fixture',
      resolveId(id) {
        if (id === 'next/link') return link;
      },
      load(id) {
        if (id === link)
          return 'import React from "react"; export default function Link({href,children,...props}){return React.createElement("a",{...props,href},children)}';
      },
    },
  ],
  build: {
    write: false,
    minify: false,
    lib: {
      entry: path.join(frontend, 'scripts/fixtures/reconciliation-recovery-browser.tsx'),
      formats: ['es'],
      fileName: 'fixture',
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
const bundle = (Array.isArray(result) ? result[0] : result).output.find(
  (file) => file.type === 'chunk'
).code;
const browser = await chromium.launch({ headless: true });
try {
  for (const scenario of [
    'committed-response-lost',
    'request-lost',
    'legacy-orphan',
    'definitive-rejection',
    'lookup-unavailable',
  ]) {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(5000);
      let committed = scenario === 'legacy-orphan';
      let postCount = 0;
      const posts = [];
      let failLookup = scenario === 'lookup-unavailable';
      const errors = [];
      page.on('pageerror', (error) => {
        errors.push(error.message);
        console.error('PAGE ERROR:', error.message);
      });
      page.on('console', (message) => {
        if (message.type() === 'error') console.error('BROWSER:', message.text());
      });
      await page.addInitScript(
        ({ sessionId, scenario }) => {
          sessionStorage.setItem('cooking-session:recipe-1:version-1', sessionId);
          if (scenario === 'legacy-orphan')
            sessionStorage.setItem('cooking-reconciliation:' + sessionId, 'old-key-without-body');
        },
        { sessionId, scenario }
      );
      await page.route('**/*', async (route) => {
        const req = route.request();
        const url = new URL(req.url());
        if (url.origin !== 'https://fixture.invalid') return route.abort();
        if (url.pathname === '/')
          return route.fulfill({
            contentType: 'text/html',
            body: '<!doctype html><div id="root"></div><script>globalThis.process={env:{NODE_ENV:"production"}}</script><script type="module" src="/fixture.js"></script>',
          });
        if (url.pathname === '/fixture.js')
          return route.fulfill({ contentType: 'text/javascript', body: bundle });
        if (url.pathname === '/api/cooking-sessions/' + sessionId)
          return route.fulfill({ json: { session } });
        if (url.pathname === '/api/cooking-sessions/' + sessionId + '/reconciliation') {
          if (req.method() === 'GET') {
            if (failLookup)
              return route.fulfill({ status: 503, json: { error: 'Estado no disponible' } });
            return route.fulfill({ json: { inventory, receipt: committed ? receipt : null } });
          }
          postCount++;
          posts.push(req.postDataJSON());
          if (scenario === 'committed-response-lost' && postCount === 1) {
            committed = true;
            return route.abort('failed');
          }
          if (scenario === 'request-lost' && postCount === 1) return route.abort('failed');
          if (scenario === 'definitive-rejection' && postCount === 1)
            return route.fulfill({ status: 409, json: { error: 'Stock insuficiente' } });
          committed = true;
          return route.fulfill({ status: 201, json: { ...receipt, status: 'applied' } });
        }
        return route.fulfill({ status: 404, json: {} });
      });
      async function open() {
        await page.goto('https://fixture.invalid/');
        await page.getByRole('button', { name: 'Preparar esta receta' }).click();
      }
      async function submit() {
        await page
          .getByRole('button', { name: 'Confirmar uso real' })
          .waitFor()
          .catch(async (e) => {
            console.error(await page.locator('body').innerText());
            throw e;
          });
        await page.getByLabel('Resultado').selectOption('used');
        await page.getByLabel('Cantidad efectiva').fill('600');
        await page.getByLabel('Unidad', { exact: true }).fill('g');
        await page.getByLabel('Lote de inventario').selectOption(inventoryId);
        await page.getByRole('button', { name: 'Confirmar uso real' }).click();
      }
      const recorded = page.getByText('Uso real registrado. Movimientos de inventario: 1.', {
        exact: true,
      });
      await open();
      if (scenario === 'legacy-orphan') {
        await recorded.waitFor();
        assert.equal(postCount, 0);
        assert.equal(await page.getByRole('button', { name: 'Confirmar uso real' }).count(), 0);
      } else if (scenario === 'lookup-unavailable') {
        await page.getByText('Estado no disponible', { exact: true }).waitFor();
        assert.equal(await page.getByRole('button', { name: 'Confirmar uso real' }).count(), 0);
        failLookup = false;
        await page.getByRole('button', { name: 'Consultar estado del consumo' }).click();
        await page.getByRole('button', { name: 'Confirmar uso real' }).waitFor();
        assert.equal(postCount, 0);
      } else {
        await submit();
        if (scenario === 'definitive-rejection') {
          await page.getByText('Stock insuficiente', { exact: true }).waitFor();
          assert.equal(await page.getByLabel('Cantidad efectiva').inputValue(), '600');
          await page.getByLabel('Cantidad efectiva').fill('500');
          await page.getByRole('button', { name: 'Confirmar uso real' }).click();
          await recorded.waitFor();
          assert.equal(posts[1].items[0].quantity, 500);
          assert.notEqual(posts[1].idempotencyKey, posts[0].idempotencyKey);
        } else {
          await page.getByText('No se pudo confirmar el resultado.', { exact: false }).waitFor();
          const pending = await page.evaluate(
            (id) =>
              JSON.parse(sessionStorage.getItem('cooking-reconciliation:' + id + ':pending:v1')),
            sessionId
          );
          assert.deepEqual(pending, posts[0]);
          await page.reload();
          await page.getByRole('button', { name: 'Preparar esta receta' }).click();
          if (scenario === 'request-lost') {
            await page.getByRole('button', { name: 'Reintentar consumo guardado' }).click();
            await recorded.waitFor();
            assert.deepEqual(posts[1], posts[0]);
          } else {
            await recorded.waitFor();
            assert.equal(postCount, 1);
          }
          assert.equal(await page.getByRole('button', { name: 'Confirmar uso real' }).count(), 0);
        }
        assert.equal(
          await page.evaluate(
            (id) => sessionStorage.getItem('cooking-reconciliation:' + id + ':pending:v1'),
            sessionId
          ),
          null
        );
      }
      assert.deepEqual(errors, []);
      console.log('PASS browser recovery: ' + scenario);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
