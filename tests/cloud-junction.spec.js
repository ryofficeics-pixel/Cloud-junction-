import { test, expect } from '@playwright/test';

async function collectRuntimeErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}

test('desktop journey starts, moves, and every major control responds', async ({ page }) => {
  const errors = await collectRuntimeErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  const start = page.getByRole('button', { name: /board the celestial railway/i });
  await expect(start).toBeEnabled({ timeout: 25_000 });
  await expect(page.locator('#startupError')).toBeHidden();
  await expect(page.locator('#fatalError')).toBeHidden();
  await start.click();
  await expect(page.locator('#hud')).toBeVisible();
  await expect(page.locator('#loading')).toBeHidden({ timeout: 3_000 });
  await expect(page.locator('#world canvas')).toBeVisible();

  const firstSpeed = Number(await page.locator('#speedValue').textContent());
  await page.waitForTimeout(1_600);
  const secondSpeed = Number(await page.locator('#speedValue').textContent());
  expect(Number.isFinite(firstSpeed)).toBeTruthy();
  expect(Number.isFinite(secondSpeed)).toBeTruthy();
  expect(secondSpeed).toBeGreaterThan(0);

  const trainNames = new Set();
  for (let index = 0; index < 6; index += 1) {
    trainNames.add(await page.locator('#trainName').innerText());
    await page.locator('#hornButton').dispatchEvent('pointerdown', { pointerId: index + 10 });
    await page.waitForTimeout(60);
    await page.locator('#hornButton').dispatchEvent('pointerup', { pointerId: index + 10 });
    await page.locator('#nextTrain').click();
  }
  expect(trainNames.size).toBe(6);

  const originalCamera = await page.locator('#cameraLabel').innerText();
  await page.locator('#cameraButton').click();
  await expect(page.locator('#cameraLabel')).not.toHaveText(originalCamera);

  await page.locator('#mapButton').click();
  await expect(page.locator('#mapPanel')).toBeVisible();
  expect(await page.locator('#destinationList button').count()).toBeGreaterThanOrEqual(8);
  await page.locator('[data-close="mapPanel"]').click();
  await expect(page.locator('#mapPanel')).toBeHidden();

  await page.locator('#settingsButton').click();
  await page.locator('#weatherSelect').selectOption('storm');
  await page.locator('#timeSelect').selectOption('night');
  await page.locator('#qualitySelect').selectOption('low');
  await expect(page.locator('#settingsPanel')).toBeVisible();
  await page.locator('[data-close="settingsPanel"]').click();

  await page.locator('#autoButton').click();
  await page.locator('#powerControl').fill('35');
  await page.locator('#brakeControl').fill('15');
  await expect(page.locator('#operationMode')).toContainText('MANUAL');
  await page.locator('#switchButton').click();
  await expect(page.locator('#switchLabel')).not.toHaveText('MEADOW LINE');
  await page.locator('#hornButton').click();

  const canvasSize = await page.locator('#world canvas').evaluate((canvas) => ({ width: canvas.width, height: canvas.height }));
  expect(canvasSize.width).toBeGreaterThan(500);
  expect(canvasSize.height).toBeGreaterThan(300);
  expect(errors).toEqual([]);
});

test('Android mobile profile keeps touch UI reachable and stable', async ({ browser }) => {
  const page = await browser.newPage({
    viewport: { width: 412, height: 915 },
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36',
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2.625,
  });
  const errors = await collectRuntimeErrors(page);
  await page.goto('/');
  const start = page.getByRole('button', { name: /board the celestial railway/i });
  await expect(start).toBeEnabled({ timeout: 25_000 });
  await start.click();
  await expect(page.locator('#hud')).toBeVisible();
  await page.waitForTimeout(1_000);

  const layout = await page.evaluate(() => {
    const ids = ['cameraButton', 'mapButton', 'settingsButton', 'drive-console', 'previousTrain', 'nextTrain'];
    return ids.map((id) => {
      const element = id === 'drive-console' ? document.querySelector('.drive-console') : document.getElementById(id);
      const rect = element.getBoundingClientRect();
      return { id, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    });
  });
  layout.forEach((item) => {
    expect(item.left, item.id).toBeGreaterThanOrEqual(-1);
    expect(item.right, item.id).toBeLessThanOrEqual(413);
    expect(item.top, item.id).toBeGreaterThanOrEqual(-1);
    expect(item.bottom, item.id).toBeLessThanOrEqual(916);
    expect(item.width, item.id).toBeGreaterThan(25);
    expect(item.height, item.id).toBeGreaterThan(25);
  });

  await page.locator('#cameraButton').click();
  await page.locator('#nextTrain').click();
  await page.locator('#mapButton').click();
  await expect(page.locator('#mapPanel')).toBeVisible();
  await page.locator('[data-close="mapPanel"]').click();
  expect(errors).toEqual([]);
});
