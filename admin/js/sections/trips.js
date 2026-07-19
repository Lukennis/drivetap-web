// Trips: fleet-wide drive inspector — filter, moderate, export.
import { loadTrips, loadUsers, updateTripStatus } from "../data.js";
import { el, clear, fmtDateTime, fmtMiles, downloadCSV, toast, toDate, debounce } from "../util.js";

const state = { status: "all", search: "", days: "30" };

export const tripsSection = {
  id: "trips",
  title: "Drives",
  icon: "🛣",
  async render(host) {
    const [trips, users] = await Promise.all([loadTrips(), loadUsers()]);
    const nameOf = new Map(users.map((u) => [u.id, `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email || u.id]));
    const container = el("div");
    clear(host).append(container);
    draw(container, trips, nameOf);
  },
};

function draw(container, trips, nameOf) {
  const cutoff = state.days === "all" ? 0 : Date.now() - Number(state.days) * 86400000;
  const q = state.search.toLowerCase();
  const rows = trips.filter((t) => {
    if (state.status !== "all" && t.status !== state.status) return false;
    if ((toDate(t.startTime)?.getTime() || 0) < cutoff) return false;
    if (q && !(nameOf.get(t.userId) || "").toLowerCase().includes(q)) return false;
    return true;
  });

  clear(container).append(
    el("div", { class: "toolbar" },
      el("input", { type: "text", placeholder: "Filter by driver…", value: state.search, oninput: debounce((e) => { state.search = e.target.value; draw(container, trips, nameOf); }, 200) }),
      sel(["all|Any status", "pending|Pending", "approved|Approved", "rejected|Rejected"], state.status, (v) => { state.status = v; draw(container, trips, nameOf); }),
      sel(["7|Last 7 days", "30|Last 30 days", "90|Last 90 days", "all|All loaded"], state.days, (v) => { state.days = v; draw(container, trips, nameOf); }),
      el("span", { class: "spacer" }),
      el("button", {
        class: "btn small",
        onclick: () => downloadCSV(`drivetap-drives-${new Date().toISOString().slice(0, 10)}.csv`, rows.map((t) => ({
          id: t.id, driver: nameOf.get(t.userId) ?? t.userId, start: fmtDateTime(t.startTime),
          minutes: Math.round((t.duration || 0) / 60), miles: t.distanceMeters ? (t.distanceMeters / 1609.34).toFixed(1) : "",
          night_minutes: t.nightMinutes ?? 0, status: t.status, category: t.practiceCategoryId ?? "",
          signed: t.supervisorSignaturePNG ? "yes" : "no", safety: t.safetyScore?.overall ?? "",
          maneuvers: (t.detectedManeuvers || []).join("; "),
        }))),
      }, `Export CSV (${rows.length})`),
    ),
    el("div", { class: "card table-wrap" },
      el("table", {},
        el("thead", {}, el("tr", {},
          el("th", {}, "Driver"), el("th", {}, "Start"), el("th", {}, "Length"),
          el("th", {}, "Night"), el("th", {}, "Safety"), el("th", {}, "Signed"), el("th", {}, "Status"), el("th", {}, ""),
        )),
        el("tbody", {}, rows.slice(0, 300).map((t) => row(t, nameOf, () => draw(container, trips, nameOf)))),
      ),
      rows.length > 300 ? el("p", { class: "card-sub" }, `Showing 300 of ${rows.length}.`) : null,
    ),
  );
}

function sel(options, current, onChange) {
  return el("select", { onchange: (e) => onChange(e.target.value) },
    options.map((opt) => {
      const [value, label] = opt.split("|");
      return el("option", { value, ...(value === current ? { selected: "" } : {}) }, label);
    }),
  );
}

function row(t, nameOf, refresh) {
  const badgeClass = t.status === "approved" ? "green" : t.status === "pending" ? "orange" : "red";
  return el("tr", {},
    el("td", {}, el("strong", {}, nameOf.get(t.userId) ?? t.userId)),
    el("td", {}, fmtDateTime(t.startTime)),
    el("td", {}, `${Math.round((t.duration || 0) / 60)}m · ${fmtMiles(t.distanceMeters)}`),
    el("td", {}, t.nightMinutes ? `${t.nightMinutes}m` : "—"),
    el("td", {}, t.safetyScore?.overall != null ? String(t.safetyScore.overall) : "—"),
    el("td", {}, t.supervisorSignaturePNG ? el("span", { class: "badge green" }, "✓") : el("span", { class: "badge gray" }, "—")),
    el("td", {}, el("span", { class: `badge ${badgeClass}` }, t.status)),
    el("td", {},
      t.status === "pending"
        ? el("span", {},
            el("button", { class: "btn small", onclick: async () => { await updateTripStatus(t, "approved"); toast("Approved"); t.status = "approved"; refresh(); } }, "Approve"),
            " ",
            el("button", { class: "btn small danger", onclick: async () => { await updateTripStatus(t, "rejected"); toast("Rejected"); t.status = "rejected"; refresh(); } }, "Reject"),
          )
        : null,
    ),
  );
}
