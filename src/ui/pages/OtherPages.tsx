// Pages that arrive in later phases.

import { ChartLine } from "lucide-react";
import { useT } from "../../i18n";

const PLACEHOLDERS = {
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
