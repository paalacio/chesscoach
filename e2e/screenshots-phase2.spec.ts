// Phase 2 screenshots: games list and game review, English and Portuguese, light and dark.
// Output: screenshots/phase-2/<platform>-<screen>-<scheme>.png

import { expect, type Page, test } from "@playwright/test";
import { openApp } from "./helpers";

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} @screenshot phase-2`, () => {
    test.use({ colorScheme: scheme, deviceScaleFactor: 2 });

    const shot = async (page: Page, name: string, browserName: string) => {
      const platform = browserName === "webkit" ? "mac" : "windows";
      await page.waitForTimeout(400);
      await page.screenshot({ path: `screenshots/phase-2/${platform}-${name}-${scheme}.png` });
    };
    const q = (browserName: string, extra = "") => {
      const parts = [browserName === "webkit" ? "" : "platform=windows", extra].filter(Boolean);
      return parts.length ? `?${parts.join("&")}` : "";
    };

    for (const lang of ["en", "pt"] as const) {
      const L = lang === "pt" ? "lang=pt" : "";
      const games = lang === "pt" ? "Partidas" : "Games";

      test(`games list ${lang}`, async ({ page, browserName }) => {
        test.skip(lang === "pt" && browserName !== "webkit", "Portuguese screenshots: Mac only");
        await openApp(page, q(browserName, L));
        await page.getByRole("button", { name: games, exact: true }).click();
        await expect(page.locator(".games-row:not(.head)")).toHaveCount(6);
        await shot(page, `games-${lang}`, browserName);
      });

      test(`game review ${lang}`, async ({ page, browserName }) => {
        test.skip(lang === "pt" && browserName !== "webkit", "Portuguese screenshots: Mac only");
        await openApp(page, q(browserName, L));
        await page.getByRole("button", { name: games, exact: true }).click();
        await page.locator(".games-row:not(.head)").nth(2).click();
        await expect(page.locator(".accuracy-table")).toBeVisible();
        await page.getByRole("button", { name: lang === "pt" ? "Revisar esta partida com o Claude" : "Review this game with Claude" }).click();
        await expect(page.locator(".lessons li")).toHaveCount(3, { timeout: 10_000 });
        await page.locator(".key-moments .moment").nth(2).click();
        await shot(page, `review-${lang}`, browserName);
      });
    }

    for (const lang of ["en", "pt"] as const) {
      test(`compare best moves ${lang}`, async ({ page, browserName }) => {
        test.skip(browserName !== "webkit", "Mac only");
        await openApp(page, q(browserName, lang === "pt" ? "lang=pt" : ""));
        await page.getByRole("button", { name: lang === "pt" ? "Importar PGN ou FEN" : "Import PGN or FEN" }).click();
        await page.getByRole("textbox").fill("1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 *");
        await page.getByRole("button", { name: lang === "pt" ? "Importar" : "Import", exact: true }).click();
        await page.getByRole("button", { name: lang === "pt" ? /Comparar os melhores lances/ : /Compare the best moves/ }).click();
        await expect(page.locator(".best-moves li")).toHaveCount(3, { timeout: 10_000 });
        await shot(page, `compare-${lang}`, browserName);
      });
    }

    test("games empty", async ({ page, browserName }) => {
      test.skip(browserName !== "webkit");
      await openApp(page, q(browserName, "mock=empty"));
      await page.getByRole("button", { name: "Games", exact: true }).click();
      await shot(page, "games-empty", browserName);
    });

    test("settings pt", async ({ page, browserName }) => {
      test.skip(browserName !== "webkit");
      await openApp(page, q(browserName, "lang=pt"));
      await page.getByRole("button", { name: "Ajustes" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await shot(page, "settings-pt", browserName);
    });

    test("setup pt", async ({ page, browserName }) => {
      test.skip(browserName !== "webkit");
      await openApp(page, q(browserName, "lang=pt"));
      await page.getByRole("button", { name: "Verificação", exact: true }).click();
      await expect(page.locator(".check-row")).toHaveCount(5);
      await shot(page, "setup-pt", browserName);
    });
  });
}
