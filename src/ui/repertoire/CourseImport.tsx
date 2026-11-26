// Importing a course / book / study PGN as a repertoire: a sheet to check what was
// read (name, side, chapters, comments) before creating it.

import { useT } from "../../i18n";
import { useRepertoire } from "../../store/repertoire";
import type { Color } from "../../core/types";
import { Button, Segmented, Sheet, Spinner } from "../components/controls";

export function CourseImportSheet() {
  const t = useT();
  const draft = useRepertoire((s) => s.courseDraft);
  const { editCourseDraft, cancelCourse, importCourse } = useRepertoire.getState();
  if (!draft) return null;
  const r = draft.read;
  const mine = r.moves.filter((m) => m.mine).length;
  const replies = r.moves.length - mine;

  return (
    <Sheet
      open
      onClose={cancelCourse}
      title={t("course.title")}
      description={draft.fileName}
      footer={
        <>
          <Button onClick={cancelCourse}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={() => void importCourse()} disabled={draft.importing || mine === 0}>
            {draft.importing && <Spinner small />} {t("course.import")}
          </Button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="c-name">{t("course.name")}</label>
        <input id="c-name" className="text-input" value={draft.name} onChange={(e) => editCourseDraft({ name: e.target.value })} />
      </div>
      <div className="field">
        <label>{t("course.side")}</label>
        <Segmented<Color>
          label={t("course.side")}
          value={draft.color}
          onChange={(color) => editCourseDraft({ color })}
          options={[
            { value: "white", label: t("color.white") },
            { value: "black", label: t("color.black") },
          ]}
        />
        <p className="hint">{t(r.colorFrom === "header" ? "course.sideFromFile" : "course.sideGuessed")}</p>
      </div>
      <ul className="course-summary">
        <li>{t("course.chapters", { count: r.chapters })}</li>
        <li>{t("course.yourMoves", { count: mine })}</li>
        <li>{t("course.replies", { count: replies })}</li>
        <li>{t("course.comments", { count: r.comments })}</li>
        {r.sideLines > 0 && <li>{t("course.sideLines", { count: r.sideLines })}</li>}
        {r.skippedChapters > 0 && <li>{t("course.skipped", { count: r.skippedChapters })}</li>}
      </ul>
      {mine === 0 && <p className="error-text">{t("course.nothingForSide")}</p>}
      <p className="hint">{t("course.private")}</p>
    </Sheet>
  );
}
