import { expect, test } from '@playwright/test';

test('application shell and process health are reachable', async ({ page, request }, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'FinSight', exact: true })).toBeVisible();
  const response = await request.get('/api/health');
  expect(response.ok()).toBeTruthy();
  expect(await response.json()).toEqual({ status: 'ok', scope: 'process' });
  await page.screenshot({ path: testInfo.outputPath('desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('mobile.png'), fullPage: true });
});
