// DriveTap Partners portal — the school-facing app.
//
// Access model: an admin lists staff emails on partnerOrgs/{org}.memberEmails
// and assigns students via users.partnerOrgId. Firestore rules enforce both
// server-side: staff can read their own org, the students assigned to it, and
// those students' trips — nothing else. Demo mode (?demo=1) shows a sample
// school with writes disabled.
import { auth, db } from "../../admin/js/firebase-init.js";
import {
  GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut,
  setPersistence, browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, getDocs, query, where, addDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  el, clear, fmtDate, fmtDateTime, fmtHours, fmtMoney, fmtMiles, toDate, downloadCSV, toast, escapeHTML,
} from "../../admin/js/util.js";
import { demoDataset } from "../../admin/js/sections/demo-data.js";

const isDemo = new URLSearchParams(location.search).has("demo");
const state = { org: null, orgs: [], students: [], tripsByStudent: new Map(), staffEmail: null };

// Same contract as the admin shell: a rejection nobody caught (a Firestore
// write that died mid-flow) must surface as a toast, never vanish into the
// console — a school clicking "Send request" has to know it didn't land.
// "demo-mode" is the sentinel the shared data layer throws after toasting.
window.addEventListener("unhandledrejection", (event) => {
  if (event.reason?.message === "demo-mode") {
    event.preventDefault();
    return;
  }
  toast(String(event.reason?.message || event.reason || "Something went wrong"), "error");
});

const snapToObj = (snap) => ({ id: snap.id, ...snap.data() });

// ---- Boot ----------------------------------------------------------------

const overlay = document.getElementById("auth-overlay");
const authStatus = document.getElementById("auth-status");

if (isDemo) {
  document.getElementById("demo-banner").classList.remove("hidden");
  state.staffEmail = "dan@hillcountrydriving.com";
  state.orgs = demoDataset.partnerOrgs.filter((o) => (o.memberEmails || []).includes(state.staffEmail));
  // Same school-switcher memory as the signed-in path — a demo that forgets
  // which location you were on across a reload reads as a bug on stage.
  const remembered = localStorage.getItem(`dt-portal-org-${state.staffEmail}`);
  state.org = state.orgs.find((o) => o.id === remembered) || state.orgs[0];
  overlay.classList.add("hidden");
  renderShellIdentity();
  loadRoster().then(renderPortal);
} else {
  const signInBtn = document.getElementById("google-signin");
  signInBtn.classList.add("hidden");
  authStatus.textContent = "Restoring session…";
  setPersistence(auth, browserLocalPersistence).catch(() => {});

  signInBtn.addEventListener("click", async () => {
    authStatus.textContent = "";
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (err) {
      authStatus.textContent = (err.code || "").includes("unauthorized-domain")
        ? "This domain isn't authorized for sign-in yet — your DriveTap contact needs to enable it."
        : err.message;
    }
  });

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      overlay.classList.remove("hidden");
      signInBtn.classList.remove("hidden");
      if (authStatus.textContent === "Restoring session…") authStatus.textContent = "";
      return;
    }
    state.staffEmail = (user.email || "").toLowerCase();
    authStatus.textContent = "Looking up your school…";
    try {
      const orgSnap = await getDocs(query(
        collection(db, "partnerOrgs"),
        where("memberEmails", "array-contains", state.staffEmail),
      ));
      if (orgSnap.empty) {
        authStatus.textContent = `${state.staffEmail} isn't registered with any DriveTap partner school. Ask your DriveTap contact to add it.`;
        await signOut(auth);
        return;
      }
      // One email can be registered with several schools (district staff, an
      // owner with two locations, DriveTap's own account). Load them ALL and
      // open on the last one used; the header becomes a school switcher.
      state.orgs = orgSnap.docs.map(snapToObj).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      const remembered = localStorage.getItem(`dt-portal-org-${state.staffEmail}`);
      state.org = state.orgs.find((o) => o.id === remembered) || state.orgs[0];
      overlay.classList.add("hidden");
      renderShellIdentity();
      await loadRoster();
      renderPortal();
    } catch (err) {
      authStatus.textContent = `Couldn't load your school: ${err.message}`;
    }
  });
}

async function loadRoster() {
  const newestFirst = (a, b) => (toDate(b.startTime)?.getTime() || 0) - (toDate(a.startTime)?.getTime() || 0);
  if (isDemo) {
    state.students = demoDataset.users.filter((u) => u.partnerOrgId === state.org.id);
    state.tripsByStudent = new Map(state.students.map((s) => [s.id, [...demoDataset.trips.filter((t) => t.userId === s.id)].sort(newestFirst)]));
  } else {
    const studentSnap = await getDocs(query(collection(db, "users"), where("partnerOrgId", "==", state.org.id)));
    state.students = studentSnap.docs.map(snapToObj);
    await Promise.all(state.students.map(async (s) => {
      const tripSnap = await getDocs(query(collection(db, "trips"), where("userId", "==", s.id)));
      state.tripsByStudent.set(s.id, tripSnap.docs.map(snapToObj).sort(newestFirst));
    }));
  }
  // One sort for both sources — studentStats and lastDrive assume newest-first.
  state.students.sort((a, b) => `${a.firstName ?? ""}${a.lastName ?? ""}`.localeCompare(`${b.firstName ?? ""}${b.lastName ?? ""}`));
}

function renderShellIdentity() {
  const orgLabel = document.getElementById("org-label");
  clear(orgLabel);
  if (state.orgs.length > 1) {
    orgLabel.append(
      el("span", {}, `Partner school (${state.orgs.length} linked)`),
      el("select", {
        style: "margin-top:2px; font-weight:600",
        onchange: (e) => switchOrg(e.target.value),
      }, state.orgs.map((o) => el("option", { value: o.id, ...(o.id === state.org.id ? { selected: "" } : {}) }, o.name))),
    );
  } else {
    orgLabel.append(el("span", {}, "Partner school"), el("strong", {}, state.org.name));
  }
  const identity = document.getElementById("identity");
  clear(identity).append(
    el("span", { class: "kpi-note" }, state.staffEmail ?? ""),
    isDemo ? "" : el("button", { class: "link-btn", onclick: () => signOut(auth).then(() => location.reload()) }, "Sign out"),
  );
}

async function switchOrg(orgId) {
  const next = state.orgs.find((o) => o.id === orgId);
  if (!next || next.id === state.org?.id) return;
  state.org = next;
  localStorage.setItem(`dt-portal-org-${state.staffEmail}`, next.id);
  state.students = [];
  state.tripsByStudent = new Map();
  const host = document.getElementById("portal-content");
  clear(host).append(el("div", { class: "card" }, el("p", { class: "card-sub" }, `Loading ${next.name}…`)));
  await loadRoster();
  renderShellIdentity();
  renderPortal();
}

// ---- Aggregates ----------------------------------------------------------

function studentStats(student) {
  const trips = state.tripsByStudent.get(student.id) || [];
  const approved = trips.filter((t) => t.status === "approved");
  const approvedSeconds = approved.reduce((s, t) => s + (t.duration || 0), 0);
  const nightMinutes = approved.reduce((s, t) => s + (t.nightMinutes || 0), 0);
  const unsigned = approved.filter((t) => !(t.supervisorSignaturePNG || "").length).length;
  // Missing goals fall back to the iOS parse defaults (AppUser 30 h / 10 h) so
  // both surfaces describe the same student identically. An explicit 0 is a
  // real value — some states (e.g. Arkansas) set no supervised-hour minimum —
  // so it must survive, and the percent math must not divide by it.
  const goalHours = student.requiredHoursGoal ?? 30;
  const nightGoalHours = student.requiredNightHoursGoal ?? 10;
  return {
    trips,
    approvedCount: approved.length,
    pendingCount: trips.filter((t) => t.status === "pending").length,
    approvedSeconds,
    nightMinutes,
    unsigned,
    goalHours,
    nightGoalHours,
    pct: goalHours > 0 ? Math.min(approvedSeconds / 3600 / goalHours, 1) : 1,
    nightPct: nightGoalHours > 0 ? Math.min(nightMinutes / 60 / nightGoalHours, 1) : 1,
    lastDrive: trips.length ? toDate(trips[0].startTime) : null,
  };
}

// ---- Main render ---------------------------------------------------------

function renderPortal() {
  const host = document.getElementById("portal-content");
  const seatCount = state.students.length;
  const seats = state.org.seats || 0;
  const readyCount = state.students.filter((s) => studentStats(s).pct >= 1).length;
  const totalSeconds = state.students.reduce((sum, s) => sum + studentStats(s).approvedSeconds, 0);

  clear(host).append(
    el("div", { class: "grid cols-4" },
      kpi("Enrolled students", `${seatCount}`, seats ? `${seats - seatCount >= 0 ? seats - seatCount : 0} of ${seats} seats free` : "no seat cap set"),
      kpi("Approved practice", fmtHours(totalSeconds), "only approved drives count toward the state goal"),
      kpi("Goal reached", String(readyCount), "students at 100% of their state's hours"),
      kpi("Awaiting approval", String(state.students.reduce((s, st) => s + studentStats(st).pendingCount, 0)), "drives pending sign-off in the family's app"),
    ),
    rosterCard(),
    complianceCard(),
    billingCard(),
  );
}

function kpi(label, value, note) {
  return el("div", { class: "card kpi" },
    el("div", { class: "kpi-label" }, label),
    el("div", { class: "kpi-value" }, value),
    el("div", { class: "kpi-note" }, note),
  );
}

// ---- Roster --------------------------------------------------------------

function rosterCard() {
  return el("div", { class: "card table-wrap" },
    el("h3", {}, "Student roster"),
    el("p", { class: "card-sub" }, "Tap a student for their full record. Hours count approved drives only — same rule the state applies."),
    state.students.length === 0
      ? el("p", { class: "card-sub" }, "No students assigned yet — your DriveTap contact enrolls students to your school.")
      : el("table", {},
          el("thead", {}, el("tr", {},
            el("th", {}, "Student"), el("th", {}, "State"), el("th", {}, "Hours"),
            el("th", {}, "Night"), el("th", {}, "Signatures"), el("th", {}, "Last drive"),
          )),
          el("tbody", {}, state.students.map((s) => {
            const st = studentStats(s);
            return el("tr", { class: "clickable", onclick: () => openStudent(s) },
              el("td", {}, el("strong", {}, `${s.firstName ?? ""} ${s.lastName ?? ""}`.trim() || "(no name)")),
              el("td", {}, s.state ?? "—"),
              el("td", { style: "min-width:160px" },
                st.goalHours > 0
                  ? [
                      el("div", { style: "display:flex; justify-content:space-between; font-size:11.5px" },
                        el("span", {}, `${(st.approvedSeconds / 3600).toFixed(1)}h / ${st.goalHours}h`),
                        el("span", {}, `${Math.round(st.pct * 100)}%`),
                      ),
                      el("div", { class: "progressbar" }, el("div", { style: `width:${st.pct * 100}%` })),
                    ]
                  : [
                      el("div", { style: "font-size:11.5px" }, `${(st.approvedSeconds / 3600).toFixed(1)}h logged`),
                      el("span", { class: "kpi-note" }, "no state minimum"),
                    ],
              ),
              el("td", { style: "min-width:120px" },
                st.nightGoalHours > 0
                  ? [
                      el("div", { style: "display:flex; justify-content:space-between; font-size:11.5px" },
                        el("span", {}, `${(st.nightMinutes / 60).toFixed(1)}h / ${st.nightGoalHours}h`),
                        el("span", {}, `${Math.round(st.nightPct * 100)}%`),
                      ),
                      el("div", { class: "progressbar night" }, el("div", { style: `width:${st.nightPct * 100}%` })),
                    ]
                  : el("span", { class: "kpi-note" }, "not required"),
              ),
              el("td", {}, st.unsigned === 0
                ? el("span", { class: "badge green" }, "complete")
                : el("span", { class: "badge orange" }, `${st.unsigned} unsigned`)),
              el("td", {}, st.lastDrive ? fmtDate(st.lastDrive) : "—"),
            );
          })),
        ),
  );
}

// ---- Student drawer ------------------------------------------------------

function openStudent(student) {
  const st = studentStats(student);
  const backdrop = el("div", { class: "drawer-backdrop", onclick: close });
  const drawer = el("div", { class: "drawer" });
  document.body.append(backdrop, drawer);
  function close() { backdrop.remove(); drawer.remove(); }

  const name = `${student.firstName ?? ""} ${student.lastName ?? ""}`.trim() || "(no name)";
  const goalText = st.goalHours > 0
    ? `goal ${st.goalHours}h total / ${st.nightGoalHours}h night`
    : "no state supervised-hour minimum";
  drawer.append(
    el("div", { class: "drawer-head" },
      el("div", {}, el("h2", {}, name), el("div", { class: "kpi-note" }, `${student.state ?? "no state"} · ${goalText}`)),
      el("button", { class: "btn small", onclick: close }, "Close"),
    ),
    el("div", { class: "card" },
      el("h3", {}, "Progress"),
      st.goalHours > 0
        ? progressRow("Total supervised hours", `${(st.approvedSeconds / 3600).toFixed(1)}h of ${st.goalHours}h`, st.pct, false)
        : el("p", { class: "card-sub" }, `${(st.approvedSeconds / 3600).toFixed(1)}h supervised logged — this state sets no supervised-hour minimum.`),
      st.nightGoalHours > 0 ? progressRow("Night hours", `${(st.nightMinutes / 60).toFixed(1)}h of ${st.nightGoalHours}h`, st.nightPct, true) : null,
      el("p", { class: "card-sub", style: "margin-top:8px" },
        `${st.approvedCount} approved drives · ${st.pendingCount} pending · ${st.unsigned} awaiting supervisor signature`),
    ),
    el("div", { class: "card" },
      el("h3", {}, "Records"),
      el("div", { class: "toolbar" },
        el("button", { class: "btn small", onclick: () => exportStudentCSV(student) }, "Export drive log (CSV)"),
        el("button", { class: "btn small", onclick: () => printStudentSummary(student) }, "Printable summary"),
      ),
      el("p", { class: "card-sub" }, "The printable summary is a practice-record report. Official state forms (e.g. the Texas DES150N) are generated with signatures inside the family's DriveTap app."),
    ),
    el("div", { class: "card" },
      el("h3", {}, `Drives (${st.trips.length})`),
      st.trips.slice(0, 40).map((t) => {
        const badgeClass = t.status === "approved" ? "green" : t.status === "pending" ? "orange" : "red";
        return el("div", { class: "check-row", style: "display:block" },
          el("div", { style: "display:flex; justify-content:space-between; align-items:center" },
            el("div", {},
              el("strong", {}, fmtDateTime(t.startTime)),
              el("div", { class: "kpi-note" },
                `${Math.round((t.duration || 0) / 60)}m · ${fmtMiles(t.distanceMeters)}${t.nightMinutes ? ` · ${t.nightMinutes}m night` : ""}${t.safetyScore?.overall != null ? ` · safety ${t.safetyScore.overall}` : ""}${(t.supervisorSignaturePNG || "").length ? " · signed" : ""}`),
            ),
            el("span", { class: `badge ${badgeClass}` }, t.status),
          ),
        );
      }),
      st.trips.length > 40
        ? el("p", { class: "card-sub" }, `Showing the 40 most recent — the CSV export has all ${st.trips.length}.`)
        : null,
    ),
  );
}

function progressRow(label, valueText, pct, night) {
  return el("div", { style: "margin-bottom:10px" },
    el("div", { style: "display:flex; justify-content:space-between; font-size:12.5px" },
      el("span", {}, label), el("span", {}, valueText),
    ),
    el("div", { class: `progressbar${night ? " night" : ""}` }, el("div", { style: `width:${pct * 100}%` })),
  );
}

// ---- Compliance & exports ------------------------------------------------

function complianceCard() {
  const rows = state.students.map((s) => ({ s, st: studentStats(s) }));
  const unsignedTotal = rows.reduce((sum, r) => sum + r.st.unsigned, 0);

  // What the state actually requires of this roster, grouped by state — the
  // goals come from each student's account, which the app fills from its
  // verified per-state requirements table.
  const byState = new Map();
  for (const { s, st } of rows) {
    const key = s.state || "No state set";
    if (!byState.has(key)) byState.set(key, { count: 0, goal: st.goalHours, night: st.nightGoalHours });
    byState.get(key).count += 1;
  }
  const requirementText = [...byState.entries()]
    .map(([stateName, r]) =>
      `${r.count} ${stateName} student${r.count === 1 ? "" : "s"} (${r.goal > 0
        ? `${r.goal} h supervised${r.night ? ` incl. ${r.night} h night` : ""}`
        : "no supervised-hour minimum"}${stateName === "Texas" ? " — logged on form DES150N" : ""})`)
    .join(" · ");

  return el("div", { class: "card" },
    el("h3", {}, "Compliance & exports"),
    state.students.length ? el("p", { class: "card-sub" }, `Your roster's state requirements: ${requirementText}.`) : null,
    el("p", { class: "card-sub" },
      unsignedTotal === 0
        ? "Every approved drive on your roster carries a supervisor signature."
        : `${unsignedTotal} approved drive${unsignedTotal === 1 ? "" : "s"} across your roster still need${unsignedTotal === 1 ? "s" : ""} a supervisor signature — families sign in their DriveTap app (one tap with a signature on file).`),
    el("div", { class: "toolbar" },
      el("button", { class: "btn small primary", onclick: exportRosterCSV }, "Export full roster (CSV)"),
      el("button", { class: "btn small", onclick: exportAllDrivesCSV }, "Export all drives (CSV)"),
    ),
    el("p", { class: "card-sub" }, "CSVs are working records for your office. Official state forms — including the signed Texas 30-hour DES150N log — are generated inside each family's DriveTap app."),
  );
}

function exportRosterCSV() {
  downloadCSV(`${slug(state.org.name)}-roster-${today()}.csv`, state.students.map((s) => {
    const st = studentStats(s);
    return {
      student: `${s.firstName ?? ""} ${s.lastName ?? ""}`.trim(),
      state: s.state ?? "",
      approved_hours: (st.approvedSeconds / 3600).toFixed(2),
      goal_hours: st.goalHours,
      night_hours: (st.nightMinutes / 60).toFixed(2),
      night_goal_hours: st.nightGoalHours,
      percent_complete: Math.round(st.pct * 100),
      approved_drives: st.approvedCount,
      pending_drives: st.pendingCount,
      unsigned_drives: st.unsigned,
      last_drive: st.lastDrive ? fmtDate(st.lastDrive) : "",
    };
  }));
}

function exportAllDrivesCSV() {
  const rows = [];
  for (const s of state.students) {
    for (const t of state.tripsByStudent.get(s.id) || []) {
      rows.push({
        student: `${s.firstName ?? ""} ${s.lastName ?? ""}`.trim(),
        date: fmtDateTime(t.startTime),
        minutes: Math.round((t.duration || 0) / 60),
        night_minutes: t.nightMinutes ?? 0,
        miles: t.distanceMeters ? (t.distanceMeters / 1609.34).toFixed(1) : "",
        status: t.status,
        signed: (t.supervisorSignaturePNG || "").length ? "yes" : "no",
        supervisor: t.supervisorName ?? "",
        safety: t.safetyScore?.overall ?? "",
      });
    }
  }
  if (!rows.length) { toast("No drives to export yet."); return; }
  downloadCSV(`${slug(state.org.name)}-drives-${today()}.csv`, rows);
}

function exportStudentCSV(student) {
  const trips = state.tripsByStudent.get(student.id) || [];
  if (!trips.length) { toast("No drives yet."); return; }
  downloadCSV(`${slug(`${student.firstName}-${student.lastName}`)}-drives-${today()}.csv`, trips.map((t) => ({
    date: fmtDateTime(t.startTime),
    minutes: Math.round((t.duration || 0) / 60),
    night_minutes: t.nightMinutes ?? 0,
    miles: t.distanceMeters ? (t.distanceMeters / 1609.34).toFixed(1) : "",
    status: t.status,
    signed: (t.supervisorSignaturePNG || "").length ? "yes" : "no",
    supervisor: t.supervisorName ?? "",
    safety: t.safetyScore?.overall ?? "",
    weather: t.weatherCondition ?? "",
  })));
}

function printStudentSummary(student) {
  const st = studentStats(student);
  const name = `${student.firstName ?? ""} ${student.lastName ?? ""}`.trim() || "(no name)";
  // Names, states, and supervisor names are typed by families in the app —
  // they are DATA and must be escaped before being written into this document.
  const rows = st.trips.filter((t) => t.status === "approved").map((t) =>
    `<tr><td>${fmtDateTime(t.startTime)}</td><td>${Math.round((t.duration || 0) / 60)} min</td><td>${t.nightMinutes || 0} min</td><td>${(t.supervisorSignaturePNG || "").length ? escapeHTML(t.supervisorName || "signed") : "—"}</td></tr>`).join("");
  const goalLine = st.goalHours > 0
    ? `${(st.approvedSeconds / 3600).toFixed(1)} approved hours of ${st.goalHours} required · ${(st.nightMinutes / 60).toFixed(1)} night hours of ${st.nightGoalHours} required`
    : `${(st.approvedSeconds / 3600).toFixed(1)} approved supervised hours — no state supervised-hour minimum`;
  const win = window.open("", "_blank");
  if (!win) {
    toast("Your browser blocked the summary window — allow pop-ups for this site and try again.", "warn");
    return;
  }
  win.document.write(`<!DOCTYPE html><html><head><title>DriveTap Practice Record — ${escapeHTML(name)}</title>
    <style>
      body { font-family: -apple-system, Segoe UI, sans-serif; color: #10131a; max-width: 680px; margin: 40px auto; padding: 0 24px; }
      .head { display: flex; justify-content: space-between; border-bottom: 3px solid #00b2f0; padding-bottom: 12px; }
      .mark { font-size: 22px; font-weight: 800; color: #000029; } .mark span { color: #00b2f0; }
      table { width: 100%; border-collapse: collapse; margin-top: 18px; font-size: 13px; }
      td, th { text-align: left; padding: 7px 6px; border-bottom: 1px solid #e2e6ee; }
      .foot { color: #5c6572; font-size: 11px; margin-top: 28px; }
    </style></head><body>
    <div class="head"><div class="mark">Drive<span>Tap</span> Practice Record</div><div>${new Date().toLocaleDateString()}</div></div>
    <h2>${escapeHTML(name)}</h2>
    <p>${escapeHTML(student.state ?? "")} · ${goalLine}</p>
    <table><tr><th>Date</th><th>Duration</th><th>Night</th><th>Supervisor</th></tr>${rows}</table>
    <p class="foot">Prepared for ${escapeHTML(state.org.name)} from DriveTap records. Approved supervised-practice sessions only. This summary is a practice record; official state log forms are generated with signatures in the family's DriveTap app.</p>
    <script>window.print()</` + `script></body></html>`);
  win.document.close();
}

// ---- Billing & seats -----------------------------------------------------

function billingCard() {
  const seats = state.org.seats || 0;
  const used = state.students.length;
  const price = state.org.pricePerSeat || 0;
  const requestInput = el("input", { type: "number", min: "1", value: "10", style: "width:80px" });
  return el("div", { class: "card" },
    el("h3", {}, "Seats & billing"),
    el("dl", { class: "kv" },
      el("dt", {}, "Seats"), el("dd", {}, `${used} enrolled of ${seats || "∞"}`),
      el("dt", {}, "Price"), el("dd", {}, price ? `${fmtMoney(price)} per seat / month` : "per your agreement"),
      price ? el("dt", {}, "Monthly total") : null,
      price ? el("dd", {}, `${fmtMoney(seats * price)} (${seats} contracted seats)`) : null,
    ),
    el("div", { class: "toolbar", style: "margin-top:10px" },
      el("span", { class: "kpi-note" }, "Request additional seats:"),
      requestInput,
      el("button", {
        class: "btn small primary",
        onclick: async () => {
          const quantity = Math.floor(Number(requestInput.value) || 0);
          if (quantity < 1) { toast("Enter how many seats to add.", "warn"); return; }
          if (isDemo) { toast("Demo mode — writes are disabled.", "warn"); return; }
          try {
            await addDoc(collection(db, "partnerRequests"), {
              orgId: state.org.id,
              orgName: state.org.name,
              type: "seats",
              quantity,
              requestedByEmail: state.staffEmail,
              status: "open",
              createdAt: serverTimestamp(),
            });
            toast(`Request sent — DriveTap will follow up about ${quantity} more seats.`);
          } catch (err) {
            toast(`Couldn't send the request: ${err.message}`, "error");
          }
        },
      }, "Send request"),
    ),
  );
}

// ---- Small helpers -------------------------------------------------------

function slug(text) {
  return String(text || "export").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
function today() {
  return new Date().toISOString().slice(0, 10);
}
