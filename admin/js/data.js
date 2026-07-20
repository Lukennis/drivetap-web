// Firestore data layer. Every mutation mirrors the iOS admin's conventions:
// same collection names, same field shapes, and an adminAudit entry for every
// state-changing action — one shared history across both admin surfaces.
//
// Demo mode (?demo=1): all reads come from canned data, all writes are blocked.
// Safe to project on a wall in a sales meeting.
import { db } from "./firebase-init.js";
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc,
  query, orderBy, limit, where, serverTimestamp, deleteField,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { toast, toDate } from "./util.js";
import { demoDataset } from "./sections/demo-data.js";

export const isDemo = new URLSearchParams(location.search).has("demo");

export const session = {
  adminUser: null, // users/{uid} doc of the signed-in admin
};

const cache = new Map();

async function cached(key, loader) {
  if (!cache.has(key)) cache.set(key, await loader());
  return cache.get(key);
}

export function invalidate(prefix) {
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

function guardWrite() {
  if (isDemo) {
    toast("Demo mode — writes are disabled.", "warn");
    throw new Error("demo-mode");
  }
}

const snapToObj = (snap) => ({ id: snap.id, ...snap.data() });

// ---- Loads ---------------------------------------------------------------

export async function loadUsers() {
  if (isDemo) return demoDataset.users;
  return cached("users", async () => {
    const snap = await getDocs(collection(db, "users"));
    return snap.docs.map(snapToObj);
  });
}

export async function loadTrips({ max = 2500 } = {}) {
  if (isDemo) return demoDataset.trips;
  return cached(`trips:${max}`, async () => {
    const snap = await getDocs(query(collection(db, "trips"), orderBy("startTime", "desc"), limit(max)));
    return snap.docs.map(snapToObj);
  });
}

export async function loadTripsForUser(userId) {
  if (isDemo) return demoDataset.trips.filter((t) => t.userId === userId);
  return cached(`tripsUser:${userId}`, async () => {
    const snap = await getDocs(query(collection(db, "trips"), where("userId", "==", userId)));
    return snap.docs
      .map(snapToObj)
      .sort((a, b) => (toDate(b.startTime)?.getTime() || 0) - (toDate(a.startTime)?.getTime() || 0));
  });
}

export async function loadAppConfig() {
  if (isDemo) return demoDataset.appConfig;
  return cached("appConfig", async () => {
    const snap = await getDoc(doc(db, "appConfig", "settings"));
    return snap.exists() ? snap.data() : {};
  });
}

export async function loadAudit({ max = 400 } = {}) {
  if (isDemo) return demoDataset.audit;
  return cached("audit", async () => {
    const snap = await getDocs(query(collection(db, "adminAudit"), orderBy("createdAt", "desc"), limit(max)));
    return snap.docs.map(snapToObj);
  });
}

export async function loadBroadcasts() {
  if (isDemo) return demoDataset.broadcasts;
  return cached("broadcasts", async () => {
    const snap = await getDocs(query(collection(db, "adminBroadcasts"), orderBy("createdAt", "desc"), limit(50)));
    return snap.docs.map(snapToObj);
  });
}

export async function loadNotes(userId) {
  if (isDemo) return [];
  const snap = await getDocs(query(collection(db, "adminUserNotes"), where("userId", "==", userId)));
  return snap.docs.map(snapToObj).sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0));
}

export async function loadDeals() {
  if (isDemo) return demoDataset.prospects;
  return cached("prospects", async () => {
    const snap = await getDocs(collection(db, "prospects"));
    return snap.docs.map(snapToObj);
  });
}

export async function loadQuotes() {
  if (isDemo) return demoDataset.quotes;
  return cached("quotes", async () => {
    const snap = await getDocs(collection(db, "quotes"));
    return snap.docs.map(snapToObj);
  });
}

export async function loadPartnerOrgs() {
  if (isDemo) return demoDataset.partnerOrgs;
  return cached("partnerOrgs", async () => {
    const snap = await getDocs(collection(db, "partnerOrgs"));
    return snap.docs.map(snapToObj);
  });
}

export async function loadOnboarding(orgId) {
  if (isDemo) return demoDataset.onboarding.filter((t) => t.orgId === orgId);
  const snap = await getDocs(query(collection(db, "partnerOnboarding"), where("orgId", "==", orgId)));
  return snap.docs.map(snapToObj).sort((a, b) => (a.order || 0) - (b.order || 0));
}

// ---- Audit (identical shape to FirebaseService.logAdminAction) -----------

export async function logAction(action, targetType, targetId, detail) {
  if (isDemo) return;
  const admin = session.adminUser;
  await addDoc(collection(db, "adminAudit"), {
    action,
    targetType,
    targetId,
    detail,
    adminId: admin?.id ?? "unknown",
    adminName: admin ? `${admin.firstName ?? ""} ${admin.lastName ?? ""}`.trim() || "Web admin" : "Web admin",
    createdAt: serverTimestamp(),
  });
  invalidate("audit");
}

// ---- Mutations -----------------------------------------------------------

export async function updateUserFields(userId, fields, auditDetail) {
  guardWrite();
  await updateDoc(doc(db, "users", userId), { ...fields, updatedAt: serverTimestamp() });
  await logAction("user_edit", "user", userId, auditDetail);
  invalidate("users");
}

export async function updateTripStatus(trip, status) {
  guardWrite();
  await updateDoc(doc(db, "trips", trip.id), { status, updatedAt: serverTimestamp() });
  await logAction("trip_status", "trip", trip.id, `Status → ${status} (web admin)`);
  invalidate("trips");
  invalidate(`tripsUser:${trip.userId}`);
}

export async function saveConfigValues(values, auditDetail) {
  guardWrite();
  const payload = {};
  for (const [key, value] of Object.entries(values)) {
    payload[key] = value === undefined ? deleteField() : value;
  }
  await setDoc(doc(db, "appConfig", "settings"), payload, { merge: true });
  await logAction("config_change", "appConfig", "settings", auditDetail);
  invalidate("appConfig");
}

export async function addNote(userId, text) {
  guardWrite();
  const admin = session.adminUser;
  await addDoc(collection(db, "adminUserNotes"), {
    userId,
    text,
    adminId: admin?.id ?? "unknown",
    adminName: admin ? `${admin.firstName ?? ""} ${admin.lastName ?? ""}`.trim() || "Web admin" : "Web admin",
    createdAt: serverTimestamp(),
  });
}

export async function deleteNote(noteId) {
  guardWrite();
  await deleteDoc(doc(db, "adminUserNotes", noteId));
}

export async function createBroadcast({ title, body, segment }) {
  guardWrite();
  await addDoc(collection(db, "adminBroadcasts"), {
    title,
    body,
    segment,
    status: "queued",
    createdAt: serverTimestamp(),
  });
  await logAction("broadcast", "push", segment, `"${title}" → ${segment}`);
  invalidate("broadcasts");
}

// Deals workspace CRUD ------------------------------------------------------

export async function saveDeal(deal) {
  guardWrite();
  const { id, ...fields } = deal;
  if (id) {
    await updateDoc(doc(db, "prospects", id), { ...fields, updatedAt: serverTimestamp() });
    invalidate("prospects");
    return id;
  }
  const ref = await addDoc(collection(db, "prospects"), { ...fields, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  await logAction("deal_create", "prospect", ref.id, `Prospect "${fields.name}" added`);
  invalidate("prospects");
  return ref.id;
}

export async function deleteDeal(id) {
  guardWrite();
  await deleteDoc(doc(db, "prospects", id));
  invalidate("prospects");
}

export async function saveQuote(quote) {
  guardWrite();
  const { id, ...fields } = quote;
  if (id) {
    await updateDoc(doc(db, "quotes", id), { ...fields, updatedAt: serverTimestamp() });
    invalidate("quotes");
    return id;
  }
  const ref = await addDoc(collection(db, "quotes"), { ...fields, createdAt: serverTimestamp() });
  await logAction("quote_create", "quote", ref.id, `Quote for "${fields.schoolName}" (${fields.seats} seats)`);
  invalidate("quotes");
  return ref.id;
}

export async function savePartnerOrg(org) {
  guardWrite();
  const { id, ...fields } = org;
  if (id) {
    await updateDoc(doc(db, "partnerOrgs", id), { ...fields, updatedAt: serverTimestamp() });
    invalidate("partnerOrgs");
    return id;
  }
  const ref = await addDoc(collection(db, "partnerOrgs"), { ...fields, createdAt: serverTimestamp() });
  await logAction("partner_create", "partnerOrg", ref.id, `Partner "${fields.name}" created`);
  invalidate("partnerOrgs");
  return ref.id;
}

export async function loadPartnerRequests() {
  if (isDemo) return [];
  return cached("partnerRequests", async () => {
    const snap = await getDocs(collection(db, "partnerRequests"));
    return snap.docs.map(snapToObj).sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0));
  });
}

export async function resolvePartnerRequest(id, status) {
  guardWrite();
  await updateDoc(doc(db, "partnerRequests", id), { status, resolvedAt: serverTimestamp() });
  await logAction("partner_request", "partnerRequest", id, `Request marked ${status}`);
  invalidate("partnerRequests");
}

export async function saveOnboardingItem(item) {
  guardWrite();
  const { id, ...fields } = item;
  if (id) {
    await updateDoc(doc(db, "partnerOnboarding", id), fields);
    return id;
  }
  const ref = await addDoc(collection(db, "partnerOnboarding"), fields);
  return ref.id;
}

export async function deleteOnboardingItem(id) {
  guardWrite();
  await deleteDoc(doc(db, "partnerOnboarding", id));
}
