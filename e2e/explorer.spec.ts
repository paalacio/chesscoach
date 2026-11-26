import { expect, test } from "@playwright/test";
import { importPgn, openApp, RUY_PGN } from "./helpers";

test("the explorer shows masters moves with results and engine evals", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "Explorer", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Explorer" })).toBeVisible();
  const rows = page.locator(".explorer-row:not(.head)");
  await expect(rows.first()).toContainText("e4");
  await expect(rows.first().locator(".wdl .w")).toBeVisible();
  await expect(rows.first().locator(".ex-eval")).not.toBeEmpty({ timeout: 5000 });
  // Clicking a move plays it.
  await rows.first().click();
  await expect(page.locator(".move.current")).toHaveText("e4");
  await expect(rows.first()).toContainText("c5");
});

test("games at my level need a token, then work", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "Explorer", exact: true }).click();
  await page.getByRole("radio", { name: "My level" }).click();
  await expect(page.getByText("Games at your level need a free Lichess token.")).toBeVisible();
  await page.getByRole("button", { name: "Add a token" }).click();
  await page.getByLabel("API token").fill("lip_TestToken123456");
  await page.locator(".token-row").getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved in the keychain ✓")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator(".chip", { hasText: "1800" }).click(); // change a filter: reloads
  await expect(page.locator(".explorer-row:not(.head)").first()).toContainText("e4");
});

test("my games and 'explain this opening'", async ({ page }) => {
  await openApp(page);
  await importPgn(page, RUY_PGN);
  await page.getByRole("button", { name: "Explorer", exact: true }).click();
  await page.getByRole("radio", { name: "My games" }).click();
  await page.getByRole("button", { name: "Explain this opening" }).click();
  await expect(page.locator(".opening-overview .coach-card")).toContainText("Ruy Lopez", { timeout: 10_000 });
  await expect(page.locator(".opening-overview h4", { hasText: "Traps to know" })).toBeVisible();
});
