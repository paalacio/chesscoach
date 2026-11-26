// Phase 4 screenshots: repertoire, wizard, trainer, data settings. Output: screenshots/phase-4/
import { expect, type Page, test } from "@playwright/test";
import { importPgn, importSampleCourse, openApp, playMove, waitForYourMove } from "./helpers";

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} @screenshot phase-4`, () => {
    test.use({ colorScheme: scheme, deviceScaleFactor: 2 });
    const shot = async (page: Page, name: string, browserName: string) => {
      await page.waitForTimeout(500);
      await page.screenshot({ path: `screenshots/phase-4/${browserName === "webkit" ? "mac" : "windows"}-${name}-${scheme}.png` });
    };

    test("repertoire: opponent replies", async ({ page, browserName }) => {
      await openApp(page, browserName === "webkit" ? "" : "?platform=windows");
      await importPgn(page, "1. e4 *");
      await page.getByRole("button", { name: "Repertoire", exact: true }).click();
      await page.getByRole("radio", { name: "Black" }).click();
      await page.keyboard.press("ArrowUp"); // back to the start: White's first moves
      await expect(page.locator(".rep-reply").first()).toBeVisible();
      await shot(page, "repertoire-replies", browserName);
    });

    test("repertoire: your move with a note", async ({ page, browserName }) => {
      test.skip(browserName !== "webkit");
      await openApp(page);
      await importPgn(page, "1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 *");
      await page.getByRole("button", { name: "Repertoire", exact: true }).click();
      await page.getByRole("radio", { name: "Black" }).click();
      await expect(page.locator(".rep-mine-move")).toContainText("a6");
      await shot(page, "repertoire-note", browserName);
    });

    for (const lang of ["en", "pt"] as const) {
      test(`wizard ${lang}`, async ({ page, browserName }) => {
        test.skip(browserName !== "webkit");
        await openApp(page, `?mock=empty${lang === "pt" ? "&lang=pt" : ""}`);
        await page.getByRole("button", { name: lang === "pt" ? "Repertório" : "Repertoire", exact: true }).click();
        await expect(page.locator(".wizard-facts li").first()).toBeVisible();
        if (lang === "en") await shot(page, "wizard-games", browserName);
        await page.getByRole("button", { name: lang === "pt" ? "Avançar" : "Next" }).click();
        await page.locator("#w-openings").fill(lang === "pt" ? "Ruy Lopez, Gambito da Dama, Índia do Rei, Siciliana" : "Ruy Lopez, Queen's Gambit, King's Indian, Sicilian");
        if (lang === "en") await shot(page, "wizard-style", browserName);
        await page.getByRole("button", { name: lang === "pt" ? "Perguntar ao Claude" : "Ask Claude" }).click();
        await expect(page.locator(".wizard-option").first()).toBeVisible({ timeout: 15_000 });
        await expect(page.locator(".wizard-side").nth(1).locator(".wizard-option").first()).toBeVisible({ timeout: 15_000 });
        await shot(page, `wizard-options-${lang}`, browserName);
      });
    }

    test("trainer", async ({ page, browserName }) => {
      await openApp(page, browserName === "webkit" ? "" : "?platform=windows");
      await page.getByRole("button", { name: "Train", exact: true }).click();
      await expect(page.locator(".mode-card").first()).toBeVisible();
      await shot(page, "trainer-home", browserName);
      if (browserName !== "webkit") return;

      await page.locator(".mode-card", { hasText: "Learn new lines" }).getByRole("button", { name: "Start" }).click();
      let s = await waitForYourMove(page);
      await shot(page, "trainer-learn", browserName);
      await playMove(page, s.expected?.uci as string, s.orientation, "trainer-board");
      s = await waitForYourMove(page, s.fen);
      await playMove(page, s.orientation === "white" ? "h2h3" : "h7h6", s.orientation, "trainer-board");
      await expect(page.locator(".trainer-prompt.wrong")).toBeVisible();
      await shot(page, "trainer-wrong", browserName);
      await page.getByRole("button", { name: "Stop" }).click();

      await page.locator(".mode-card", { hasText: "My mistakes" }).getByRole("button", { name: "Start" }).click();
      s = await waitForYourMove(page);
      await playMove(page, s.expected?.uci as string, s.orientation, "trainer-board");
      await expect(page.getByText("Right!")).toBeVisible();
      await shot(page, "trainer-mistake", browserName);
    });

    test("course import", async ({ page, browserName }) => {
      test.skip(browserName !== "webkit");
      await openApp(page, "?mock=empty");
      await page.getByRole("button", { name: "Repertoire", exact: true }).click();
      await importSampleCourse(page);
      await shot(page, "course-import", browserName);
      await page.getByRole("dialog").getByRole("button", { name: "Import", exact: true }).click();
      const panel = page.locator(".rep-panel");
      for (const [kind, san] of [["course", "e4"], ["reply", "e5"], ["course", "Nf3"], ["reply", "Nc6"]]) {
        await panel.locator(kind === "course" ? ".course-move" : ".rep-reply", { hasText: san }).click();
      }
      await expect(panel.locator(".course-notes li", { hasText: "Bb5" })).toBeVisible();
      await shot(page, "course-notes", browserName);
      await page.getByRole("button", { name: "Train", exact: true }).click();
      await page.locator(".mode-card", { hasText: "Learn new lines" }).getByRole("button", { name: "Start" }).click();
      await waitForYourMove(page);
      await expect(page.locator(".trainer-course-note")).toBeVisible();
      await shot(page, "course-trainer", browserName);
    });

    test("settings: your data", async ({ page, browserName }) => {
      test.skip(browserName !== "webkit");
      await openApp(page);
      await page.getByRole("button", { name: "Settings" }).click();
      await page.getByText("Your data").scrollIntoViewIfNeeded();
      await shot(page, "settings-data", browserName);
    });
  });
}
