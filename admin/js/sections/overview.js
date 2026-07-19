// Overview: the pulse of the product in one screen.
import { loadUsers, loadTrips } from "../data.js";
import { el, clear, fmtHours, toDate, monthKey } from "../util.js";

export const overviewSection = {
  id: "overview",
  title: "Overview",
  icon: "◉",
  async render(host) {
    const [users, trips] = await Promise.all([loadUsers(), loadTrips()]);

    const teens = users.filter((u) => u.role !== "parent");
    const approved = trips.filter((t) => t.status === "approved");
    const pending = trips.filter((t) => t.status === "pending");
    const paying = users.filter((u) => u.hasPremium && u.premiumSource === "storekit" && !u.isTester);
    const weekAgo = Date.now() - 7 * 86400000;
    const activeThisWeek = new Set(
      trips.filter((t) => (toDate(t.startTime)?.getTime() || 0) > weekAgo).map((t) => t.userId),
    );
    const totalApprovedSeconds = approved.reduce((sum, t) => sum + (t.duration || 0), 0);

    const kpis = [
      { label: "Total accounts", value: users.length, note: `${teens.length} drivers · ${users.length - teens.length} parents` },
      { label: "Drives logged", value: trips.length, note: `${approved.length} approved · ${pending.length} pending` },
      { label: "Approved practice", value: fmtHours(totalApprovedSeconds), note: "across all drivers" },
      { label: "Paying subscribers", value: paying.length, note: "StoreKit, testers excluded" },
      { label: "Active drivers (7d)", value: activeThisWeek.size, note: "logged at least one drive" },
      { label: "Pending review", value: pending.length, note: "waiting on a parent" },
    ];

    // Signups + drives per month for the trend charts.
    const signupByMonth = countByMonth(users.map((u) => u.createdAt));
    const drivesByMonth = countByMonth(trips.map((t) => t.startTime));

    clear(host).append(
      el("div", { class: "grid cols-4" },
        kpis.map((k) =>
          el("div", { class: "card kpi" },
            el("div", { class: "kpi-label" }, k.label),
            el("div", { class: "kpi-value" }, String(k.value)),
            el("div", { class: "kpi-note" }, k.note),
          ),
        ),
      ),
      el("div", { class: "grid cols-2" },
        chartCard("Account signups by month", signupByMonth, "#00b2f0"),
        chartCard("Drives logged by month", drivesByMonth, "#fbb829"),
      ),
    );
  },
};

function countByMonth(dates) {
  const counts = new Map();
  for (const raw of dates) {
    const key = monthKey(raw);
    if (key === "unknown") continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const keys = [...counts.keys()].sort().slice(-12);
  return { labels: keys, values: keys.map((k) => counts.get(k)) };
}

function chartCard(title, { labels, values }, color) {
  const canvas = el("canvas");
  const card = el("div", { class: "card" }, el("h3", {}, title), el("div", { class: "chart-box" }, canvas));
  queueMicrotask(() => {
    new Chart(canvas, {
      type: "bar",
      data: { labels, datasets: [{ data: values, backgroundColor: color, borderRadius: 5 }] },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
      },
    });
  });
  return card;
}
