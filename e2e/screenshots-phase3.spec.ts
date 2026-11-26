// Phase 3 screenshots: the opening explorer. Output: screenshots/phase-3/
import { expect, type Page, test } from "@playwright/test";
import { importPgn, openApp, RUY_PGN } from "./helpers";

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} @screenshot phase-3`, () => {
    test.use({ colorScheme: scheme, deviceScaleFactor: 2 });
    const shot = async (page: Page, name: string, browserName: string) => {
      await page.waitForTimeout(500);
      await page.screenshot({ path: `screenshots/phase-3/${browserName === "webkit" ? "mac" : "windows"}-${name}-${scheme}.png` });
    };

    test("explorer masters", async ({ page, browserName }) => {
      await openApp(page, browserName === "webkit" ? "" : "?platform=windows");
      await importPgn(page, "1. e4 e5 2. Nf3 Nc6 3. Bb5 *");
      await page.getByRole("button", { name: "Explorer", exact: true }).click();
      await expect(page.locator(".explorer-row:not(.head) .ex-eval").first()).not.toBeEmpty({ timeout: 5000 });
      await shot(page, "explorer-masters", browserName);
    });

    test("explorer my level (token)", async ({ page, browserName }) => {
      test.skip(browserName !== "webkit");
      await openApp(page, "?token=1");
      await importPgn(page, "1. e4 *");
      await page.getByRole("button", { name: "Explorer", exact: true }).click();
      await expect(page.locator(".explorer-row:not(.head)").first()).toContainText("c5");
      await shot(page, "explorer-lichess", browserName);
    });

    test("explorer no token", async ({ page, browserName }) => {
      test.skip(browserName !== "webkit");
      await openApp(page);
      await page.getByRole("button", { name: "Explorer", exact: true }).click();
      await page.getByRole("radio", { name: "My level" }).click();
      await expect(page.locator(".explorer-callout")).toBeVisible();
      await shot(page, "explorer-no-token", browserName);
    });

    for (const lang of ["en", "pt"] as const) {
      test(`explain opening ${lang}`, async ({ page, browserName }) => {
        test.skip(browserName !== "webkit");
        await openApp(page, lang === "pt" ? "?lang=pt" : "");
        await page.getByRole("button", { name: lang === "pt" ? "Importar PGN ou FEN" : "Import PGN or FEN" }).click();
        await page.getByRole("textbox").fill(RUY_PGN);
        await page.getByRole("button", { name: lang === "pt" ? "Importar" : "Import", exact: true }).click();
        await page.getByRole("button", { name: lang === "pt" ? "Explorador" : "Explorer", exact: true }).click();
        await page.getByRole("button", { name: lang === "pt" ? "Explicar esta abertura" : "Explain this opening" }).click();
        await expect(page.locator(".opening-overview .coach-card")).toBeVisible({ timeout: 20_000 });
        await page.locator(".opening-overview").scrollIntoViewIfNeeded();
        await shot(page, `explain-opening-${lang}`, browserName);
      });
    }
  });
}
