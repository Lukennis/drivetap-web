// Canned dataset for ?demo=1 — pitch-safe fake data shaped exactly like the
// real Firestore documents. Deterministic (no randomness) so demos look the
// same every time.
//
// The universe: Texas is DriveTap's flagship state — most demo students are
// Texas teens working the DES150N 30-hour log (30 h total incl. 10 h night,
// practice categories 1-10, per-row supervisor signatures, 2 h/day DPS cap)
// at the two Hill Country Driving locations. A few out-of-state accounts show
// per-state goals. Every requiredHoursGoal below matches the app's verified
// requirements table (StateDrivingRequirementsService): TX 30/10, GA 40/6,
// CA 50/10, IA 20/2. Don't invent numbers — the iOS app is the ground truth.
const now = Date.now();
const day = 86400000;

// [first, last, role, state, totalGoal, nightGoal, partnerOrgId, [premiumSource, productId]]
// Elena is Ava's mom (1-teen plan; Ava rides on it as a linked account).
// David is Mia's dad (2-teen plan, one seat still unused). Marcus is an adult
// standalone learner paying for himself. Priya is a parent still on free.
const cast = [
  ["Ava", "Martinez", "teen", "Texas", 30, 10, "o1", ["linked_account", null]],
  ["Liam", "Johnson", "teen", "Texas", 30, 10, "o1", null],
  ["Mia", "Chen", "teen", "Texas", 30, 10, "o1", ["linked_account", null]],
  ["Elena", "Martinez", "parent", "Texas", 30, 10, null, ["storekit", "drivetap.unlimited.yearly"]],
  ["Noah", "Williams", "teen", "Texas", 30, 10, "o1", null],
  ["Sofia", "Garcia", "teen", "Georgia", 40, 6, null, null],
  ["Marcus", "Reyes", "standalone", "California", 50, 10, null, ["storekit", "drivetap.unlimited.yearly"]],
  ["David", "Chen", "parent", "Texas", 30, 10, null, ["storekit", "drivetap.unlimited.yearly.t2"]],
  ["Emma", "Wilson", "teen", "Texas", 30, 10, "o2", null],
  ["Harper", "Nguyen", "teen", "Iowa", 20, 2, null, null],
  ["Jack", "Trevino", "teen", "Texas", 30, 10, "o2", null],
  ["Priya", "Patel", "parent", "California", 50, 10, null, null],
];

// Practice arcs per driver: [castIndex, tripCount]. Ava has FINISHED her Texas
// 30-hour log (every drive approved and signed); Noah has just started.
const arcs = [[0, 38], [1, 14], [2, 22], [4, 6], [5, 12], [6, 18], [8, 16], [9, 10], [10, 8]];
const tripCountByUser = new Map(arcs.map(([i, n]) => [i, n]));

const users = cast.map(([first, last, role, state, goal, nightGoal, orgId, premium], i) => ({
  id: `demo-user-${i}`,
  firstName: first,
  lastName: last,
  email: `${first.toLowerCase()}.${last.toLowerCase()}@example.com`,
  role,
  state,
  hasPremium: premium != null,
  premiumSource: premium ? premium[0] : null,
  subscriptionProductId: premium ? premium[1] : null,
  isTester: false,
  isSuspended: false,
  isAdmin: false,
  displayAccountId: `DT-${(0x4a7f92c1 + i * 0x9e3779).toString(16).toUpperCase().slice(0, 8)}`,
  // Drivers only — a parent's account never logs drives. Some drivers keep an
  // extra local-only drive that hasn't synced (offline-first is app truth).
  lifetimeTripCount: tripCountByUser.has(i) ? tripCountByUser.get(i) + (i % 2) : 0,
  requiredHoursGoal: goal,
  requiredNightHoursGoal: nightGoal,
  partnerOrgId: orgId,
  createdAt: new Date(now - (320 - i * 26) * day),
  updatedAt: new Date(now - i * day),
}));

// Maneuver names are REAL ManeuverType raw values from the detection engine
// (RouteAnalysisEngine.swift) — the web must never invent one. `cat` is the
// Texas DES150N practice category the drive practices (only stamped on TX
// students; category 2 "Moving & Steering" is the honest general fallback,
// specialty categories only appear with matching evidence — same rule as the
// app's auto-categorization).
const patterns = [
  { m: ["Smooth acceleration", "Smooth braking", "Complete stop", "Right turn"], cat: 2, kind: "city" },
  { m: ["Left turn", "Right turn", "Traffic light", "Complete stop", "Smooth braking"], cat: 9, kind: "city" },
  { m: ["Stop sign", "Left turn", "Gradual curve", "Smooth braking"], cat: 4, kind: "city" },
  { m: ["Highway merge", "Highway driving", "Lane change", "Highway exit"], cat: 10, kind: "highway" },
  { m: ["Smooth braking", "Complete stop", "Left turn", "Smooth acceleration"], cat: 2, kind: "city" },
  { m: ["Parallel parking", "Reversing", "Complete stop"], cat: 6, kind: "city" },
  { m: ["Lane change", "Heavy traffic", "Traffic light", "Smooth braking"], cat: 8, kind: "city" },
  { m: ["3-point turn", "U-turn", "Reversing"], cat: 7, kind: "city" },
  { m: ["Hard braking", "Rolling stop", "Sharp turn", "Traffic light"], cat: 2, kind: "city", rough: true },
  { m: ["Roundabout", "Gradual curve", "Right turn", "Smooth acceleration"], cat: 4, kind: "city" },
];

// Real encoded routes (Google polyline format, round-trip verified against
// util.decodePolyline): an Austin neighborhood loop, a MoPac highway run, and
// a Round Rock grid loop. GPS-recorded demo drives carry one so the drawer's
// route map renders; manual entries have none — same as real data.
const ROUTE_CITY_AUSTIN = "oeswD~p|sQcLsN_NkMkMwLwLsNwL{OgJoP{EwQsDwQoFsNgJsIsN_DkMrDwGjMwBnP~CvQfJvLvL~HrNnFrNjHnPrIzOjMzOjMnPvLrNjHjHbB";
const ROUTE_HIGHWAY_MOPAC = "ohowDnrzsQod@gEsg@_Dsg@wBsg@oAsg@g@sg@f@sg@vBsg@fEsg@nFsg@nFsg@~Csg@nAsg@g@sg@kCsg@gE";
const ROUTE_CITY_ROUND_ROCK = "_reyDv|dsQkHwLkHkMgJkMoKsIwLgEwLz@gJvGgEjMg@rNjCrNjHnKnKbGvLnAjMkCjMoFnK_DnFcB";
// o2 students (Emma, Jack) practice in Round Rock; everyone else near Austin.
const roundRockDrivers = new Set([8, 10]);

const durations = [60, 45, 60, 30, 50, 55]; // minutes, cycled — TX-legal session sizes
const weathers = ["Clear", "Sunny", "Partly Cloudy", "Clear", "Cloudy", "Clear", "Light Rain"];
const supervisors = {
  0: "Elena Martinez", 1: "Greg Johnson", 2: "David Chen", 4: "Tanya Williams",
  5: "Rosa Garcia", 6: "Dana Reyes", 8: "Lena Wilson", 9: "Minh Nguyen", 10: "Rick Trevino",
};
const pendingLatest = new Set([1, 2, 8, 9]); // newest drive still awaiting approval
const unsignedApproved = { 2: [1], 5: [1, 3], 10: [2] }; // approved but signature not collected yet
const manualEntries = { 5: 5, 6: 9 }; // hand-logged drives: no GPS → no maneuvers, no safety score

// Shape matches DriveSafetyScore.firestoreMap exactly. The overall score is
// DERIVED from the event counts so no demo drive can contradict itself.
function scoreFor(ai, t, pat, durationMin, miles) {
  const hard = pat.rough ? 2 : ((ai + t) % 5 === 0 ? 1 : 0);
  const rapid = pat.rough ? 1 : ((ai + t) % 7 === 3 ? 1 : 0);
  const harsh = pat.rough ? 1 : 0;
  const rolling = pat.rough ? 1 : ((ai * 2 + t) % 9 === 4 ? 1 : 0);
  const overall = Math.max(58, 97 - hard * 8 - rapid * 5 - harsh * 6 - rolling * 4 - ((ai + t) % 3));
  return {
    overall,
    smoothness: Math.max(55, overall - 2 + (t % 3)),
    cornering: Math.max(55, overall - (harsh ? 8 : 1)),
    hardBrakingCount: hard,
    rapidAccelCount: rapid,
    harshCorneringCount: harsh,
    smoothEventCount: 3 + ((ai + t) % 5),
    analyzedMiles: miles,
    analyzedMinutes: durationMin,
    confidence: durationMin >= 45 ? 0.9 : 0.75,
    rollingStopCount: rolling,
    stopDiscipline: rolling ? 74 : 95,
    engineVersion: 2,
  };
}

const trips = [];
arcs.forEach(([userIdx, count], ai) => {
  const user = users[userIdx];
  const isTexas = user.state === "Texas";
  for (let t = 0; t < count; t++) {
    const pat = patterns[(ai * 3 + t) % patterns.length];
    const durationMin = durations[t % durations.length];
    const isNight = t % 3 === 2; // every third session is an evening drive → TX-shaped 1/3 night mix
    const isManual = manualEntries[userIdx] === t;
    const status = pendingLatest.has(userIdx) && t === 0 ? "pending"
      : userIdx === 4 && t === 2 ? "rejected"
      : "approved";
    const signed = status === "approved" && !(unsignedApproved[userIdx] || []).includes(t);
    const meters = durationMin * (pat.kind === "highway" ? 1500 : 650);
    // Believable clocks: day practice after school (~4 pm), night practice
    // after sunset (~8:30 pm) — matching the app's sunset-based night split.
    const start = new Date(now - (t * 2 + 1) * day);
    start.setHours(isNight ? 20 : 16, (isNight ? 30 : 5) + ((ai * 7 + t * 11) % 25), 0, 0);
    trips.push({
      id: `demo-trip-${userIdx}-${t}`,
      userId: user.id,
      startTime: start,
      duration: durationMin * 60,
      distanceMeters: meters,
      status,
      dayMinutes: isNight ? 0 : durationMin,
      nightMinutes: isNight ? durationMin : 0,
      detectedManeuvers: isManual ? [] : pat.m,
      routePolyline: isManual ? null
        : pat.kind === "highway" ? ROUTE_HIGHWAY_MOPAC
        : roundRockDrivers.has(userIdx) ? ROUTE_CITY_ROUND_ROCK
        : ROUTE_CITY_AUSTIN,
      practiceCategoryId: isTexas ? pat.cat : null,
      supervisorName: supervisors[userIdx] ?? null,
      supervisorSignaturePNG: signed ? "demo" : null,
      safetyScore: isManual ? null : scoreFor(ai, t, pat, durationMin, +(meters / 1609.34).toFixed(1)),
      weatherCondition: weathers[(ai + t) % weathers.length],
      isManualEntry: isManual,
      createdAt: start,
      updatedAt: start,
    });
  }
});

// Same appConfig/settings keys the iOS app reads (SubscriptionManager +
// AdminView). freeDriveLimit 10 and maxDailyCountedHours 2.5 are the app's
// actual built-in defaults.
const appConfig = {
  maintenanceMode: false,
  subscriptionEnforcementDisabled: false,
  broadcastMessage: "",
  freeDriveLimit: 10,
  maxDailyCountedHours: 2.5,
  reviewPromptEnabled: true,
  reviewMinIntervalDays: 30,
  premiumPromptsEnabled: true,
  premiumPromptMinIntervalHours: 24,
  parkingGameEnabled: true,
  guidedPracticeEnabled: true,
  referralEnabled: false,
  supportEmail: "support@drivetap.app",
  appStoreURL: "https://apps.apple.com/app/drivetap",
  adminNotifyNewAccounts: true,
  adminNotifyPendingApprovals: true,
};

const audit = [
  { id: "a1", action: "trip_status", targetType: "trip", targetId: "demo-trip-1-3", detail: "Status → approved (web admin)", adminName: "Demo Admin", createdAt: new Date(now - day) },
  { id: "a2", action: "config_change", targetType: "appConfig", targetId: "settings", detail: "freeDriveLimit 12 → 10", adminName: "Demo Admin", createdAt: new Date(now - 2 * day) },
  { id: "a3", action: "broadcast", targetType: "push", targetId: "parents", detail: '"Night hours just got smarter" → parents', adminName: "Demo Admin", createdAt: new Date(now - 4 * day) },
  { id: "a4", action: "quote_create", targetType: "quote", targetId: "q1", detail: 'Quote for "Sunrise Driver Ed" (120 seats)', adminName: "Demo Admin", createdAt: new Date(now - 5 * day) },
  { id: "a5", action: "partner_create", targetType: "partnerOrg", targetId: "o1", detail: 'Partner "Hill Country Driving Academy" created', adminName: "Demo Admin", createdAt: new Date(now - 8 * day) },
];

// Delivery counts match this demo universe: 3 parents, 12 accounts total.
const broadcasts = [
  { id: "b1", title: "Night hours just got smarter", body: "Drives now split day vs night automatically at sunset — check your teen's night-hours progress.", segment: "parents", status: "sent", targeted: 3, delivered: 3, createdAt: new Date(now - 4 * day) },
  { id: "b2", title: "One signature, every drive", body: "Texas supervisors can sign once and DriveTap applies it to each approved drive's DES150N log row.", segment: "all", status: "sent", targeted: 12, delivered: 11, createdAt: new Date(now - 18 * day) },
];

// B2B pipeline: Texas-first, $4.50/seat/month everywhere a price appears.
const prospects = [
  { id: "p1", name: "Lone Star Driving Academy", contactName: "Rachel Kim", contactEmail: "rachel@lonestardriving.com", phone: "(512) 555-0187", city: "Austin, TX", students: 220, stage: "demo", nextAction: "Follow up after Thursday demo", nextActionDate: new Date(now + 2 * day), notes: "Loved the DES150N auto-fill. Asking about bulk pricing.", createdAt: new Date(now - 12 * day) },
  // Deliberately overdue (nextActionDate in the past) so the pipeline's ⚠
  // overdue treatment is always visible in a demo.
  { id: "p2", name: "Sunrise Driver Ed", contactName: "Marcus Webb", contactEmail: "marcus@sunrisedriver.com", phone: "(214) 555-0142", city: "Dallas, TX", students: 140, stage: "negotiating", nextAction: "Send revised quote (120 seats)", nextActionDate: new Date(now - 2 * day), notes: "Wants seat price under $4. Competitor quote in hand.", createdAt: new Date(now - 30 * day) },
  { id: "p3", name: "Golden Gate Teen Driving", contactName: "Priya Shah", contactEmail: "priya@ggteendriving.com", phone: "(415) 555-0119", city: "San Francisco, CA", students: 310, stage: "lead", nextAction: "Intro call", nextActionDate: new Date(now + 5 * day), notes: "Inbound from the website.", createdAt: new Date(now - 3 * day) },
  { id: "p4", name: "Hill Country Driving Academy", contactName: "Dan Kovacs", contactEmail: "dan@hillcountrydriving.com", phone: "(512) 555-0173", city: "Austin, TX", students: 95, stage: "signed", nextAction: "Kickoff call Monday", nextActionDate: new Date(now + 3 * day), notes: "Signed 95 seats @ $4.50/mo. Round Rock location added as a second org.", createdAt: new Date(now - 60 * day) },
];

const quotes = [
  { id: "q1", schoolName: "Sunrise Driver Ed", contactName: "Marcus Webb", seats: 120, pricePerSeat: 4.5, discountPct: 10, termMonths: 12, notes: "Annual prepay discount applied.", createdAt: new Date(now - 5 * day) },
];

// Enrolled counts are always DERIVED from users.partnerOrgId — never stored.
const partnerOrgs = [
  { id: "o1", name: "Hill Country Driving Academy", contactName: "Dan Kovacs", contactEmail: "dan@hillcountrydriving.com", memberEmails: ["dan@hillcountrydriving.com", "office@hillcountrydriving.com"], seats: 95, pricePerSeat: 4.5, status: "onboarding", signedAt: new Date(now - 8 * day), createdAt: new Date(now - 8 * day) },
  { id: "o2", name: "Hill Country Driving — Round Rock", contactName: "Dan Kovacs", contactEmail: "dan@hillcountrydriving.com", memberEmails: ["dan@hillcountrydriving.com"], seats: 40, pricePerSeat: 4.5, status: "live", signedAt: new Date(now - 30 * day), createdAt: new Date(now - 30 * day) },
];

// Seat requests raised from the school portal (same doc shape the portal's
// "Request additional seats" button writes). One open request keeps the admin
// queue exercisable in demos.
const partnerRequests = [
  { id: "r1", orgId: "o1", orgName: "Hill Country Driving Academy", type: "seats", quantity: 15, requestedByEmail: "office@hillcountrydriving.com", status: "open", createdAt: new Date(now - 2 * day) },
  { id: "r2", orgId: "o2", orgName: "Hill Country Driving — Round Rock", type: "seats", quantity: 10, requestedByEmail: "dan@hillcountrydriving.com", status: "done", createdAt: new Date(now - 20 * day), resolvedAt: new Date(now - 19 * day) },
];

// Support notes — authorId/authorName is the same shape the iOS admin panel
// writes (FirebaseService.addAdminNote).
const adminNotes = [
  { id: "n1", userId: "demo-user-0", text: "Family asked about transferring hours logged on paper — pointed them at the manual-entry flow.", authorId: "demo-admin", authorName: "Demo Admin", createdAt: new Date(now - 6 * day) },
  { id: "n2", userId: "demo-user-4", text: "Rejected drive was a GPS glitch (2 mi in 3 min) — told them to re-log it.", authorId: "demo-admin", authorName: "Demo Admin", createdAt: new Date(now - 3 * day) },
];

const onboarding = [
  { id: "t1", orgId: "o1", title: "Contract signed", done: true, order: 1 },
  { id: "t2", orgId: "o1", title: "Seats provisioned", done: true, order: 2 },
  { id: "t3", orgId: "o1", title: "Staff training session", done: false, order: 3 },
  { id: "t4", orgId: "o1", title: "Student invite links distributed", done: false, order: 4 },
  { id: "t5", orgId: "o1", title: "Launch date confirmed", done: false, order: 5 },
  { id: "t6", orgId: "o2", title: "Contract signed", done: true, order: 1 },
  { id: "t7", orgId: "o2", title: "Seats provisioned", done: true, order: 2 },
  { id: "t8", orgId: "o2", title: "Staff training session", done: true, order: 3 },
  { id: "t9", orgId: "o2", title: "Student invite links distributed", done: true, order: 4 },
  { id: "t10", orgId: "o2", title: "Launch date confirmed", done: true, order: 5 },
];

export const demoDataset = { users, trips, appConfig, audit, broadcasts, prospects, quotes, partnerOrgs, onboarding, partnerRequests, adminNotes };
