// Deals workspace: prospect pipeline → quote builder → signed partners with
// onboarding checklists. Everything lives in admin-only Firestore collections
// (prospects, quotes, partnerOrgs, partnerOnboarding).
import {
  loadDeals, saveDeal, deleteDeal, loadQuotes, saveQuote,
  loadPartnerOrgs, savePartnerOrg, loadOnboarding, saveOnboardingItem, invalidate,
  loadPartnerRequests, resolvePartnerRequest,
} from "../data.js";
import { el, clear, fmtDate, fmtMoney, toDate, toast } from "../util.js";

const STAGES = [
  ["lead", "Leads"],
  ["demo", "Demo"],
  ["negotiating", "Negotiating"],
  ["signed", "Signed"],
  ["lost", "Lost"],
];

const DEFAULT_ONBOARDING = [
  "Contract signed",
  "Seats provisioned",
  "Staff training session",
  "Student invite links distributed",
  "Launch date confirmed",
];

let tab = "pipeline";

export const dealsSection = {
  id: "deals",
  title: "Deals",
  icon: "🤝",
  async render(host) {
    const container = el("div");
    clear(host).append(
      el("div", { class: "toolbar" },
        tabBtn("pipeline", "Pipeline", host),
        tabBtn("quotes", "Quotes", host),
        tabBtn("partners", "Partners & Onboarding", host),
        el("span", { class: "spacer" }),
        el("a", { class: "btn small", href: "?demo=1#/overview", target: "_blank" }, "Open demo for a pitch ↗"),
      ),
      container,
    );
    if (tab === "pipeline") await renderPipeline(container, host);
    if (tab === "quotes") await renderQuotes(container, host);
    if (tab === "partners") await renderPartners(container, host);
  },
};

function tabBtn(id, label, host) {
  return el("button", {
    class: `btn small${tab === id ? " primary" : ""}`,
    onclick: () => { tab = id; dealsSection.render(host); },
  }, label);
}

// ---- Pipeline ------------------------------------------------------------

async function renderPipeline(container, host) {
  const deals = await loadDeals();
  const totalStudents = deals.filter((d) => d.stage !== "lost").reduce((s, d) => s + (Number(d.students) || 0), 0);

  clear(container).append(
    el("div", { class: "toolbar" },
      el("button", { class: "btn primary small", onclick: () => openDealDrawer(null, host) }, "+ Add prospect"),
      el("span", { class: "kpi-note" }, `${deals.filter((d) => d.stage !== "lost" && d.stage !== "signed").length} active · ${totalStudents.toLocaleString()} student seats in play`),
    ),
    el("div", { class: "kanban" },
      STAGES.map(([stage, label]) => {
        const cards = deals
          .filter((d) => (d.stage || "lead") === stage)
          .sort((a, b) => (toDate(a.nextActionDate)?.getTime() || Infinity) - (toDate(b.nextActionDate)?.getTime() || Infinity));
        return el("div", { class: "kanban-col" },
          el("h4", {}, label, el("span", {}, String(cards.length))),
          cards.map((d) => dealCard(d, host)),
        );
      }),
    ),
  );
}

function dealCard(deal, host) {
  const overdue = toDate(deal.nextActionDate) && toDate(deal.nextActionDate) < new Date();
  return el("div", { class: "deal-card", onclick: () => openDealDrawer(deal, host) },
    el("div", { class: "deal-name" }, deal.name ?? "(unnamed)"),
    el("div", { class: "deal-meta" }, `${deal.city ?? ""}${deal.students ? ` · ~${deal.students} students` : ""}`),
    deal.nextAction
      ? el("div", { class: "deal-next", style: overdue ? "color:var(--red)" : "" },
          `${overdue ? "⚠ " : "→ "}${deal.nextAction}${deal.nextActionDate ? ` (${fmtDate(deal.nextActionDate)})` : ""}`)
      : null,
  );
}

function openDealDrawer(deal, host) {
  const backdrop = el("div", { class: "drawer-backdrop", onclick: close });
  const drawer = el("div", { class: "drawer" });
  document.body.append(backdrop, drawer);
  function close() { backdrop.remove(); drawer.remove(); }

  const d = deal ? { ...deal } : { stage: "lead" };
  const field = (label, key, type = "text") => el("label", { class: "field" }, label,
    el("input", { type, value: d[key] ?? "", oninput: (e) => { d[key] = type === "number" ? Number(e.target.value) : e.target.value; } }));
  const dateField = (label, key) => {
    const existing = toDate(d[key]);
    return el("label", { class: "field" }, label,
      el("input", { type: "date", value: existing ? existing.toISOString().slice(0, 10) : "", onchange: (e) => { d[key] = e.target.value ? new Date(e.target.value + "T09:00:00") : null; } }));
  };
  const notes = el("textarea", { rows: 4, oninput: (e) => { d.notes = e.target.value; } }, d.notes ?? "");

  drawer.append(
    el("div", { class: "drawer-head" },
      el("h2", {}, deal ? deal.name : "New prospect"),
      el("button", { class: "btn small", onclick: close }, "Close"),
    ),
    el("div", { class: "card" },
      field("School / company name", "name"),
      field("Contact name", "contactName"),
      field("Contact email", "contactEmail", "email"),
      field("Phone", "phone"),
      field("City", "city"),
      field("Approx. students / year", "students", "number"),
      el("label", { class: "field" }, "Stage",
        el("select", { onchange: (e) => { d.stage = e.target.value; } },
          STAGES.map(([value, label]) => el("option", { value, ...(value === (d.stage || "lead") ? { selected: "" } : {}) }, label)),
        ),
      ),
      field("Next action", "nextAction"),
      dateField("Next action date", "nextActionDate"),
      el("label", { class: "field" }, "Notes", notes),
      el("div", { class: "toolbar" },
        el("button", {
          class: "btn primary",
          onclick: async () => {
            if (!d.name?.trim()) { toast("Name it first", "warn"); return; }
            const savedId = await saveDeal(d);
            // A signed deal must ALWAYS have a partner org, and the contact's
            // email must be on the portal access list from the start —
            // otherwise the school's own contact can't sign in.
            if (d.stage === "signed") {
              const orgs = await loadPartnerOrgs();
              const existing = orgs.find((o) => o.prospectId === (d.id ?? savedId))
                || orgs.find((o) => (o.name || "").toLowerCase() === (d.name || "").toLowerCase());
              const contactEmail = (d.contactEmail || "").trim().toLowerCase();
              if (!existing) {
                const orgId = await savePartnerOrg({
                  name: d.name, contactName: d.contactName ?? "", contactEmail: contactEmail,
                  memberEmails: contactEmail ? [contactEmail] : [],
                  seats: Number(d.students) || 0, seatsUsed: 0, pricePerSeat: 0,
                  status: "onboarding", signedAt: new Date(), prospectId: d.id ?? savedId,
                });
                for (let i = 0; i < DEFAULT_ONBOARDING.length; i++) {
                  await saveOnboardingItem({ orgId, title: DEFAULT_ONBOARDING[i], done: i === 0, order: i + 1 });
                }
                toast(`${d.name} signed — partner org created, ${contactEmail || "no email"} can sign in to the portal 🎉`);
              } else if (contactEmail && !(existing.memberEmails || []).includes(contactEmail)) {
                await savePartnerOrg({ id: existing.id, memberEmails: [...(existing.memberEmails || []), contactEmail] });
                toast(`${contactEmail} added to ${existing.name}'s portal access`);
              } else {
                toast("Saved");
              }
            } else {
              toast("Saved");
            }
            close();
            dealsSection.render(host);
          },
        }, "Save"),
        deal ? el("button", {
          class: "btn danger",
          onclick: async () => {
            if (!confirm(`Delete prospect "${deal.name}"? This can't be undone.`)) return;
            await deleteDeal(deal.id);
            toast("Deleted");
            close();
            dealsSection.render(host);
          },
        }, "Delete") : null,
      ),
    ),
  );
}

// ---- Quotes --------------------------------------------------------------

async function renderQuotes(container, host) {
  const quotes = await loadQuotes();
  const q = { seats: 100, pricePerSeat: 4.5, discountPct: 0, termMonths: 12 };

  const input = (label, key, type = "text", attrs = {}) => el("label", { class: "field" }, label,
    el("input", { type, value: q[key] ?? "", ...attrs, oninput: (e) => { q[key] = type === "number" ? Number(e.target.value) : e.target.value; refreshMath(); } }));

  const mathBox = el("div", { class: "kv" });
  function refreshMath() {
    const monthly = (Number(q.seats) || 0) * (Number(q.pricePerSeat) || 0) * (1 - (Number(q.discountPct) || 0) / 100);
    clear(mathBox).append(
      el("dt", {}, "Monthly"), el("dd", {}, el("strong", {}, fmtMoney(monthly))),
      el("dt", {}, "Per term"), el("dd", {}, `${fmtMoney(monthly * (Number(q.termMonths) || 1))} over ${q.termMonths || 1} months`),
      el("dt", {}, "Per student"), el("dd", {}, `${fmtMoney((Number(q.pricePerSeat) || 0) * (1 - (Number(q.discountPct) || 0) / 100))}/mo after discount`),
    );
  }
  refreshMath();

  clear(container).append(
    el("div", { class: "grid cols-2" },
      el("div", { class: "card" },
        el("h3", {}, "New quote"),
        input("School name", "schoolName"),
        input("Contact name", "contactName"),
        input("Seats", "seats", "number", { min: "1" }),
        input("Price per seat / month ($)", "pricePerSeat", "number", { step: "0.25" }),
        input("Discount %", "discountPct", "number", { min: "0", max: "100" }),
        input("Term (months)", "termMonths", "number", { min: "1" }),
        el("label", { class: "field" }, "Notes", el("textarea", { rows: 2, oninput: (e) => { q.notes = e.target.value; } })),
        mathBox,
        el("div", { class: "toolbar" },
          el("button", {
            class: "btn primary",
            onclick: async () => {
              if (!q.schoolName?.trim()) { toast("School name first", "warn"); return; }
              await saveQuote({ ...q });
              toast("Quote saved");
              dealsSection.render(host);
            },
          }, "Save quote"),
          el("button", { class: "btn", onclick: () => printQuote(q) }, "Print / PDF"),
        ),
      ),
      el("div", { class: "card table-wrap" },
        el("h3", {}, "Saved quotes"),
        quotes.length === 0 ? el("p", { class: "card-sub" }, "None yet.") : el("table", {},
          el("thead", {}, el("tr", {}, el("th", {}, "School"), el("th", {}, "Seats"), el("th", {}, "Monthly"), el("th", {}, "Created"), el("th", {}, ""))),
          el("tbody", {}, quotes.map((quote) => {
            const monthly = (quote.seats || 0) * (quote.pricePerSeat || 0) * (1 - (quote.discountPct || 0) / 100);
            return el("tr", {},
              el("td", {}, el("strong", {}, quote.schoolName)),
              el("td", {}, String(quote.seats)),
              el("td", {}, fmtMoney(monthly)),
              el("td", {}, fmtDate(quote.createdAt)),
              el("td", {}, el("button", { class: "btn small", onclick: () => printQuote(quote) }, "Print")),
            );
          })),
        ),
      ),
    ),
  );
}

function printQuote(q) {
  const monthly = (q.seats || 0) * (q.pricePerSeat || 0) * (1 - (q.discountPct || 0) / 100);
  const win = window.open("", "_blank");
  win.document.write(`<!DOCTYPE html><html><head><title>DriveTap Quote — ${q.schoolName ?? ""}</title>
    <style>
      body { font-family: -apple-system, Segoe UI, sans-serif; color: #10131a; max-width: 640px; margin: 48px auto; padding: 0 24px; }
      .head { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #00b2f0; padding-bottom: 16px; }
      .mark { font-size: 26px; font-weight: 800; color: #000029; } .mark span { color: #00b2f0; }
      table { width: 100%; border-collapse: collapse; margin: 28px 0; }
      td, th { text-align: left; padding: 10px 8px; border-bottom: 1px solid #e2e6ee; }
      .total { font-size: 20px; font-weight: 800; }
      .foot { color: #5c6572; font-size: 12px; margin-top: 40px; }
    </style></head><body>
    <div class="head"><div class="mark">Drive<span>Tap</span></div><div>Quote · ${new Date().toLocaleDateString()}</div></div>
    <h2>Prepared for ${q.schoolName ?? ""}</h2>
    ${q.contactName ? `<p>Attn: ${q.contactName}</p>` : ""}
    <table>
      <tr><th>Item</th><th style="text-align:right">Amount</th></tr>
      <tr><td>DriveTap student seats × ${q.seats}</td><td style="text-align:right">${fmtMoney(q.pricePerSeat)} / seat / month</td></tr>
      ${q.discountPct ? `<tr><td>Partner discount</td><td style="text-align:right">−${q.discountPct}%</td></tr>` : ""}
      <tr><td class="total">Monthly total</td><td class="total" style="text-align:right">${fmtMoney(monthly)}</td></tr>
      <tr><td>Term</td><td style="text-align:right">${q.termMonths} months · ${fmtMoney(monthly * (q.termMonths || 1))}</td></tr>
    </table>
    <p>Every seat includes automatic drive logging, skill detection, parent/instructor approvals, state-specific hour tracking, and official log exports.</p>
    ${q.notes ? `<p><em>${q.notes}</em></p>` : ""}
    <p class="foot">Quote valid 30 days. DriveTap · ennisventures.com</p>
    <script>window.print()</` + `script></body></html>`);
  win.document.close();
}

// ---- Partners & onboarding -----------------------------------------------

async function renderPartners(container, host) {
  let [orgs, requests] = await Promise.all([loadPartnerOrgs(), loadPartnerRequests()]);

  // Self-heal orgs created before contact emails were auto-added to portal
  // access: any org with a contact email but an empty access list gets its
  // contact enrolled, so the school's own contact can always sign in.
  let healed = 0;
  for (const org of orgs) {
    const contactEmail = (org.contactEmail || "").trim().toLowerCase();
    if (contactEmail && !(org.memberEmails || []).length) {
      await savePartnerOrg({ id: org.id, memberEmails: [contactEmail] });
      healed += 1;
    }
  }
  if (healed) {
    toast(`Fixed portal access for ${healed} partner org${healed === 1 ? "" : "s"} (contact email enrolled)`);
    invalidate("partnerOrgs");
    orgs = await loadPartnerOrgs();
  }
  const open = requests.filter((r) => r.status === "open");
  const pieces = [];
  if (open.length) {
    pieces.push(el("div", { class: "card" },
      el("h3", {}, `Open requests from schools (${open.length})`),
      open.map((r) =>
        el("div", { class: "check-row" },
          el("div", { style: "flex:1" },
            el("strong", {}, r.orgName ?? r.orgId),
            el("div", { class: "kpi-note" }, `${r.type === "seats" ? `+${r.quantity} seats` : r.type} · ${r.requestedByEmail ?? ""} · ${fmtDate(r.createdAt)}`),
          ),
          el("button", { class: "btn small primary", onclick: async () => { await resolvePartnerRequest(r.id, "done"); toast("Marked done"); dealsSection.render(host); } }, "Done"),
          el("button", { class: "btn small", onclick: async () => { await resolvePartnerRequest(r.id, "declined"); dealsSection.render(host); } }, "Decline"),
        ),
      ),
    ));
  }
  pieces.push(orgs.length === 0
    ? el("div", { class: "card" }, el("h3", {}, "No partners yet"), el("p", { class: "card-sub" }, 'Move a pipeline deal to "Signed" and the partner org + onboarding checklist are created automatically.'))
    : el("div", { class: "grid cols-2" }, orgs.map((org) => partnerCard(org, host))));
  clear(container).append(...pieces);
}

function partnerCard(org, host) {
  const card = el("div", { class: "card" },
    el("div", { style: "display:flex; justify-content:space-between; align-items:start" },
      el("div", {},
        el("h3", {}, org.name),
        el("p", { class: "card-sub" }, `${org.contactName ?? ""} · signed ${fmtDate(org.signedAt)}`),
      ),
      el("span", { class: `badge ${org.status === "live" ? "green" : "orange"}` }, org.status ?? "onboarding"),
    ),
    el("dl", { class: "kv" },
      el("dt", {}, "Seats"), el("dd", {}, `${org.seatsUsed ?? 0} used of ${org.seats ?? 0}`),
      el("dt", {}, "Price"), el("dd", {}, org.pricePerSeat ? `${fmtMoney(org.pricePerSeat)}/seat/mo · ${fmtMoney((org.seats || 0) * org.pricePerSeat)}/mo` : "not set"),
      el("dt", {}, "Portal staff"), el("dd", {}, (org.memberEmails || []).length ? (org.memberEmails || []).join(", ") : "none — portal locked"),
    ),
    partnerEditBlock(org, host),
  );
  const listHost = el("div", { style: "margin-top:10px" }, el("p", { class: "card-sub" }, "Loading checklist…"));
  card.append(listHost);
  loadOnboarding(org.id).then((items) => renderChecklist(listHost, org, items, host));
  return card;
}

/// Seats, per-seat price, and portal staff emails — the emails are the
/// portal's access list: anyone signing in with one of these Google accounts
/// sees this org's students. Server-enforced by Firestore rules.
function partnerEditBlock(org, host) {
  const seats = el("input", { type: "number", value: String(org.seats ?? 0), min: "0", style: "width:80px" });
  const price = el("input", { type: "number", value: String(org.pricePerSeat ?? 0), step: "0.25", min: "0", style: "width:90px" });
  const emails = el("textarea", { rows: 2, placeholder: "staff@school.com, office@school.com" }, (org.memberEmails || []).join(", "));
  return el("details", { style: "margin-top:8px" },
    el("summary", { style: "cursor:pointer; font-size:12.5px; color:var(--blue)" }, "Edit org (seats · price · portal staff)"),
    el("div", { style: "margin-top:8px" },
      el("div", { class: "toolbar" },
        el("span", { class: "kpi-note" }, "Seats"), seats,
        el("span", { class: "kpi-note" }, "$/seat/mo"), price,
      ),
      el("label", { class: "field" }, "Portal staff emails (comma-separated — these accounts can sign in to the school portal)", emails),
      el("button", {
        class: "btn small primary",
        onclick: async () => {
          const memberEmails = emails.value.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@"));
          await savePartnerOrg({
            id: org.id,
            seats: Number(seats.value) || 0,
            pricePerSeat: Number(price.value) || 0,
            memberEmails,
          });
          toast("Org updated");
          dealsSection.render(host);
        },
      }, "Save org"),
    ),
  );
}

function renderChecklist(hostNode, org, items, host) {
  const done = items.filter((i) => i.done).length;
  const addInput = el("input", { type: "text", placeholder: "Add step…", style: "flex:1" });
  clear(hostNode).append(
    el("p", { class: "card-sub" }, `Onboarding: ${done}/${items.length}`),
    items.map((item) =>
      el("div", { class: `check-row${item.done ? " done" : ""}` },
        el("input", {
          type: "checkbox", ...(item.done ? { checked: "" } : {}),
          onchange: async (e) => {
            await saveOnboardingItem({ ...item, done: e.target.checked });
            const fresh = await loadOnboarding(org.id);
            // Flip the org live when the list completes.
            if (fresh.length && fresh.every((i) => i.done) && org.status !== "live") {
              await savePartnerOrg({ id: org.id, status: "live" });
              toast(`${org.name} is LIVE 🎉`);
              invalidate("partnerOrgs");
              dealsSection.render(host);
              return;
            }
            renderChecklist(hostNode, org, fresh, host);
          },
        }),
        el("span", { class: "check-label" }, item.title),
      ),
    ),
    el("div", { class: "toolbar", style: "margin-top:6px" },
      addInput,
      el("button", {
        class: "btn small",
        onclick: async () => {
          const title = addInput.value.trim();
          if (!title) return;
          await saveOnboardingItem({ orgId: org.id, title, done: false, order: items.length + 1 });
          renderChecklist(hostNode, org, await loadOnboarding(org.id), host);
        },
      }, "Add"),
    ),
  );
}
