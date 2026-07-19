// Sign-in + admin gate. Anyone can load this page; only accounts whose
// users/{uid} doc has isAdmin == true get past this gate — and even a hacked
// client gets nothing, because every collection the suite touches is
// admin-gated in Firestore rules (server-side).
import { auth, db } from "./firebase-init.js";
import {
  GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { session, isDemo } from "./data.js";
import { el, clear } from "./util.js";

export function initAuth(onReady) {
  const overlay = document.getElementById("auth-overlay");
  const status = document.getElementById("auth-status");

  if (isDemo) {
    session.adminUser = { id: "demo-admin", firstName: "Demo", lastName: "Admin", isAdmin: true };
    overlay.classList.add("hidden");
    onReady(session.adminUser);
    return;
  }

  document.getElementById("google-signin").addEventListener("click", async () => {
    status.textContent = "";
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (err) {
      status.textContent = err.message;
    }
  });

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      overlay.classList.remove("hidden");
      session.adminUser = null;
      return;
    }
    status.textContent = "Checking admin access…";
    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      if (snap.exists() && snap.data().isAdmin === true) {
        session.adminUser = { id: snap.id, ...snap.data() };
        overlay.classList.add("hidden");
        renderIdentity(session.adminUser);
        onReady(session.adminUser);
      } else {
        status.textContent = "This account doesn't have admin access.";
        await signOut(auth);
      }
    } catch (err) {
      status.textContent = `Couldn't verify access: ${err.message}`;
    }
  });
}

function renderIdentity(admin) {
  const host = document.getElementById("identity");
  clear(host).append(
    el("span", { class: "identity-name" }, `${admin.firstName ?? ""} ${admin.lastName ?? ""}`.trim() || "Admin"),
    el("button", { class: "link-btn", onclick: () => signOut(auth).then(() => location.reload()) }, "Sign out"),
  );
}
