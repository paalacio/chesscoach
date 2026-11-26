import type { Page } from "@playwright/test";

export const RUY_PGN = `[Event "Example"]
[White "White"]
[Black "Black"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 *`;

/** Clicks a square on a board (`testId`: "board" = analysis, "trainer-board" = trainer). */
export async function clickSquare(page: Page, square: string, orientation: "white" | "black" = "white", testId = "board") {
  const board = page.getByTestId(testId);
  const box = await board.boundingBox();
  if (!box) throw new Error("board not visible");
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  const size = box.width / 8;
  const col = orientation === "white" ? file : 7 - file;
  const row = orientation === "white" ? 7 - rank : rank;
  await page.mouse.click(box.x + (col + 0.5) * size, box.y + (row + 0.5) * size);
}

/** Opens the app in mock mode, skipping the setup screen. */
export async function openApp(page: Page, query = "") {
  await page.addInitScript(() => {
    if (!localStorage.getItem("chesscoach.mock.settings")) {
      localStorage.setItem("chesscoach.mock.settings", JSON.stringify({ setupComplete: true }));
    }
  });
  await page.goto(`/${query}`);
  await page.locator("nav.sidebar-section").waitFor();
}

export async function importPgn(page: Page, pgn: string) {
  await page.getByRole("button", { name: "Import PGN or FEN" }).click();
  await page.getByRole("textbox", { name: "PGN or FEN" }).fill(pgn);
  await page.getByRole("button", { name: "Import", exact: true }).click();
}

/** Plays a move (UCI) on a board by clicking its two squares. */
export async function playMove(page: Page, uci: string, orientation: "white" | "black", testId = "board") {
  await clickSquare(page, uci.slice(0, 2), orientation, testId);
  await clickSquare(page, uci.slice(2, 4), orientation, testId);
}

interface TrainerSnapshot {
  status: string;
  orientation: "white" | "black";
  expected: { uci: string; san: string } | null;
  fen: string;
}

/** The trainer's session (mock mode exposes the store as window.__trainer). */
export function trainerSession(page: Page): Promise<TrainerSnapshot | null> {
  return page.evaluate(() => {
    const s = (window as unknown as { __trainer: { getState(): { session: TrainerSnapshot | null } } }).__trainer.getState().session;
    return s ? { status: s.status, orientation: s.orientation, expected: s.expected, fen: s.fen } : null;
  });
}

/**
 * Waits until the trainer waits for a move (in a position other than `notFen`: the board
 * reports moves a moment late, so right after a move the old position may still be shown).
 */
export async function waitForYourMove(page: Page, notFen = ""): Promise<TrainerSnapshot> {
  await page.waitForFunction((notFen) => {
    const s = (window as unknown as { __trainer: { getState(): { session: { status: string; fen: string } | null } } }).__trainer.getState().session;
    return s?.status === "yourMove" && s.fen !== notFen;
  }, notFen);
  // Wait until the board accepts moves (React has handed it the legal moves).
  await page.locator('[data-testid="trainer-board"][data-movable="true"]').waitFor();
  await page.waitForTimeout(100);
  return (await trainerSession(page)) as TrainerSnapshot;
}
