// Pages that arrive in later phases.

import { BookOpen, ChartLine, Compass, GraduationCap } from "lucide-react";
import { useT } from "../../i18n";

const PLACEHOLDERS = {
  explorer: { icon: <Compass />, title: "placeholder.explorer.title", text: "placeholder.explorer.text" },
  repertoire: { icon: <BookOpen />, title: "placeholder.repertoire.title", text: "placeholder.repertoire.text" },
  train: { icon: <GraduationCap />, title: "placeholder.train.title", text: "placeholder.train.text" },
  insights: { icon: <ChartLine />, title: "placeholder.insights.title", text: "placeholder.insights.text" },
} as const;

export function PlaceholderPage({ page }: { page: keyof typeof PLACEHOLDERS }) {
  const t = useT();
  const p = PLACEHOLDERS[page];
  return (
    <div className="page-scroll" style={{ display: "flex" }}>
      <div className="empty-state">
        {p.icon}
        <h2>{t(p.title)}</h2>
        <p>{t(p.text)}</p>
        <span className="badge">{t("placeholder.later")}</span>
      </div>
    </div>
  );
}
