// Revenue & business analytics. Honest by construction: Apple owns the real
// money numbers (App Store Connect); this view derives what Firestore can
// truthfully show — subscriber counts, conversion, cohorts — and labels the
// MRR figure as an estimate driven by an editable price assumption.
import { loadUsers, loadTrips, loadAppConfig } from "../data.js";
import { el, clear, fmtMoney, fmtPct, monthKey, toDate } from "../util.js";

export const revenueSection = {
  id: "revenue",
  title: "Revenue",
  icon: "💵",
  async render(host) {
    const [users, trips, config] = await Promise.all([loadUsers(), loadTrips(), loadAppConfig()]);
    const excluded = new Set(config.revenueExcludedUserIds || []);

    const real = users.filter((u) => !u.isTester && !excluded.has(u.id) && !u.isAdmin);
    const paying = real.filter((u) => u.hasPremium && u.premiumSource === "storekit");
    const granted = users.filter((u) => u.hasPremium && u.premiumSource !== "storekit");

    const priceAssumption = Number(localStorage.getItem("dt-price-assumption") || "6.99");
    const mrr = paying.length * priceAssumption;

    // Activation funnel: signed up → logged a drive → got an approval → paying.
    const tripsByUser = new Map();
    for (const t of trips) {
      if (!tripsByUser.has(t.userId)) tripsByUser.set(t.userId, []);
      tripsByUser.get(t.userId).push(t);
    }
    const logged = real.filter((u) => (tripsByUser.get(u.id) || []).length > 0 || (u.lifetimeTripCount ?? 0) > 0);
    const approvedUsers = real.filter((u) => (tripsByUser.get(u.id) || []).some((t) => t.status === "approved"));
    const funnel = [
      ["Signed up", real.length],
      ["Logged a drive", logged.length],
      ["Got an approval", approvedUsers.length],
      ["Paying", paying.length],
    ];

    // Signup cohorts by month with paying share.
    const cohorts = new Map();
    for (const u of real) {
      const key = monthKey(u.createdAt);
      if (key === "unknown") continue;
      if (!cohorts.has(key)) cohorts.set(key, { total: 0, paying: 0 });
      const c = cohorts.get(key);
      c.total += 1;
      if (u.hasPremium && u.premiumSource === "storekit") c.paying += 1;
    }
    const cohortKeys = [...cohorts.keys()].sort().slice(-12);

    // State breakdown (top 8).
    const byState = new Map();
    for (const u of real) {
      const s = u.state || "Unknown";
      if (!byState.has(s)) byState.set(s, { total: 0, paying: 0 });
      const row = byState.get(s);
      row.total += 1;
      if (u.hasPremium && u.premiumSource === "storekit") row.paying += 1;
    }
    const topStates = [...byState.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 8);

    const priceInput = el("input", { type: "number", step: "0.01", value: String(priceAssumption), style: "width:90px" });
    priceInput.addEventListener("change", () => {
      localStorage.setItem("dt-price-assumption", priceInput.value);
      revenueSection.render(host);
    });

    clear(host).append(
      el("div", { class: "grid cols-4" },
        kpi("Paying subscribers", String(paying.length), "StoreKit · testers/excluded removed"),
        kpi("Est. MRR", fmtMoney(mrr), `at ${fmtMoney(priceAssumption)}/mo avg — edit below`),
        kpi("Est. ARR", fmtMoney(mrr * 12), "straight-line from MRR"),
        kpi("Paid conversion", fmtPct(real.length ? paying.length / real.length : 0, 1), `${granted.length} comp/linked premium excluded`),
      ),
      el("div", { class: "card" },
        el("h3", {}, "Assumption"),
        el("p", { class: "card-sub" }, "Real billing lives in App Store Connect. This average net price per payer drives the MRR/ARR estimates:"),
        el("div", { class: "toolbar" }, priceInput, el("span", { class: "kpi-note" }, "$ / payer / month (stored on this device)")),
      ),
      el("div", { class: "grid cols-2" },
        el("div", { class: "card" },
          el("h3", {}, "Activation funnel"),
          funnel.map(([label, count], i) =>
            el("div", { style: "margin-bottom:10px" },
              el("div", { style: "display:flex; justify-content:space-between; font-size:12.5px" },
                el("span", {}, label),
                el("span", {}, `${count}${i ? ` · ${fmtPct(funnel[0][1] ? count / funnel[0][1] : 0)}` : ""}`),
              ),
              el("div", { style: "background:var(--surface-2); border-radius:6px; height:10px; overflow:hidden" },
                el("div", { style: `background:var(--blue); height:100%; width:${funnel[0][1] ? (count / funnel[0][1]) * 100 : 0}%` }),
              ),
            ),
          ),
        ),
        chartCard("Signup cohorts — total vs paying", cohortKeys, [
          { label: "Signups", data: cohortKeys.map((k) => cohorts.get(k).total), backgroundColor: "#c3cbd9" },
          { label: "Paying", data: cohortKeys.map((k) => cohorts.get(k).paying), backgroundColor: "#00b2f0" },
        ]),
      ),
      el("div", { class: "card table-wrap" },
        el("h3", {}, "By state"),
        el("table", {},
          el("thead", {}, el("tr", {}, el("th", {}, "State"), el("th", {}, "Accounts"), el("th", {}, "Paying"), el("th", {}, "Conversion"))),
          el("tbody", {}, topStates.map(([s, row]) =>
            el("tr", {}, el("td", {}, s), el("td", {}, String(row.total)), el("td", {}, String(row.paying)), el("td", {}, fmtPct(row.total ? row.paying / row.total : 0, 1))),
          )),
        ),
      ),
    );
  },
};

function kpi(label, value, note) {
  return el("div", { class: "card kpi" },
    el("div", { class: "kpi-label" }, label),
    el("div", { class: "kpi-value" }, value),
    el("div", { class: "kpi-note" }, note),
  );
}

function chartCard(title, labels, datasets) {
  const canvas = el("canvas");
  const card = el("div", { class: "card" }, el("h3", {}, title), el("div", { class: "chart-box" }, canvas));
  queueMicrotask(() => {
    new Chart(canvas, {
      type: "bar",
      data: { labels, datasets },
      options: { maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } },
    });
  });
  return card;
}
