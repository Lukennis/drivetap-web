// Firebase bootstrap for the DriveTap web admin suite.
// This config is public by design (it identifies the project, it does not
// grant access) — all authorization is enforced by Firestore security rules,
// which gate every admin collection on users/{uid}.isAdmin.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const firebaseConfig = {
  apiKey: "AIzaSyDjJVrwmUDKllcDaENkPREh73jCP1poOgg",
  authDomain: "drivetap-dda0e.firebaseapp.com",
  projectId: "drivetap-dda0e",
  storageBucket: "drivetap-dda0e.firebasestorage.app",
  messagingSenderId: "226636935320",
  appId: "1:226636935320:web:42ff906db3784ea40aa0ed",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
