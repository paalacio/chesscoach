import { expect, test } from "@playwright/test";
import { importSampleCourse, openApp, playMove, waitForYourMove } from "./helpers";

test("a course becomes a repertoire, with the author's notes", async ({ page }) => {
  await openApp(page, "?mock=empty");
  await page.getByRole("button", { name: "Repertoire", exact: true }).click();
  await importSampleCourse(page);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Repertoire name")).toHaveValue("Sample course: the Italian (made up for tests)");
  await expect(dialog).toContainText("Taken from the file.");
  await expect(dialog).toContainText("6 moves of yours");
  await expect(dialog).toContainText("1 other move for your side");
  await dialog.getByRole("button", { name: "Import", exact: true }).click();

  const panel = page.locator(".rep-panel");
  await expect(panel).toContainText("From the course: Sample course");
  await expect(panel.locator(".course-about")).toHaveText("The Italian Game: quick development and pressure on f7.");
  await expect(panel.locator(".course-notes")).toContainText("Grab the centre");
  // Two moves in: Bc4 is the course's line, Bb5 a side line.
  await panel.locator(".course-move", { hasText: "e4" }).click();
  await panel.locator(".rep-reply", { hasText: "e5" }).click();
  await panel.locator(".course-move", { hasText: "Nf3" }).click();
  await panel.locator(".rep-reply", { hasText: "Nc6" }).click();
  await expect(panel.locator(".course-notes li", { hasText: "Bb5" })).toContainText("side line");
  await expect(panel.locator(".course-notes li", { hasText: "Bc4!" })).toContainText("The bishop eyes f7");
});

test("the trainer shows the author's comment while learning and after a wrong move", async ({ page }) => {
  await openApp(page, "?mock=empty");
  await page.getByRole("button", { name: "Repertoire", exact: true }).click();
  await importSampleCourse(page);
  await page.getByRole("dialog").getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.locator(".rep-panel")).toBeVisible();

  await page.getByRole("button", { name: "Train", exact: true }).click();
  await page.locator(".mode-card", { hasText: "Learn new lines" }).getByRole("button", { name: "Start" }).click();
  let s = await waitForYourMove(page);
  await expect(page.locator(".trainer-course-note")).toContainText("Grab the centre");
  await playMove(page, s.expected?.uci as string, s.orientation, "trainer-board");
  s = await waitForYourMove(page, s.fen);
  await playMove(page, "h2h3", s.orientation, "trainer-board");
  await expect(page.getByText(`Not quite: the move is ${s.expected?.san}.`)).toBeVisible();
  await expect(page.locator(".trainer-course-note")).toContainText("Attacks e5 and develops.");
});
