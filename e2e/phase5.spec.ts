import { expect, test } from "@playwright/test";
import { importPgn, openApp } from "./helpers";

test("insights: overview, results by opening, the trend and the themes", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "Insights", exact: true }).click();
  await expect(page.locator(".stat").first()).toContainText("Games");
  await expect(page.locator(".opening-row:not(.head)").first()).toContainText("Ruy Lopez");
  await page.getByRole("radio", { name: "As Black" }).click();
  await expect(page.locator(".opening-row:not(.head)").first()).toContainText(/Sicilian|King's Indian/);
  await expect(page.locator(".trend svg path.line")).toHaveCount(3);
  await expect(page.locator(".theme-bars li").first()).toContainText("tactics");
});

test("insights: empty without games", async ({ page }) => {
  await openApp(page, "?mock=empty");
  await page.getByRole("button", { name: "Insights", exact: true }).click();
  await expect(page.getByRole("heading", { name: "No games yet" })).toBeVisible();
});

test("a repertoire can be renamed", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "Repertoire", exact: true }).click();
  await page.getByRole("button", { name: "Rename…" }).click();
  await page.getByRole("textbox", { name: "Rename…" }).fill("My 1.e4");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("radio", { name: "My 1.e4" })).toBeVisible();
});

test("right-click a move: add the line to a repertoire", async ({ page }) => {
  await openApp(page);
  await importPgn(page, "1. e4 e5 2. Nf3 Nc6 3. Bc4 *");
  await page.locator(".move", { hasText: "Bc4" }).click({ button: "right" });
  await page.getByText("Add the line to “White · 1.e4”").click();
  await expect(page.getByText("Added 1 move.")).toBeVisible();
  await page.getByRole("button", { name: "Repertoire", exact: true }).click();
  await page.getByRole("radio", { name: "White · 1.e4" }).click();
  await page.keyboard.press("ArrowLeft"); // back to before 3.Bc4: it's your move there now
  await expect(page.locator(".rep-mine-move")).toContainText("Bc4");
});

test("the game review says where the game left your repertoire", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "Games", exact: true }).click();
  await page.locator(".games-row:not(.head)").first().click();
  await expect(page.getByText(/your repertoire “White · 1\.e4”/)).toBeVisible({ timeout: 10_000 });
});
