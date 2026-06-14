export default async function globalSetup() {
  console.log(
    'Skipping automatic E2E infrastructure bootstrap. Start the PostgreSQL/Redis/app stack explicitly before running Playwright.'
  );
}
