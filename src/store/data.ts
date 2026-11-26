// "Your data" in Settings: export/import the trainer's cards and history (JSON),
// and back up / restore the whole database. Repertoire PGN files are in
// store/repertoire.ts.

import { backend, toBackendError } from "../backend";
import { localDay, parseTrainingFile, trainingFile } from "../core/srs";
import { tNow } from "../i18n";
import { useToast } from "./toast";
import { useTrainer } from "./trainer";

const toast = (m: string) => useToast.getState().show(m);

export async function exportTraining() {
  try {
    const data = await backend.srsExport();
    const text = JSON.stringify(trainingFile(data.cards, data.reviews), null, 2);
    const name = await backend.fileSaveText(`Tung Tung Chessahur training ${localDay()}.json`, "JSON", "json", text);
    if (name) toast(tNow("data.saved", { name }));
  } catch (e) {
    toast(toBackendError(e).message);
  }
}

export async function importTraining() {
  try {
    const file = await backend.fileOpenText("JSON", ["json"]);
    if (!file) return;
    let parsed: ReturnType<typeof parseTrainingFile>;
    try {
      parsed = parseTrainingFile(file.contents);
    } catch (e) {
      toast(tNow((e as Error).message === "newerTrainingFile" ? "data.newerFile" : "data.notTrainingFile"));
      return;
    }
    const r = await backend.srsImport({ cards: parsed.cards, reviews: parsed.reviews });
    toast(tNow("data.imported", { cards: r.cards, reviews: r.reviews }));
    void useTrainer.getState().load();
  } catch (e) {
    toast(toBackendError(e).message);
  }
}

export async function backupDatabase() {
  try {
    const name = await backend.dbBackup();
    if (name) toast(tNow("data.saved", { name }));
  } catch (e) {
    toast(toBackendError(e).message);
  }
}

/** Replaces everything with a backup, then reloads the app. */
export async function restoreDatabase() {
  try {
    const name = await backend.dbRestore();
    if (!name) return;
    toast(tNow("data.restored", { name }));
    setTimeout(() => location.reload(), 900);
  } catch (e) {
    toast(toBackendError(e).message);
  }
}
