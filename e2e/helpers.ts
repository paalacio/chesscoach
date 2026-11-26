import type { Page } from "@playwright/test";

export const RUY_PGN = `[Event "Example"]
[White "White"]
[Black "Black"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 *`;

/** Clicks a square on the board (white at the bottom). */
export async function clickSquare(page: Page, square: string, orientation: "white" | "black" = "white") {
  const board = page.getByTestId("board");
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
  await page.getByRole("navigation", { name: "Sections" }).waitFor();
}

export async function importPgn(page: Page, pgn: string) {
  await page.getByRole("button", { name: "Import PGN or FEN" }).click();
  await page.getByRole("textbox", { name: "PGN or FEN" }).fill(pgn);
  await page.getByRole("button", { name: "Import", exact: true }).click();
}
