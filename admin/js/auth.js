// Sign-in + admin gate. Anyone can load this page; only accounts whose
// users/{uid} doc has isAdmin == true get past this gate — and even a hacked
// client gets nothing, because every collection the suite touches is
// admin-gated in Firestore rules (server-side).
//
// Session behavior: persistence is explicitly browser-local (survives reloads
// and restarts on a normal browser). The overlay starts in a "restoring"
// state and only offers the sign-in button once Firebase confirms there is
// genuinely no session — so a returning admin never sees a login flash.
// NOTE: sandboxed/preview browsers that reset their profile on every launch
// will always sign out; use a regular browser for a sticky session.
import { auth, db } from "./firebase-init.js";
import {
  GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut,
  setPersistence, browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { session, isDemo } from "./data.js";
import { el, clear } from "./util.js";

export function initAuth(onReady) {
  const overlay = document.getElementById("auth-overlay");
  const status = document.getElementById("auth-status");
  const signInBtn = document.getElementById("google-signin");

  if (isDemo) {
    session.adminUser = { id: "demo-admin", firstName: "Demo", lastName: "Admin", isAdmin: true };
    overlay.classList.add("hidden");
    onReady(session.adminUser);
    return;
  }

  // Until the first auth event arrives we don't know whether a session exists —
  // show "restoring", not a login form.
  signInBtn.classList.add("hidden");
  status.textContent = "Restoring session…";
  let sawFirstAuthEvent = false;

  setPersistence(auth, browserLocalPersistence).catch(() => { /* default persistence still applies */ });

  signInBtn.addEventListener("click", async () => {
    status.textContent = "";
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (err) {
      status.textContent = friendlyAuthError(err);
    }
  });

  onAuthStateChanged(auth, async (user) => {
    sawFirstAuthEvent = true;
    if (!user) {
      overlay.classList.remove("hidden");
      signInBtn.classList.remove("hidden");
      if (status.textContent === "Restoring session…") status.textContent = "";
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
        signInBtn.classList.remove("hidden");
        status.textContent = "This account doesn't have admin access.";
        await signOut(auth);
      }
    } catch (err) {
      // Transient failure (offline, slow network): stay signed in and retry,
      // don't dump the admin back to a login screen.
      signInBtn.classList.remove("hidden");
      status.textContent = `Couldn't verify access (${err.code || err.message}). Retrying…`;
      setTimeout(async () => {
        try {
          const snap = await getDoc(doc(db, "users", user.uid));
          if (snap.exists() && snap.data().isAdmin === true) {
            session.adminUser = { id: snap.id, ...snap.data() };
            overlay.classList.add("hidden");
            renderIdentity(session.adminUser);
            onReady(session.adminUser);
          }
        } catch { /* leave the overlay with the sign-in button */ }
      }, 2500);
    }
  });

  // If Firebase never fires (script blocked, storage disabled), surface the button.
  setTimeout(() => {
    if (!sawFirstAuthEvent) {
      signInBtn.classList.remove("hidden");
      status.textContent = "";
    }
  }, 4000);
}

function friendlyAuthError(err) {
  if ((err.code || "").includes("unauthorized-domain")) {
    return "This domain isn't authorized for sign-in yet — add it in Firebase Console → Authentication → Settings → Authorized domains.";
  }
  if ((err.code || "").includes("popup-blocked")) {
    return "Your browser blocked the sign-in popup — allow popups for this site and try again.";
  }
  if ((err.code || "").includes("popup-closed")) {
    return "Sign-in window closed before finishing.";
  }
  return err.message;
}

function renderIdentity(admin) {
  const host = document.getElementById("identity");
  clear(host).append(
    el("span", { class: "identity-name" }, `${admin.firstName ?? ""} ${admin.lastName ?? ""}`.trim() || "Admin"),
    el("button", { class: "link-btn", onclick: () => signOut(auth).then(() => location.reload()) }, "Sign out"),
  );
}
