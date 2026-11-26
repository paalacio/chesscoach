import { expect, test } from "@playwright/test";
import { importPgn, openApp, playMove, trainerSession, waitForYourMove } from "./helpers";

test("the repertoire shows your move and the replies you're ready for", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "Repertoire", exact: true }).click();
  const panel = page.locator(".rep-panel");
  await expect(panel.locator(".rep-mine-move")).toContainText("e4");
  await page.getByRole("radio", { name: "Black" }).click();
  const replies = panel.locator(".rep-reply");
  await expect(replies.first()).toContainText("e4");
  await expect(replies.nth(1)).toContainText("d4");
  // Clicking a reply plays it; now it's your move again.
  await replies.first().click();
  await expect(page.locator(".move.current")).toHaveText("e4");
  await expect(panel.locator(".rep-mine-move")).toContainText("c5");
});

test("a different move on the board can become your repertoire move", async ({ page }) => {
  await openApp(page);
  await importPgn(page, "1. e4 e5 *");
  await page.getByRole("button", { name: "Repertoire", exact: true }).click();
  await page.getByRole("radio", { name: "Black" }).click();
  await expect(page.getByText("You played e5; your repertoire has c5.")).toBeVisible();
  await page.getByRole("button", { name: "Use e5 instead" }).click();
  // e5 is now the move; White's replies after it aren't prepared yet.
  await expect(page.getByText("The line ends here.")).toBeVisible();
  await page.getByRole("button", { name: "Fill in from here" }).click();
  await expect(page.locator(".rep-reply").first()).toContainText("Nf3", { timeout: 15_000 });
});

test("repertoire PGN export", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "Repertoire", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export PGN…" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.pgn$/);
  const text = await (await file.createReadStream()).toArray();
  expect(Buffer.concat(text).toString()).toContain('[Orientation "white"]');
});

test("the wizard asks Claude, then builds the chosen lines", async ({ page }) => {
  await openApp(page, "?mock=empty");
  await page.getByRole("button", { name: "Repertoire", exact: true }).click();
  await expect(page.getByRole("heading", { name: "What you play and what you face" })).toBeVisible();
  await expect(page.getByText("Your first move")).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByLabel("Openings you play or want to keep").fill("Ruy Lopez, Queen's Gambit, King's Indian, Sicilian");
  await page.getByRole("button", { name: "Ask Claude" }).click();
  await expect(page.getByRole("radio", { name: /Ruy Lopez: Closed Variation/ })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("radio", { name: /Sicilian Defence: Accelerated Dragon/ })).toBeVisible({ timeout: 15_000 });
  // Pick the Najdorf against 1.e4.
  await page.getByRole("radio", { name: /Najdorf/ }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.locator(".wizard-chosen")).toContainText("Najdorf");
  await page.getByRole("button", { name: "Build my repertoire" }).click();
  // Building starts on the Repertoire page; stop it early, what was built is kept.
  await expect(page.getByText(/Building: \d+ positions/)).toBeVisible();
  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.getByText("The last build stopped before it was finished.")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".rep-panel")).toBeVisible();
});

test("trainer: learn a line, with a wrong answer on the way", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "Train", exact: true }).click();
  await expect(page.getByText(/Today: \d+ of 20 cards/)).toBeVisible();
  await page.locator(".mode-card", { hasText: "Learn new lines" }).getByRole("button", { name: "Start" }).click();
  // First pass: the move is shown with an arrow.
  let s = await waitForYourMove(page);
  await expect(page.getByText(`Play ${s.expected?.san}`)).toBeVisible();
  await playMove(page, s.expected?.uci as string, s.orientation, "trainer-board");
  // Second move of the line: play something else first.
  s = await waitForYourMove(page, s.fen);
  const wrong = s.orientation === "white" ? "h2h3" : "h7h6";
  if (s.expected?.uci !== wrong) {
    await playMove(page, wrong, s.orientation, "trainer-board");
    await expect(page.getByText(`Not quite: the move is ${s.expected?.san}.`)).toBeVisible();
  }
  await playMove(page, s.expected?.uci as string, s.orientation, "trainer-board");
  await expect.poll(async () => (await trainerSession(page))?.status).not.toBe("wrong");
});

test("trainer: review due and my mistakes", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "Train", exact: true }).click();
  await page.locator(".mode-card", { hasText: "Review due" }).getByRole("button", { name: "Start" }).click();
  const s = await waitForYourMove(page);
  await expect(page.getByText("Your move", { exact: true })).toBeVisible();
  await playMove(page, s.expected?.uci as string, s.orientation, "trainer-board");
  await expect(page.locator(".trainer-panel")).toContainText(/1 of \d+/);
  await page.getByRole("button", { name: "Stop" }).click();

  await page.locator(".mode-card", { hasText: "My mistakes" }).getByRole("button", { name: "Start" }).click();
  const m = await waitForYourMove(page);
  await expect(page.getByText("Find a better move")).toBeVisible();
  await playMove(page, m.expected?.uci as string, m.orientation, "trainer-board");
  await expect(page.getByText("Right!")).toBeVisible();
  await expect(page.getByText(/In the game you played/)).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
});

test("settings: export the training cards", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByText("Your data")).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export…" }).click();
  const file = await download;
  const text = Buffer.concat(await (await file.createReadStream()).toArray()).toString();
  expect(JSON.parse(text)).toMatchObject({ format: "chesscoach-training", version: 1 });
});
