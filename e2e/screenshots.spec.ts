// Screenshots of the main screens in light and dark mode, for visual review.
// Run with `pnpm screenshots` (needs the mock dev server, started automatically).
// Output: screenshots/<phase>/<platform>-<screen>-<scheme>.png

import { expect, type Page, test } from "@playwright/test";
import { importPgn, openApp, RUY_PGN } from "./helpers";

const PHASE = process.env.SCREENSHOT_PHASE ?? "phase-1";

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} @screenshot`, () => {
    test.use({ colorScheme: scheme, deviceScaleFactor: 2 });

    const shot = async (page: Page, name: string, browserName: string) => {
      const platform = browserName === "webkit" ? "mac" : "windows";
      await page.waitForTimeout(400); // let animations settle
      await page.screenshot({ path: `screenshots/${PHASE}/${platform}-${name}-${scheme}.png` });
    };
    const query = (browserName: string) => (browserName === "webkit" ? "" : "?platform=windows");

    test("analysis with explanation", async ({ page, browserName }) => {
      await openApp(page, query(browserName));
      await importPgn(page, RUY_PGN);
      await page.getByRole("button", { name: /Explain 5\.\.\.Be7/ }).click();
      await expect(page.locator(".coach-card")).toContainText("5...Be7", { timeout: 10_000 });
      await shot(page, "analysis-explained", browserName);
    });

    test("analysis plan", async ({ page, browserName }) => {
      await openApp(page, query(browserName));
      await importPgn(page, `${RUY_PGN.replace(" *", "")} 6. Re1 (6. d3 b5) b5 7. Bb3 *`);
      await page.keyboard.press("ArrowLeft");
      await page.keyboard.press("ArrowLeft");
      await page.keyboard.press("ArrowLeft"); // back to the position after 5...Be7
      await page.getByRole("button", { name: "Plan for this position" }).click();
      await expect(page.locator(".coach-card")).toContainText("Plan for White", { timeout: 10_000 });
      await shot(page, "analysis-plan", browserName);
    });

    test("start position", async ({ page, browserName }) => {
      await openApp(page, query(browserName));
      await expect(page.locator(".engine-line")).toHaveCount(3);
      await shot(page, "analysis-start", browserName);
    });

    test("setup", async ({ page, browserName }) => {
      await openApp(page, query(browserName));
      await page.getByRole("button", { name: "Setup", exact: true }).click();
      await expect(page.locator(".check-row")).toHaveCount(5);
      await shot(page, "setup", browserName);
    });

    test("setup with problems", async ({ page, browserName }) => {
      await openApp(page, `${query(browserName) || "?"}${query(browserName) ? "&" : ""}mock=errors`);
      await page.getByRole("button", { name: "Setup", exact: true }).click();
      await expect(page.locator(".check-row")).toHaveCount(5);
      await shot(page, "setup-errors", browserName);
    });

    test("settings", async ({ page, browserName }) => {
      await openApp(page, query(browserName));
      await page.getByRole("button", { name: "Settings" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await shot(page, "settings", browserName);
    });

    test("games", async ({ page, browserName }) => {
      await openApp(page, query(browserName));
      await page.getByRole("button", { name: "Games" }).click();
      await page.getByRole("button", { name: "Check connection" }).click();
      await expect(page.getByRole("alert").or(page.locator(".callout.error"))).toBeVisible();
      await shot(page, "games", browserName);
    });
  });
}
