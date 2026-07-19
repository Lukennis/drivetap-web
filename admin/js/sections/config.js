// Live config center — appConfig/settings with typed rows for the known
// switches, a validated JSON editor for detectionConfigV2, and a raw add/edit
// row for anything else. Every save writes an audit entry.
import { loadAppConfig, saveConfigValues, invalidate } from "../data.js";
import { el, clear, toast } from "../util.js";

const KNOWN = [
  { key: "maintenanceMode", type: "bool", label: "Maintenance mode", note: "Locks non-admins out of the app" },
  { key: "subscriptionEnforcementDisabled", type: "bool", label: "Disable premium enforcement", note: "Everyone gets premium features (testing)" },
  { key: "broadcastMessage", type: "string", label: "In-app banner message", note: "Empty = no banner" },
  { key: "freeDriveLimit", type: "number", label: "Free drive limit", note: "Lifetime drives before paywall" },
  { key: "maxDailyCountedHours", type: "number", label: "Default daily counted-hours cap", note: "States without a verified cap" },
  { key: "reviewMinIntervalDays", type: "number", label: "Review prompt spacing (days)", note: "Minimum gap between rating asks" },
  { key: "eulaURL", type: "string", label: "EULA URL", note: "" },
  { key: "privacyPolicyURL", type: "string", label: "Privacy policy URL", note: "" },
  { key: "termsOfServiceURL", type: "string", label: "Terms of service URL", note: "" },
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

  const rows = KNOWN.map((spec) => {
    const current = config[spec.key];
    let input;
    if (spec.type === "bool") {
      input = el("select", { onchange: (e) => { dirty[spec.key] = e.target.value === "true"; } },
        el("option", { value: "false", ...(current !== true ? { selected: "" } : {}) }, "off"),
        el("option", { value: "true", ...(current === true ? { selected: "" } : {}) }, "ON"),
      );
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
      el("td", { style: "width:240px" }, input),
    );
  });

  // detectionConfigV2 JSON editor with the same tolerance rules as the apps.
  const detectionRaw = config.detectionConfigV2;
  const detectionText = el("textarea", {
    class: "mono", rows: 8,
    placeholder: '{"hardBrakingMphPerSec": 7.0, ...}',
  });
  detectionText.value = detectionRaw
    ? typeof detectionRaw === "string" ? detectionRaw : JSON.stringify(detectionRaw, null, 2)
    : "";
  const detectionStatus = el("p", { class: "card-sub" }, "Numbers only; unknown keys are ignored by the apps.");
  const validateDetection = () => {
    const text = detectionText.value.trim();
    if (!text) { detectionStatus.textContent = "Empty — saving clears the override (apps revert to built-in defaults)."; return { ok: true, value: undefined }; }
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
      el("p", { class: "card-sub" }, "Same appConfig/settings document the iOS app reads live. Changed fields save together."),
      el("table", {}, el("tbody", {}, rows)),
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
    ),
    el("div", { class: "card" },
      el("h3", {}, "Detection Config (v2)"),
      el("p", { class: "card-sub" }, "Remote thresholds for the maneuver engine — both iOS and Android read this. See DETECTION_ENGINE_SPEC.md for every key."),
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
