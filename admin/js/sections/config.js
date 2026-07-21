// Live config center — appConfig/settings with typed rows for every key the
// iOS app actually reads (SubscriptionManager's config listener, AdminView,
// and the Cloud Functions' admin-alert toggles), a validated JSON editor for
// detectionConfigV2, and a raw add/edit row for anything else. Every save
// writes an audit entry.
import { loadAppConfig, saveConfigValues, invalidate } from "../data.js";
import { el, clear, toast } from "../util.js";

// Sourced from the app: SubscriptionManager.startAppConfigListener +
// AdminView.applyConfig + functions/index.js adminNotify* flags. If a key
// isn't read by one of those, it doesn't belong here.
const GROUPS = [
  {
    title: "Kill switches & operations",
    rows: [
      { key: "maintenanceMode", type: "bool", label: "Maintenance mode", note: "Locks everyone except admins out of the app" },
      { key: "broadcastMessage", type: "string", label: "In-app banner message", note: "Persistent banner shown in the app; empty = hidden" },
      { key: "subscriptionEnforcementDisabled", type: "bool", label: "Disable premium enforcement", note: "Every account gets DriveTap Unlimited features while ON" },
      { key: "minimumAppVersion", type: "string", label: "Minimum app version", note: "Older versions are told to update (shown with the message below)" },
      { key: "updateMessage", type: "string", label: "Update message", note: "Copy shown with the forced-update prompt" },
    ],
  },
  {
    title: "Drive counting & paywall limits",
    rows: [
      { key: "freeDriveLimit", type: "number", label: "Free drive limit", note: "Drives a free account can log before the DriveTap Unlimited paywall (app default 10)" },
      { key: "maxDailyCountedHours", type: "number", label: "Daily counted-hours cap", note: "Fallback cap for states without a published rule (app default 2.5 h; Texas applies its own 2 h/day DPS cap)" },
      { key: "trialLengthDays", type: "number", label: "Trial length (days)", note: "Display mirror of the App Store intro offer — StoreKit decides the real trial" },
    ],
  },
  {
    title: "Feature flags",
    rows: [
      { key: "parkingGameEnabled", type: "bool", label: "Parking game", note: "Parking practice mini-game on the driver dashboard (app default ON)" },
      { key: "guidedPracticeEnabled", type: "bool", label: "Guided practice", note: "Guided practice sessions feature (app default ON)" },
      { key: "referralEnabled", type: "bool", label: "Referral program", note: "Flag is stored, but today only the iOS admin panel reads it" },
      { key: "referralRewardText", type: "string", label: "Referral reward copy", note: "Reward line shown on the referral screen" },
    ],
  },
  {
    title: "Ratings & upgrade prompts",
    rows: [
      { key: "reviewPromptEnabled", type: "bool", label: "App Store rating prompt", note: "App default ON" },
      { key: "reviewMinIntervalDays", type: "number", label: "Rating prompt spacing (days)", note: "Minimum gap between rating asks (app default 30)" },
      { key: "premiumPromptsEnabled", type: "bool", label: "Upgrade prompts", note: "Occasional DriveTap Unlimited prompts for free accounts (app default ON)" },
      { key: "premiumPromptMinIntervalHours", type: "number", label: "Upgrade prompt spacing (hours)", note: "Minimum gap between upgrade prompts (app default 24)" },
    ],
  },
  {
    title: "Paywall & promo copy",
    rows: [
      { key: "paywallHeadline", type: "string", label: "Paywall headline", note: "Empty = the app's built-in copy" },
      { key: "paywallSubheadline", type: "string", label: "Paywall subheadline", note: "Empty = built-in copy" },
      { key: "paywallSocialProof", type: "string", label: "Paywall social proof", note: "Small trust line on the paywall" },
      { key: "offerBannerText", type: "string", label: "Limited-time offer banner", note: "Shown on the paywall until the expiry below" },
      { key: "offerExpiresAt", type: "string", label: "Offer expires at", note: "ISO date, e.g. 2026-08-01T00:00:00Z — banner hides after this" },
      { key: "promoBannerText", type: "string", label: "Promo banner text", note: "In-app promo banner; empty = hidden" },
      { key: "promoBannerURL", type: "string", label: "Promo banner link", note: "Where the promo banner opens" },
    ],
  },
  {
    title: "Support & legal",
    rows: [
      { key: "supportEmail", type: "string", label: "Support email", note: "Shown in the app's support screen" },
      { key: "supportURL", type: "string", label: "Support URL", note: "Optional support site link" },
      { key: "privacyPolicyURL", type: "string", label: "Privacy policy URL", note: "" },
      { key: "termsOfServiceURL", type: "string", label: "Terms of service URL", note: "" },
      { key: "eulaURL", type: "string", label: "EULA URL", note: "Optional — the app falls back to the terms URL" },
      { key: "appStoreURL", type: "string", label: "App Store URL", note: "Read by the app for share/rate links; also used in the portal's student invite emails" },
      { key: "privacyPolicyText", type: "longtext", label: "Privacy policy text", note: "Full replacement for the in-app screen; empty = built-in copy" },
      { key: "termsText", type: "longtext", label: "Terms text", note: "Full replacement for the in-app screen; empty = built-in copy" },
      { key: "supportInfoText", type: "longtext", label: "Support info text", note: "Full replacement for the in-app screen; empty = built-in copy" },
    ],
  },
  {
    title: "Admin push alerts (delivered by Cloud Functions)",
    rows: [
      { key: "adminNotifyNewAccounts", type: "bool", label: "New accounts", note: "Push to admin devices when an account is created" },
      { key: "adminNotifyNewTrips", type: "bool", label: "New drives", note: "Push when any drive is logged" },
      { key: "adminNotifyPendingApprovals", type: "bool", label: "Pending approvals", note: "Push when a drive is awaiting approval (at most one of these two per drive)" },
      { key: "adminNotifySubscriptionChanges", type: "bool", label: "Subscription changes", note: "Push when an account's premium status changes" },
      { key: "adminNotifyAccountLinks", type: "bool", label: "Account links", note: "Push when a teen/parent link changes" },
      { key: "adminNotifySuspensions", type: "bool", label: "Suspensions", note: "Push when an account is suspended" },
      { key: "adminNotifyWeatherFailures", type: "bool", label: "Weather failures", note: "Push when a drive's weather lookup fails" },
    ],
  },
  {
    title: "Analytics",
    rows: [
      { key: "revenueExcludedUserIds", type: "list", label: "Revenue-excluded user IDs", note: "Comma-separated user IDs left out of revenue math (founder/family accounts) — both admin surfaces honor it" },
    ],
  },
];

export const configSection = {
  id: "config",
  title: "Config",
  icon: "⚙️",
  async render(host) {
    const config = await loadAppConfig();
    const container = el("div");
    clear(host).append(container);
    draw(container, config, host);
  },
};

function draw(container, config, host) {
  const dirty = {};

  const rowsFor = (specs) => specs.map((spec) => {
    const current = config[spec.key];
    let input;
    if (spec.type === "bool") {
      input = el("select", { onchange: (e) => { dirty[spec.key] = e.target.value === "true"; } },
        el("option", { value: "false", ...(current !== true ? { selected: "" } : {}) }, "off"),
        el("option", { value: "true", ...(current === true ? { selected: "" } : {}) }, "ON"),
      );
    } else if (spec.type === "longtext") {
      input = el("textarea", {
        rows: 3, style: "width:100%",
        oninput: (e) => { const v = e.target.value; dirty[spec.key] = v === "" ? undefined : v; },
      }, current ?? "");
    } else if (spec.type === "list") {
      input = el("input", {
        type: "text",
        value: Array.isArray(current) ? current.join(", ") : "",
        placeholder: "uid1, uid2",
        style: "width:100%",
        oninput: (e) => {
          const items = e.target.value.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
          dirty[spec.key] = items.length ? items : undefined;
        },
      });
    } else {
      input = el("input", {
        type: spec.type === "number" ? "number" : "text",
        value: current ?? "",
        step: "any",
        style: "width:100%",
        oninput: (e) => {
          const v = e.target.value;
          dirty[spec.key] = v === "" ? undefined : spec.type === "number" ? Number(v) : v;
        },
      });
    }
    return el("tr", {},
      el("td", {}, el("strong", {}, spec.label), el("div", { class: "kpi-note" }, `${spec.key}${spec.note ? " — " + spec.note : ""}`)),
      el("td", { style: "width:260px" }, input),
    );
  });

  const tableRows = GROUPS.flatMap((group) => [
    el("tr", {}, el("td", { colspan: "2", style: "padding-top:16px" },
      el("strong", { style: "font-size:12px; text-transform:uppercase; letter-spacing:0.4px; color:var(--text-dim)" }, group.title))),
    ...rowsFor(group.rows),
  ]);

  // detectionConfigV2 JSON editor with the same tolerance rules as the app.
  const detectionRaw = config.detectionConfigV2;
  const detectionText = el("textarea", {
    class: "mono", rows: 8,
    placeholder: '{"hardBrakingMphPerSec": 7.0, ...}',
  });
  detectionText.value = detectionRaw
    ? typeof detectionRaw === "string" ? detectionRaw : JSON.stringify(detectionRaw, null, 2)
    : "";
  const detectionStatus = el("p", { class: "card-sub" }, "Numbers only; the app ignores unknown keys.");
  const validateDetection = () => {
    const text = detectionText.value.trim();
    if (!text) { detectionStatus.textContent = "Empty — saving clears the override (the app reverts to its built-in thresholds)."; return { ok: true, value: undefined }; }
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("must be a JSON object");
      const applying = Object.entries(parsed).filter(([, v]) => typeof v === "number" && Number.isFinite(v));
      const junk = Object.entries(parsed).filter(([, v]) => !(typeof v === "number" && Number.isFinite(v))).map(([k]) => k);
      detectionStatus.textContent = `${applying.length} key${applying.length === 1 ? "" : "s"} will apply.${junk.length ? ` Ignored (non-numeric): ${junk.join(", ")}` : ""}`;
      return { ok: applying.length > 0, value: Object.fromEntries(applying.map(([k, v]) => [k, v])) };
    } catch (err) {
      detectionStatus.textContent = `Invalid JSON: ${err.message}`;
      return { ok: false };
    }
  };
  detectionText.addEventListener("input", validateDetection);

  // Free-form extra key editor.
  const extraKey = el("input", { type: "text", placeholder: "key" });
  const extraValue = el("input", { type: "text", placeholder: 'value (JSON: 42, true, "text")' });

  clear(container).append(
    el("div", { class: "card table-wrap" },
      el("h3", {}, "Remote switches"),
      el("p", { class: "card-sub" }, "The same appConfig/settings document the iOS app listens to live — every row below is a key the app (or the admin-alert Cloud Functions) actually reads. Changed fields save together."),
      el("table", {}, el("tbody", {}, tableRows)),
      el("div", { class: "toolbar", style: "margin-top:12px" },
        el("button", {
          class: "btn primary",
          onclick: async () => {
            if (!Object.keys(dirty).length) { toast("Nothing changed."); return; }
            const detail = Object.entries(dirty).map(([k, v]) => `${k} → ${v === undefined ? "(cleared)" : JSON.stringify(v)}`).join(", ");
            await saveConfigValues(dirty, `Config (web): ${detail}`);
            toast("Config saved");
            invalidate("appConfig");
            configSection.render(host);
          },
        }, "Save changes"),
      ),
      el("p", { class: "card-sub", style: "margin-top:10px" }, "Web-only key: planPrices (the per-plan price table) is edited in the Revenue section — the app never reads it."),
    ),
    el("div", { class: "card" },
      el("h3", {}, "Detection engine thresholds (detectionConfigV2)"),
      el("p", { class: "card-sub" }, "Remote overrides for the 23-maneuver detection engine (v2) — the iOS app re-tunes live. Every key is documented in DETECTION_ENGINE_SPEC.md in the app repo."),
      detectionText,
      detectionStatus,
      el("div", { class: "toolbar" },
        el("button", {
          class: "btn primary",
          onclick: async () => {
            const result = validateDetection();
            if (detectionText.value.trim() && !result.ok) { toast("Fix the JSON first", "error"); return; }
            await saveConfigValues({ detectionConfigV2: result.value }, result.value ? `detectionConfigV2 updated (${Object.keys(result.value).length} keys)` : "detectionConfigV2 cleared");
            toast(result.value ? "Detection config saved" : "Detection override cleared");
          },
        }, "Save detection config"),
      ),
    ),
    el("div", { class: "card" },
      el("h3", {}, "Any other key"),
      el("p", { class: "card-sub" }, "Escape hatch for config keys not listed above. Value is parsed as JSON."),
      el("div", { class: "toolbar" },
        extraKey, extraValue,
        el("button", {
          class: "btn",
          onclick: async () => {
            const key = extraKey.value.trim();
            if (!key) return;
            let value;
            try { value = extraValue.value.trim() === "" ? undefined : JSON.parse(extraValue.value); }
            catch { toast("Value must be valid JSON (quote strings)", "error"); return; }
            await saveConfigValues({ [key]: value }, `Config (web): ${key} → ${value === undefined ? "(cleared)" : extraValue.value}`);
            toast(`Saved ${key}`);
            configSection.render(host);
          },
        }, "Save key"),
      ),
      config ? el("details", {},
        el("summary", {}, "Current raw document"),
        el("pre", { class: "mono", style: "overflow:auto; font-size:12px" }, JSON.stringify(config, null, 2)),
      ) : null,
    ),
  );
}
