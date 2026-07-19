// Shell + hash router. Each section registers { id, title, icon, render }.
// render(host) is called lazily on first visit and re-called on revisit so
// sections always reflect fresh cache state.
import { initAuth } from "./auth.js";
import { isDemo } from "./data.js";
import { el, clear } from "./util.js";
import { overviewSection } from "./sections/overview.js";
import { usersSection } from "./sections/users.js";
import { tripsSection } from "./sections/trips.js";
import { revenueSection } from "./sections/revenue.js";
import { configSection } from "./sections/config.js";
import { broadcastsSection } from "./sections/broadcasts.js";
import { auditSection } from "./sections/audit.js";
import { dealsSection } from "./sections/deals.js";

const sections = [
  { group: "Product" },
  overviewSection,
  usersSection,
  tripsSection,
  revenueSection,
  { group: "Operations" },
  configSection,
  broadcastsSection,
  auditSection,
  { group: "Business" },
  dealsSection,
];

function currentSectionId() {
  return location.hash.replace(/^#\/?/, "") || "overview";
}

function renderNav() {
  const nav = document.getElementById("nav");
  clear(nav);
  const active = currentSectionId().split("/")[0];
  for (const section of sections) {
    if (section.group) {
      nav.append(el("div", { class: "nav-group" }, section.group));
      continue;
    }
    nav.append(
      el(
        "a",
        {
          class: `nav-item${section.id === active ? " active" : ""}`,
          href: `#/${section.id}`,
        },
        el("span", { class: "nav-icon", html: section.icon }),
        section.title,
      ),
    );
  }
}

async function renderSection() {
  const [id, ...rest] = currentSectionId().split("/");
  const section = sections.find((s) => s.id === id) || sections.find((s) => s.id === "overview");
  const host = document.getElementById("content");
  clear(host);
  document.getElementById("section-title").textContent = section.title;
  renderNav();
  try {
    await section.render(host, rest);
  } catch (err) {
    console.error(err);
    clear(host).append(
      el("div", { class: "card error-card" },
        el("h3", {}, "Couldn't load this section"),
        el("p", {}, String(err.message || err)),
      ),
    );
  }
}

initAuth(() => {
  if (isDemo) {
    document.getElementById("demo-banner").classList.remove("hidden");
  }
  window.addEventListener("hashchange", renderSection);
  renderSection();
});
