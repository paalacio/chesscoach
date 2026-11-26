// Phase 5 screenshots: Insights, the Liquid Glass setting, the review's repertoire line. Output: screenshots/phase-5/
import { expect, type Page, test } from "@playwright/test";
import { openApp } from "./helpers";

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} @screenshot phase-5`, () => {
    test.use({ colorScheme: scheme, deviceScaleFactor: 2 });
    const shot = async (page: Page, name: string, browserName: string, fullPage = false) => {
      await page.waitForTimeout(500);
      await page.screenshot({ path: `screenshots/phase-5/${browserName === "webkit" ? "mac" : "windows"}-${name}-${scheme}.png`, fullPage });
    };

    for (const lang of ["en", "pt"] as const) {
      test(`insights ${lang}`, async ({ page, browserName }) => {
        test.skip(lang === "pt" && browserName !== "webkit");
        await openApp(page, `${browserName === "webkit" ? "?" : "?platform=windows&"}lang=${lang}`);
        await page.getByRole("button", { name: lang === "pt" ? "Estatísticas" : "Insights", exact: true }).click();
        await expect(page.locator(".trend svg path.line")).toHaveCount(3);
        await expect(page.locator(".theme-bars li").first()).toBeVisible();
        await page.locator(".trend svg .hit").hover({ position: { x: 200, y: 60 } });
        await shot(page, `insights-${lang}`, browserName);
        await page.locator(".theme-bars").scrollIntoViewIfNeeded();
        await shot(page, `insights-bottom-${lang}`, browserName);
      });
    }

    test("review with repertoire line", async ({ page, browserName }) => {
      test.skip(browserName !== "webkit");
      await openApp(page);
      await page.getByRole("button", { name: "Games", exact: true }).click();
      await page.locator(".games-row:not(.head)").first().click();
      await expect(page.getByText(/your repertoire “White · 1\.e4”/)).toBeVisible({ timeout: 10_000 });
      await shot(page, "review-repertoire", browserName);
    });

    test("settings: liquid glass", async ({ page, browserName }) => {
      test.skip(browserName !== "webkit");
      await openApp(page);
      await page.getByRole("button", { name: "Settings" }).click();
      await expect(page.getByText("Liquid Glass", { exact: true })).toBeVisible();
      await shot(page, "settings-glass", browserName);
    });
  });
}
