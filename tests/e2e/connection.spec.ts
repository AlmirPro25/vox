
import { test, expect } from '@playwright/test';

test.describe('VOX-BRIDGE Core Flow', () => {
  test('should allow anonymous login and enter searching state', async ({ page }) => {
    // 1. Visit the Nexus
    await page.goto('/');

    // 2. Check for Lore Presence
    await expect(page.locator('h1')).toContainText('The End of Foreign');

    // 3. Select Native Language
    await page.selectOption('select[name="nativeLanguage"]', 'pt');

    // 4. Start Connection
    const joinButton = page.getByRole('button', { name: /CONECTAR AO NEXUS/i });
    await joinButton.click();

    // 5. Verify Matchmaking State
    await expect(page.locator('text=BUSCANDO PARCEIRO')).toBeVisible();
    
    // 6. Verify Column Layout (3-Column Paradigm)
    const columns = await page.locator('aside, main, section').count();
    expect(columns).toBeGreaterThanOrEqual(3);
  });
});
