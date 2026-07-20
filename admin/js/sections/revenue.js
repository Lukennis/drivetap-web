// Revenue & business analytics — real plan pricing.
//
// DriveTap sells YEARLY subscriptions (App Store Connect / DriveTap.storekit):
//   drivetap.unlimited.yearly     $9.99/yr  (1 teen)
//   drivetap.unlimited.yearly.t2  $16.98/yr (2 teens)
//   drivetap.unlimited.yearly.t3  $23.97/yr (3 teens)
//   drivetap.unlimited.yearly.t4  $30.96/yr (4 teens)
//   drivetap.unlimited.yearly.t5  $37.95/yr (5 teens)
// The iOS app stamps subscriptionProductId on each subscriber's user doc, so
// ARR here is exact per plan (gross, before Apple's commission). appConfig can
// override prices via planPrices: { productId: yearlyUSD } if ASC pricing
// changes.
import { loadUsers, loadTrips, loadAppConfig, saveConfigValues, invalidate } from "../data.js";
import { el, clear, fmtMoney, fmtPct, monthKey, toast } from "../util.js";

const DEFAULT_PLAN_PRICES = {
  "drivetap.unlimited.yearly": 9.99,
  "drivetap.unlimited.yearly.t2": 16.98,
  "drivetap.unlimited.yearly.t3": 23.97,
  "drivetap.unlimited.yearly.t4": 30.96,
  "drivetap.unlimited.yearly.t5": 37.95,
};
const BASE_PLAN = "drivetap.unlimited.yearly";
const PLAN_LABELS = {
  "drivetap.unlimited.yearly": "1 teen",
  "drivetap.unlimited.yearly.t2": "2 teens",
  "drivetap.unlimited.yearly.t3": "3 teens",
  "drivetap.unlimited.yearly.t4": "4 teens",
  "drivetap.unlimited.yearly.t5": "5 teens",
};

export const revenueSection = {
  id: "revenue",
  title: "Revenue",
  icon: "💵",
  async render(host) {
    const [users, trips, config] = await Promise.all([loadUsers(), loadTrips(), loadAppConfig()]);
    const excluded = new Set(config.revenueExcludedUserIds || []);
    const prices = { ...DEFAULT_PLAN_PRICES, ...(config.planPrices || {}) };

    const real = users.filter((u) => !u.isTester && !excluded.has(u.id) && !u.isAdmin);
    const paying = real.filter((u) => u.hasPremium && u.premiumSource === "storekit");
    const granted = users.filter((u) => u.hasPremium && u.premiumSource && u.premiumSource !== "storekit");

    // Exact ARR: sum each payer's plan price; unknown plan → base plan price.
    let arr = 0;
    let unattributed = 0;
    const byPlan = new Map();
    for (const u of paying) {
      const plan = u.subscriptionProductId && prices[u.subscriptionProductId] != null ? u.subscriptionProductId : null;
      if (!plan) unattributed += 1;
      const effective = plan ?? BASE_PLAN;
      arr += prices[effective];
      byPlan.set(effective, (byPlan.get(effective) || 0) + 1);
    }
    const mrr = arr / 12;

    // Activation funnel.
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

    // Signup cohorts with paying share.
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

    // State breakdown.
    const byState = new Map();
    for (const u of real) {
      const s = u.state || "Unknown";
      if (!byState.has(s)) byState.set(s, { total: 0, paying: 0 });
      const row = byState.get(s);
      row.total += 1;
      if (u.hasPremium && u.premiumSource === "storekit") row.paying += 1;
    }
    const topStates = [...byState.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 8);

    clear(host).append(
      el("div", { class: "grid cols-4" },
        kpi("Paying subscribers", String(paying.length), "StoreKit · testers/excluded removed"),
        kpi("ARR (gross)", fmtMoney(arr), unattributed ? `${unattributed} payer${unattributed === 1 ? "" : "s"} unattributed → counted at base $9.99` : "exact, per stamped plan"),
        kpi("MRR equivalent", fmtMoney(mrr), "ARR ÷ 12 — plans bill yearly"),
        kpi("Paid conversion", fmtPct(real.length ? paying.length / real.length : 0, 1), `${granted.length} comp/linked premium excluded`),
      ),
      el("div", { class: "grid cols-2" },
        el("div", { class: "card table-wrap" },
          el("h3", {}, "Plan mix"),
          el("p", { class: "card-sub" }, "Yearly plans, gross price (Apple's commission not deducted). Override prices via appConfig.planPrices if ASC changes."),
          byPlan.size === 0 ? el("p", { class: "card-sub" }, "No paying subscribers yet.") : el("table", {},
            el("thead", {}, el("tr", {}, el("th", {}, "Plan"), el("th", {}, "Price/yr"), el("th", {}, "Subscribers"), el("th", {}, "ARR"))),
            el("tbody", {}, [...byPlan.entries()].sort((a, b) => b[1] - a[1]).map(([plan, count]) =>
              el("tr", {},
                el("td", {}, el("strong", {}, PLAN_LABELS[plan] ?? plan), el("div", { class: "kpi-note" }, plan)),
                el("td", {}, fmtMoney(prices[plan])),
                el("td", {}, String(count)),
                el("td", {}, fmtMoney(prices[plan] * count)),
              ),
            )),
          ),
        ),
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
      ),
      el("div", { class: "grid cols-2" },
        chartCard("Signup cohorts — total vs paying", cohortKeys, [
          { label: "Signups", data: cohortKeys.map((k) => cohorts.get(k).total), backgroundColor: "#c3cbd9" },
          { label: "Paying", data: cohortKeys.map((k) => cohorts.get(k).paying), backgroundColor: "#00b2f0" },
        ]),
        el("div", { class: "card table-wrap" },
          el("h3", {}, "By state"),
          el("table", {},
            el("thead", {}, el("tr", {}, el("th", {}, "State"), el("th", {}, "Accounts"), el("th", {}, "Paying"), el("th", {}, "Conversion"))),
            el("tbody", {}, topStates.map(([s, row]) =>
              el("tr", {}, el("td", {}, s), el("td", {}, String(row.total)), el("td", {}, String(row.paying)), el("td", {}, fmtPct(row.total ? row.paying / row.total : 0, 1))),
            )),
          ),
        ),
      ),
      priceEditorCard(config, prices, host),
    );
  },
};

/// Editable per-plan prices. App Store Connect is the source of truth for what
/// customers actually pay — set these to match it exactly. Saved to
/// appConfig.planPrices (audit-logged); blank/default values fall back to the
/// built-in table.
function priceEditorCard(config, activePrices, host) {
  const overrides = config.planPrices || {};
  const inputs = new Map();
  const rows = Object.keys(DEFAULT_PLAN_PRICES).map((plan) => {
    const input = el("input", { type: "number", step: "0.01", min: "0", value: String(activePrices[plan]), style: "width:100px" });
    inputs.set(plan, input);
    return el("tr", {},
      el("td", {}, el("strong", {}, PLAN_LABELS[plan]), el("div", { class: "kpi-note" }, plan)),
      el("td", {}, input, " ", el("span", { class: "kpi-note" }, "$/yr")),
      el("td", {}, overrides[plan] != null
        ? el("span", { class: "badge blue" }, "custom")
        : el("span", { class: "badge gray" }, "default")),
    );
  });

  return el("div", { class: "card table-wrap" },
    el("h3", {}, "Plan prices"),
    el("p", { class: "card-sub" }, "Set these to EXACTLY what App Store Connect charges (gross, yearly). All revenue math above updates instantly and the change is audit-logged."),
    el("table", {},
      el("thead", {}, el("tr", {}, el("th", {}, "Plan"), el("th", {}, "Price / year"), el("th", {}, "Source"))),
      el("tbody", {}, rows),
    ),
    el("div", { class: "toolbar", style: "margin-top:12px" },
      el("button", {
        class: "btn primary",
        onclick: async () => {
          const planPrices = {};
          for (const [plan, input] of inputs) {
            const value = Number(input.value);
            if (!Number.isFinite(value) || value < 0) { toast(`Bad price for ${PLAN_LABELS[plan]}`, "error"); return; }
            planPrices[plan] = Math.round(value * 100) / 100;
          }
          const detail = Object.entries(planPrices).map(([p, v]) => `${PLAN_LABELS[p]}=$${v}`).join(", ");
          await saveConfigValues({ planPrices }, `Plan prices set: ${detail}`);
          toast("Prices saved — revenue recalculated");
          invalidate("appConfig");
          revenueSection.render(host);
        },
      }, "Save prices"),
      el("button", {
        class: "btn",
        onclick: async () => {
          await saveConfigValues({ planPrices: undefined }, "Plan prices reset to built-in defaults");
          toast("Reset to defaults");
          invalidate("appConfig");
          revenueSection.render(host);
        },
      }, "Reset to defaults"),
    ),
  );
}

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
