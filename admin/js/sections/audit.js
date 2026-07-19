// Audit log — the shared trail both admin surfaces write to.
import { loadAudit } from "../data.js";
import { el, clear, fmtDateTime, downloadCSV, debounce } from "../util.js";

const state = { search: "", action: "all" };

export const auditSection = {
  id: "audit",
  title: "Audit Log",
  icon: "🧾",
  async render(host) {
    const entries = await loadAudit();
    const container = el("div");
    clear(host).append(container);
    draw(container, entries);
  },
};

function draw(container, entries) {
  const actions = [...new Set(entries.map((e) => e.action))].sort();
  const q = state.search.toLowerCase();
  const rows = entries.filter((e) => {
    if (state.action !== "all" && e.action !== state.action) return false;
    if (q && !`${e.detail ?? ""} ${e.targetId ?? ""} ${e.adminName ?? ""}`.toLowerCase().includes(q)) return false;
    return true;
  });

  clear(container).append(
    el("div", { class: "toolbar" },
      el("input", { type: "text", placeholder: "Search detail, target, admin…", value: state.search, style: "min-width:240px", oninput: debounce((e) => { state.search = e.target.value; draw(container, entries); }, 200) }),
      el("select", { onchange: (e) => { state.action = e.target.value; draw(container, entries); } },
        el("option", { value: "all" }, "All actions"),
        actions.map((a) => el("option", { value: a, ...(a === state.action ? { selected: "" } : {}) }, a)),
      ),
      el("span", { class: "spacer" }),
      el("button", {
        class: "btn small",
        onclick: () => downloadCSV("drivetap-audit.csv", rows.map((e) => ({
          when: fmtDateTime(e.createdAt), action: e.action, target: `${e.targetType}:${e.targetId}`,
          detail: e.detail, admin: e.adminName,
        }))),
      }, `Export CSV (${rows.length})`),
    ),
    el("div", { class: "card table-wrap" },
      el("table", {},
        el("thead", {}, el("tr", {}, el("th", {}, "When"), el("th", {}, "Action"), el("th", {}, "Detail"), el("th", {}, "Admin"))),
        el("tbody", {}, rows.slice(0, 300).map((e) =>
          el("tr", {},
            el("td", { style: "white-space:nowrap" }, fmtDateTime(e.createdAt)),
            el("td", {}, el("span", { class: "badge blue" }, e.action)),
            el("td", {}, e.detail ?? "", e.targetId ? el("div", { class: "kpi-note" }, `${e.targetType}: ${e.targetId}`) : null),
            el("td", {}, e.adminName ?? "—"),
          ),
        )),
      ),
    ),
  );
}
