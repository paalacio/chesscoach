import { expect, test } from "@playwright/test";
import { clickSquare, importPgn, openApp, RUY_PGN } from "./helpers";

test("the analysis board loads with engine lines", async ({ page }) => {
  await openApp(page);
  await expect(page.getByRole("heading", { name: "Analysis" })).toBeVisible();
  await expect(page.locator("cg-board piece")).toHaveCount(32);
  // Mock engine replays recorded Stockfish lines for the start position.
  await expect(page.locator(".engine-line").first()).toContainText("e4", { timeout: 5000 });
  await expect(page.locator(".engine-line")).toHaveCount(3);
});

test("moves can be played by clicking and navigated with the keyboard", async ({ page }) => {
  await openApp(page);
  await clickSquare(page, "e2");
  await clickSquare(page, "e4");
  await expect(page.locator(".move.current")).toHaveText("e4");
  await clickSquare(page, "e7");
  await clickSquare(page, "e5");
  await expect(page.locator(".move.current")).toHaveText("e5");
  await expect(page.locator(".opening-name")).toContainText("King's Pawn Game");
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".move.current")).toHaveText("e4");
  await page.keyboard.press("ArrowUp");
  await expect(page.locator(".move.current")).toHaveCount(0);
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".move.current")).toHaveText("e5");
});

test("a pasted PGN can be explained by the coach", async ({ page }) => {
  await openApp(page);
  await importPgn(page, RUY_PGN);
  // The board shows the end of the imported line.
  await expect(page.locator(".move.current")).toHaveText("Be7");
  await expect(page.locator(".opening-name")).toContainText("Ruy Lopez");
  await page.getByRole("button", { name: /Explain 5\.\.\.Be7/ }).click();
  await expect(page.getByText(/Asking Claude|Checking with Stockfish/)).toBeVisible();
  const card = page.locator(".coach-card").first();
  await expect(card).toContainText("5...Be7", { timeout: 10_000 });
  await expect(card).toContainText("Closed Ruy Lopez");
  // The answer replaces the button; "Ask again" lives on the card.
  await expect(page.getByRole("button", { name: /Explain 5\.\.\.Be7/ })).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Ask again" })).toBeVisible();
});

test("flip, engine toggle and the line preview work", async ({ page }) => {
  await openApp(page);
  await expect(page.locator(".engine-line").first()).toBeVisible();
  await page.keyboard.press("f");
  await expect(page.locator(".cg-wrap.orientation-black")).toBeVisible();
  await page.locator(".engine-line .pv-move").first().click();
  await expect(page.getByText("Previewing engine line")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText("Previewing engine line")).toHaveCount(0);
  await page.keyboard.press(" ");
  await expect(page.getByText("Engine is off")).toBeVisible();
});

test("the setup screen lists every check", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "Setup", exact: true }).click();
  for (const label of ["Chess engine", "Claude Code", "Claude login", "Chess.com", "Lichess explorer"]) {
    await expect(page.locator(".check-label", { hasText: label })).toBeVisible();
  }
  await page.getByRole("button", { name: "Send a test question" }).click();
  await expect(page.locator(".claude-answer summary")).toContainText("opening");
});

test("setup problems and Claude errors are explained", async ({ page }) => {
  await openApp(page, "?mock=errors");
  await expect(page.locator(".engine-panel .callout.error")).toContainText("Stockfish was not found");
  await page.getByRole("button", { name: "Setup", exact: true }).click();
  await expect(page.locator('.check-row[data-status="error"]')).toHaveCount(2);
});

test("bad PGN shows a clear error", async ({ page }) => {
  await openApp(page);
  await importPgn(page, "1. e4 e5 2. Ke3");
  await expect(page.getByRole("alert")).toContainText("Illegal move");
});

test("good alternatives get arrows and Claude can compare the best moves", async ({ page }) => {
  await openApp(page);
  await importPgn(page, RUY_PGN);
  await expect(page.locator(".engine-line")).toHaveCount(3);
  // In this position (after 5...Be7) Stockfish rates 6.Re1, 6.d3 and 6.Bxc6 about the same.
  await expect(page.locator(".as-good")).toHaveCount(2);
  await page.getByRole("button", { name: /Compare the best moves/ }).click();
  const card = page.locator(".coach-card").filter({ hasText: "Best moves for White" });
  await expect(card.locator(".best-moves li")).toHaveCount(3, { timeout: 10_000 });
  await expect(card.locator(".badge.verdict.best")).toHaveText("Best");
  await expect(card.locator(".recommendation")).toContainText("Re1");
});
