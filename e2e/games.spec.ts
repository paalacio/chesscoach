import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";

test("the games list shows imported games and filters them", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "Games", exact: true }).click();
  const rows = page.locator(".games-row:not(.head)");
  await expect(rows).toHaveCount(6);
  await page.getByRole("radio", { name: "Black" }).click();
  await expect(rows).toHaveCount(3);
  await page.getByRole("radio", { name: "All" }).first().click();
  await page.getByRole("searchbox").fill("sicilian");
  await expect(rows).toHaveCount(2);
});

test("background analysis finishes and fills in accuracy", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "Games", exact: true }).click();
  // The two newest games start un-analysed in mock mode.
  await expect(page.getByText(/Analysing · \d+%/)).toBeVisible();
  await expect(page.locator(".games-row:not(.head) .num").first()).toContainText("%", { timeout: 15_000 });
  await expect(page.getByText(/Analysing/)).toHaveCount(0, { timeout: 15_000 });
});

test("a game review shows accuracy, key moments and Claude's lessons", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "Games", exact: true }).click();
  await page.locator(".games-row:not(.head)").nth(2).click(); // an analysed game
  await expect(page.locator(".accuracy-table")).toBeVisible();
  await expect(page.locator(".eval-graph svg")).toBeVisible();
  await expect(page.locator(".key-moments li").first()).toBeVisible();

  // Keyboard navigation through the game.
  await page.keyboard.press("ArrowUp");
  await expect(page.locator(".review .board-caption")).toContainText("Starting position");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".review .move.current")).toHaveCount(1);

  // Clicking a key moment jumps there.
  await page.locator(".key-moments .moment").first().click();
  await expect(page.locator(".key-moments li.active")).toHaveCount(1);

  await page.getByRole("button", { name: "Review this game with Claude" }).click();
  await expect(page.locator(".lessons li")).toHaveCount(3, { timeout: 10_000 });

  // Open the current position on the analysis board.
  await page.getByRole("button", { name: "Analyse", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Analysis" })).toBeVisible();
  await expect(page.locator(".move.current")).toHaveCount(1);
});

test("the app can be switched to Portuguese in Settings", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("radio", { name: "Português" }).click();
  await page.locator(".sheet-footer").getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("button", { name: "Partidas", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Análise" })).toBeVisible();
  await page.getByRole("button", { name: "Partidas", exact: true }).click();
  await expect(page.getByRole("columnheader", { name: "Precisão" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
});

test("empty mode explains how to import", async ({ page }) => {
  await openApp(page, "?mock=empty");
  await page.getByRole("button", { name: "Games", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your Chess.com games" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Settings" })).toBeVisible();
});
