// Users: search, filter, sort, bulk actions, CSV export, and the full
// support deep-dive drawer (profile, subscription controls, drives, notes).
import {
  loadUsers, loadTripsForUser, loadNotes, updateUserFields, addNote, deleteNote, invalidate, session,
  loadPartnerOrgs,
} from "../data.js";
import {
  el, clear, fmtDate, fmtDateTime, fmtHours, fmtMiles, toDate, downloadCSV, toast, debounce, decodePolyline, escapeHTML,
} from "../util.js";

const state = { search: "", role: "all", flag: "all", sortKey: "createdAt", sortDir: -1, selected: new Set() };

export const usersSection = {
  id: "users",
  title: "Users",
  icon: "👤",
  async render(host) {
    const users = await loadUsers();
    const container = el("div");
    clear(host).append(container);
    draw(container, users);
  },
};

function applyFilters(users) {
  const q = state.search.toLowerCase();
  let rows = users.filter((u) => {
    if (q) {
      const hay = `${u.firstName ?? ""} ${u.lastName ?? ""} ${u.email ?? ""} ${u.state ?? ""} ${u.displayAccountId ?? ""} ${u.inviteCode ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (state.role !== "all" && (u.role || "standalone") !== state.role) return false;
    if (state.flag === "premium" && !u.hasPremium) return false;
    if (state.flag === "paying" && !(u.hasPremium && u.premiumSource === "storekit" && !u.isTester)) return false;
    if (state.flag === "tester" && !u.isTester) return false;
    if (state.flag === "suspended" && !u.isSuspended) return false;
    if (state.flag === "admin" && !u.isAdmin) return false;
    return true;
  });
  rows.sort((a, b) => {
    const av = sortValue(a, state.sortKey);
    const bv = sortValue(b, state.sortKey);
    return (av < bv ? -1 : av > bv ? 1 : 0) * state.sortDir;
  });
  return rows;
}

function sortValue(u, key) {
  switch (key) {
    case "name": return `${u.firstName ?? ""} ${u.lastName ?? ""}`.toLowerCase();
    case "state": return u.state ?? "";
    case "role": return u.role ?? "";
    case "trips": return u.lifetimeTripCount ?? 0;
    case "createdAt": return toDate(u.createdAt)?.getTime() ?? 0;
    default: return 0;
  }
}

function draw(container, users) {
  const rows = applyFilters(users);
  const toolbar = el("div", { class: "toolbar" },
    el("input", {
      type: "text", placeholder: "Search name, email, state, account ID…", value: state.search, style: "min-width:260px",
      oninput: debounce((e) => { state.search = e.target.value; draw(container, users); }, 200),
    }),
    select(["all|All roles", "teen|Teens", "parent|Parents", "standalone|Standalone"], state.role, (v) => { state.role = v; draw(container, users); }),
    select(["all|All flags", "paying|Paying", "premium|Premium (any)", "tester|Testers", "suspended|Suspended", "admin|Admins"], state.flag, (v) => { state.flag = v; draw(container, users); }),
    el("span", { class: "spacer" }),
    state.selected.size
      ? el("span", {}, `${state.selected.size} selected `,
          el("button", { class: "btn small", onclick: () => bulk(users, container, { isTester: true }, "Marked tester") }, "Mark tester"),
          " ",
          el("button", { class: "btn small", onclick: () => bulk(users, container, { isTester: false }, "Cleared tester") }, "Clear tester"),
          " ",
          el("button", { class: "btn small danger", onclick: () => bulk(users, container, { isSuspended: true }, "Suspended") }, "Suspend"),
          " ",
          el("button", { class: "btn small", onclick: () => bulk(users, container, { isSuspended: false }, "Unsuspended") }, "Unsuspend"),
        )
      : null,
    el("button", {
      class: "btn small",
      onclick: () => downloadCSV(`drivetap-users-${new Date().toISOString().slice(0, 10)}.csv`, rows.map((u) => ({
        id: u.id, firstName: u.firstName, lastName: u.lastName, email: u.email, role: u.role,
        state: u.state, premium: u.hasPremium ? "yes" : "no", premiumSource: u.premiumSource ?? "",
        tester: u.isTester ? "yes" : "no", suspended: u.isSuspended ? "yes" : "no",
        lifetimeDrives: u.lifetimeTripCount ?? 0, created: fmtDate(u.createdAt),
      }))),
    }, `Export CSV (${rows.length})`),
  );

  const header = (label, key) => el("th", { onclick: () => { state.sortDir = state.sortKey === key ? -state.sortDir : -1; state.sortKey = key; draw(container, users); } },
    `${label}${state.sortKey === key ? (state.sortDir > 0 ? " ↑" : " ↓") : ""}`);

  const table = el("div", { class: "card table-wrap" },
    el("table", {},
      el("thead", {}, el("tr", {},
        el("th", {}, ""),
        header("Name", "name"), header("Role", "role"), header("State", "state"),
        el("th", {}, "Flags"), header("Drives", "trips"), header("Joined", "createdAt"),
      )),
      el("tbody", {}, rows.slice(0, 400).map((u) =>
        el("tr", { class: "clickable", onclick: (e) => { if (e.target.type !== "checkbox") openUserDrawer(u); } },
          el("td", {}, el("input", {
            type: "checkbox", ...(state.selected.has(u.id) ? { checked: "" } : {}),
            onchange: (e) => { e.target.checked ? state.selected.add(u.id) : state.selected.delete(u.id); draw(container, users); },
          })),
          el("td", {}, el("strong", {}, `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || "(no name)"), el("div", { class: "kpi-note" }, u.email ?? "")),
          el("td", {}, u.role ?? "standalone"),
          el("td", {}, u.state ?? "—"),
          el("td", {}, flags(u)),
          el("td", {}, String(u.lifetimeTripCount ?? 0)),
          el("td", {}, fmtDate(u.createdAt)),
        ),
      )),
    ),
    rows.length > 400 ? el("p", { class: "card-sub" }, `Showing 400 of ${rows.length} — narrow the search to see the rest.`) : null,
  );

  clear(container).append(toolbar, table);
}

function select(options, current, onChange) {
  return el("select", { onchange: (e) => onChange(e.target.value) },
    options.map((opt) => {
      const [value, label] = opt.split("|");
      return el("option", { value, ...(value === current ? { selected: "" } : {}) }, label);
    }),
  );
}

function flags(u) {
  const out = [];
  if (u.isAdmin) out.push(el("span", { class: "badge blue" }, "admin"));
  if (u.hasPremium && u.premiumSource === "storekit" && !u.isTester) out.push(el("span", { class: "badge green" }, "paying"));
  else if (u.hasPremium) out.push(el("span", { class: "badge yellow" }, "premium"));
  if (u.isTester) out.push(el("span", { class: "badge gray" }, "tester"));
  if (u.isSuspended) out.push(el("span", { class: "badge red" }, "suspended"));
  return out.length ? out.flatMap((b, i) => (i ? [" ", b] : [b])) : el("span", { class: "badge gray" }, "free");
}

async function bulk(users, container, fields, label) {
  const ids = [...state.selected];
  for (const id of ids) {
    await updateUserFields(id, fields, `${label} (bulk, web admin)`);
  }
  toast(`${label}: ${ids.length} user${ids.length === 1 ? "" : "s"}`);
  state.selected.clear();
  invalidate("users");
  draw(container, await loadUsers());
}

// ---- Detail drawer -------------------------------------------------------

async function openUserDrawer(user) {
  const backdrop = el("div", { class: "drawer-backdrop", onclick: close });
  const drawer = el("div", { class: "drawer" });
  document.body.append(backdrop, drawer);
  function close() { backdrop.remove(); drawer.remove(); }

  const name = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || "(no name)";
  drawer.append(
    el("div", { class: "drawer-head" },
      el("div", {}, el("h2", {}, name), el("div", { class: "kpi-note" }, `${user.role ?? "standalone"} · ${user.state ?? "no state"} · ${user.email ?? "no email"}`)),
      el("button", { class: "btn small", onclick: close }, "Close"),
    ),
    el("div", { class: "card" },
      el("h3", {}, "Account"),
      el("dl", { class: "kv" },
        kv("User ID", user.id),
        kv("Account #", user.displayAccountId ?? "—"),
        kv("Invite code", user.inviteCode ?? "—"),
        kv("Joined", fmtDate(user.createdAt)),
        kv("State goal", `${user.requiredHoursGoal ?? "?"}h supervised · ${user.requiredNightHoursGoal ?? "?"}h night`),
        kv("Lifetime drives", String(user.lifetimeTripCount ?? 0)),
        kv("Premium", user.hasPremium ? `yes (${user.premiumSource ?? "unknown"})` : "no"),
      ),
    ),
    controlsCard(user, close),
  );

  const tripsCard = el("div", { class: "card" }, el("h3", {}, "Drives"), el("p", { class: "card-sub" }, "Loading…"));
  const notesCard = el("div", { class: "card" }, el("h3", {}, "Admin notes"), el("p", { class: "card-sub" }, "Loading…"));
  drawer.append(tripsCard, notesCard);

  loadTripsForUser(user.id).then((trips) => renderTrips(tripsCard, trips));
  refreshNotes(notesCard, user);
}

function kv(label, value) {
  return [el("dt", {}, label), el("dd", {}, value)];
}

function controlsCard(user, closeDrawer) {
  const action = (label, fields, detail, danger = false) =>
    el("button", {
      class: `btn small${danger ? " danger" : ""}`,
      onclick: async () => {
        await updateUserFields(user.id, fields, detail);
        toast(`${label} ✓`);
        closeDrawer();
      },
    }, label);

  const orgRow = el("div", { class: "toolbar" }, el("span", { class: "kpi-note" }, "Loading partner orgs…"));
  loadPartnerOrgs().then((orgs) => {
    const select = el("select", {},
      el("option", { value: "" }, "No partner org"),
      orgs.map((o) => el("option", { value: o.id, ...(o.id === (user.partnerOrgId ?? "") ? { selected: "" } : {}) }, o.name)),
    );
    clear(orgRow).append(
      el("span", { class: "kpi-note", style: "min-width:80px" }, "Partner org:"),
      select,
      el("button", {
        class: "btn small",
        onclick: async () => {
          const orgId = select.value || null;
          const orgName = orgs.find((o) => o.id === orgId)?.name ?? "none";
          await updateUserFields(user.id, { partnerOrgId: orgId }, `Partner org → ${orgName} (web)`);
          toast(`Partner org set: ${orgName}`);
          closeDrawer();
        },
      }, "Save"),
    );
  });

  // NOTE: there is deliberately no "grant premium" control. The app decides
  // unlimited access from StoreKit purchases, linked-account sharing, and the
  // tester flag ONLY — a hand-set hasPremium/premiumSource is ignored by
  // SubscriptionManager.hasUnlimitedAccess and overwritten by its next
  // entitlement refresh. The tester flag is the real comp switch, exactly like
  // the in-app admin panel.
  return el("div", { class: "card" },
    el("h3", {}, "Controls"),
    el("p", { class: "card-sub" }, "Every action writes an audit entry, same as the in-app admin. Tester = free unlimited access (the app's comp switch). Assigning a partner org lets that school's portal staff see this student's drives."),
    el("div", { class: "toolbar" },
      user.isTester
        ? action("Remove free access (tester)", { isTester: false }, "Tester flag removed (web)")
        : action("Grant free access (tester)", { isTester: true }, "Tester flag granted (web)"),
      user.isSuspended
        ? action("Unsuspend", { isSuspended: false }, "Account unsuspended (web)")
        : action("Suspend", { isSuspended: true }, "Account suspended (web)", true),
    ),
    orgRow,
  );
}

function renderTrips(card, trips) {
  // Native Node.append() stringifies arrays and nulls — build the child list.
  const children = [el("h3", {}, `Drives (${trips.length})`)];
  if (trips.length === 0) children.push(el("p", { class: "card-sub" }, "No drives synced to the cloud for this user."));
  children.push(...trips.slice(0, 25).map((t) => tripRow(t)));
  clear(card).append(...children);
}

function tripRow(t) {
  const badgeClass = t.status === "approved" ? "green" : t.status === "pending" ? "orange" : "red";
  const row = el("div", { class: "check-row", style: "cursor:pointer; display:block" },
    el("div", { style: "display:flex; justify-content:space-between; align-items:center" },
      el("div", {},
        el("strong", {}, fmtDateTime(t.startTime)),
        el("div", { class: "kpi-note" },
          `${Math.round((t.duration || 0) / 60)}m · ${fmtMiles(t.distanceMeters)} · ${t.nightMinutes ? `${t.nightMinutes}m night · ` : ""}${(t.detectedManeuvers || []).slice(0, 3).join(", ") || "no detections"}`),
      ),
      el("span", { class: `badge ${badgeClass}` }, t.status),
    ),
  );
  let mapNode;
  row.addEventListener("click", () => {
    if (mapNode) { mapNode.remove(); mapNode = null; return; }
    const points = decodePolyline(t.routePolyline);
    if (!points.length) { toast("No route stored for this drive."); return; }
    mapNode = el("div", { class: "map-box", style: "margin-top:8px" });
    row.append(mapNode);
    const map = L.map(mapNode).fitBounds(points);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap" }).addTo(map);
    L.polyline(points, { color: "#00b2f0", weight: 4 }).addTo(map);
    L.marker(points[0]).addTo(map);
    L.marker(points[points.length - 1]).addTo(map);
  });
  return row;
}

async function refreshNotes(card, user) {
  const notes = await loadNotes(user.id);
  const input = el("textarea", { rows: 2, placeholder: "Add a support note…" });
  clear(card).append(
    el("h3", {}, `Admin notes (${notes.length})`),
    // Native Node.append() stringifies arrays — spread, don't pass the array.
    ...notes.map((n) =>
      el("div", { class: "check-row", style: "display:block" },
        el("div", { style: "display:flex; justify-content:space-between" },
          // authorName is the iOS field; adminName covers notes written by
          // early web-admin builds before the shapes were unified.
          el("strong", {}, n.authorName ?? n.adminName ?? "Admin"),
          el("span", { class: "kpi-note" }, fmtDateTime(n.createdAt)),
        ),
        el("div", { html: escapeHTML(n.text ?? "") }),
        el("button", { class: "link-btn", onclick: async () => { await deleteNote(n.id); refreshNotes(card, user); } }, "Delete"),
      ),
    ),
    input,
    el("div", { style: "margin-top:8px" },
      el("button", {
        class: "btn small primary",
        onclick: async () => {
          const text = input.value.trim();
          if (!text) return;
          await addNote(user.id, text);
          toast("Note added");
          refreshNotes(card, user);
        },
      }, "Add note"),
    ),
  );
}
