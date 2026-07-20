// Canned dataset for ?demo=1 — pitch-safe fake data shaped exactly like the
// real Firestore documents. Deterministic (no randomness) so demos look the
// same every time.
const now = Date.now();
const day = 86400000;
const names = [
  ["Ava", "Martinez"], ["Liam", "Johnson"], ["Mia", "Chen"], ["Noah", "Williams"],
  ["Sofia", "Garcia"], ["Ethan", "Brown"], ["Zoe", "Davis"], ["Lucas", "Miller"],
  ["Emma", "Wilson"], ["Mason", "Moore"], ["Olivia", "Taylor"], ["Jack", "Anderson"],
];
const states = ["Texas", "Texas", "Texas", "California", "Florida", "Ohio", "North Carolina", "Texas", "Georgia", "Iowa", "Texas", "Colorado"];

const demoPlans = ["drivetap.unlimited.yearly", "drivetap.unlimited.yearly.t2", "drivetap.unlimited.yearly", "drivetap.unlimited.yearly.t3"];

const users = names.map(([first, last], i) => ({
  id: `demo-user-${i}`,
  firstName: first,
  lastName: last,
  email: `${first.toLowerCase()}@example.com`,
  role: i % 4 === 3 ? "parent" : "teen",
  state: states[i],
  hasPremium: i % 3 === 0,
  premiumSource: i % 3 === 0 ? "storekit" : null,
  subscriptionProductId: i % 3 === 0 ? demoPlans[(i / 3) % demoPlans.length | 0] : null,
  isTester: false,
  isSuspended: false,
  isAdmin: false,
  lifetimeTripCount: 8 + i * 3,
  requiredHoursGoal: 50,
  requiredNightHoursGoal: 10,
  partnerOrgId: i < 6 && i % 4 !== 3 ? "o1" : null,
  createdAt: new Date(now - (80 - i * 6) * day),
  updatedAt: new Date(now - i * day),
}));

const maneuverSets = [
  ["Left turn", "Right turn", "Complete stop", "Smooth braking"],
  ["Highway driving", "Highway merge", "Lane change"],
  ["Parallel parking", "Reversing", "3-point turn"],
  ["Left turn", "Traffic light", "Heavy traffic", "Smooth acceleration"],
];

const trips = [];
users.filter((u) => u.role === "teen").forEach((u, ui) => {
  for (let t = 0; t < 6; t++) {
    const start = new Date(now - (ui * 5 + t * 3 + 1) * day);
    const durationMin = 30 + ((ui + t) % 5) * 15;
    trips.push({
      id: `demo-trip-${ui}-${t}`,
      userId: u.id,
      startTime: start,
      duration: durationMin * 60,
      distanceMeters: durationMin * 700,
      status: t === 0 ? "pending" : "approved",
      dayMinutes: t % 3 === 0 ? Math.round(durationMin * 0.6) : durationMin,
      nightMinutes: t % 3 === 0 ? Math.round(durationMin * 0.4) : 0,
      detectedManeuvers: maneuverSets[(ui + t) % maneuverSets.length],
      practiceCategoryId: (t % 4) + 1,
      supervisorName: t === 0 ? null : "Pat Parent",
      supervisorSignaturePNG: t === 0 ? null : "demo",
      safetyScore: { overall: 78 + ((ui + t) % 4) * 5, smoothness: 80, cornering: 75, stopDiscipline: 90, engineVersion: 2, rollingStopCount: t % 4 === 2 ? 1 : 0 },
      weatherCondition: ["Clear", "Cloudy", "Rain", "Clear"][(ui + t) % 4],
      isManualEntry: false,
      createdAt: start,
      updatedAt: start,
    });
  }
});

const appConfig = {
  maintenanceMode: false,
  broadcastMessage: "",
  freeDriveLimit: 10,
  maxDailyCountedHours: 2.5,
  reviewMinIntervalDays: 30,
};

const audit = [
  { id: "a1", action: "user_edit", targetType: "user", targetId: "demo-user-2", detail: "Granted premium (demo)", adminName: "Demo Admin", createdAt: new Date(now - day) },
  { id: "a2", action: "config_change", targetType: "appConfig", targetId: "settings", detail: "freeDriveLimit 12 → 10", adminName: "Demo Admin", createdAt: new Date(now - 2 * day) },
  { id: "a3", action: "broadcast", targetType: "push", targetId: "all", detail: '"Night hours update" → all', adminName: "Demo Admin", createdAt: new Date(now - 4 * day) },
];

const broadcasts = [
  { id: "b1", title: "Night hours update", body: "Sunset tracking just got smarter — open the planner tonight.", segment: "all", status: "sent", targeted: 220, delivered: 214, createdAt: new Date(now - 4 * day) },
];

const prospects = [
  { id: "p1", name: "Lone Star Driving Academy", contactName: "Rachel Kim", contactEmail: "rachel@lonestardriving.com", phone: "(512) 555-0187", city: "Austin, TX", students: 220, stage: "demo", nextAction: "Follow up after Thursday demo", nextActionDate: new Date(now + 2 * day), notes: "Loved the DES150N auto-fill. Asking about bulk pricing.", createdAt: new Date(now - 12 * day) },
  { id: "p2", name: "Sunrise Driver Ed", contactName: "Marcus Webb", contactEmail: "marcus@sunrisedriver.com", phone: "(214) 555-0142", city: "Dallas, TX", students: 140, stage: "negotiating", nextAction: "Send revised quote (120 seats)", nextActionDate: new Date(now + 1 * day), notes: "Wants seat price under $4. Competitor quote in hand.", createdAt: new Date(now - 30 * day) },
  { id: "p3", name: "Golden Gate Teen Driving", contactName: "Priya Shah", contactEmail: "priya@ggteendriving.com", phone: "(415) 555-0119", city: "San Francisco, CA", students: 310, stage: "lead", nextAction: "Intro call", nextActionDate: new Date(now + 5 * day), notes: "Inbound from the website.", createdAt: new Date(now - 3 * day) },
  { id: "p4", name: "Buckeye Driving School", contactName: "Dan Kovacs", contactEmail: "dan@buckeyedriving.com", phone: "(614) 555-0173", city: "Columbus, OH", students: 95, stage: "signed", nextAction: "Kickoff call Monday", nextActionDate: new Date(now + 3 * day), notes: "Signed 95 seats @ $4.50/mo. Wants OH form export next quarter.", createdAt: new Date(now - 60 * day) },
];

const quotes = [
  { id: "q1", schoolName: "Sunrise Driver Ed", contactName: "Marcus Webb", seats: 120, pricePerSeat: 4.5, discountPct: 10, termMonths: 12, notes: "Annual prepay discount applied.", createdAt: new Date(now - 5 * day) },
];

const partnerOrgs = [
  { id: "o1", name: "Buckeye Driving School", contactName: "Dan Kovacs", contactEmail: "dan@buckeyedriving.com", memberEmails: ["dan@buckeyedriving.com", "office@buckeyedriving.com"], seats: 95, seatsUsed: 41, pricePerSeat: 4.5, status: "onboarding", signedAt: new Date(now - 8 * day), createdAt: new Date(now - 8 * day) },
];

const onboarding = [
  { id: "t1", orgId: "o1", title: "Contract signed", done: true, order: 1 },
  { id: "t2", orgId: "o1", title: "Seats provisioned", done: true, order: 2 },
  { id: "t3", orgId: "o1", title: "Staff training session", done: false, order: 3 },
  { id: "t4", orgId: "o1", title: "Student invite links distributed", done: false, order: 4 },
  { id: "t5", orgId: "o1", title: "Launch date confirmed", done: false, order: 5 },
];

export const demoDataset = { users, trips, appConfig, audit, broadcasts, prospects, quotes, partnerOrgs, onboarding };
