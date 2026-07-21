// Push broadcasts — writes the same adminBroadcasts docs the iOS composer
// does; the sendAdminBroadcast Cloud Function fans them out and stamps status.
//
// Segment values are a contract with the function: all | teens | parents |
// premium. "teens" targets the teen AND standalone roles (all drivers);
// "premium" targets hasPremium == true (paid, granted, or family-linked).
import { loadBroadcasts, createBroadcast, invalidate } from "../data.js";
import { el, clear, fmtDateTime, toast } from "../util.js";

const SEGMENT_LABELS = {
  all: "Everyone",
  teens: "Drivers (teens + standalone)",
  parents: "Parents",
  premium: "DriveTap Unlimited members",
};

export const broadcastsSection = {
  id: "broadcasts",
  title: "Push",
  icon: "📣",
  async render(host) {
    const history = await loadBroadcasts();

    const title = el("input", { type: "text", placeholder: "Notification title", maxlength: "60", style: "width:100%" });
    const body = el("textarea", { rows: 3, placeholder: "Message…", maxlength: "220" });
    const segment = el("select", {},
      el("option", { value: "all" }, SEGMENT_LABELS.all),
      el("option", { value: "teens" }, SEGMENT_LABELS.teens),
      el("option", { value: "parents" }, SEGMENT_LABELS.parents),
      el("option", { value: "premium" }, `${SEGMENT_LABELS.premium} (paid, granted, or linked)`),
    );

    clear(host).append(
      el("div", { class: "card" },
        el("h3", {}, "Send a push"),
        el("p", { class: "card-sub" }, "Delivered by the sendAdminBroadcast Cloud Function. Status updates in the history below."),
        el("label", { class: "field" }, "Title", title),
        el("label", { class: "field" }, "Body", body),
        el("label", { class: "field" }, "Audience", segment),
        el("button", {
          class: "btn primary",
          onclick: async (e) => {
            if (!title.value.trim() || !body.value.trim()) { toast("Title and body are required", "warn"); return; }
            e.target.disabled = true;
            try {
              await createBroadcast({ title: title.value.trim(), body: body.value.trim(), segment: segment.value });
              toast("Broadcast queued — the function is sending it now.");
              invalidate("broadcasts");
              broadcastsSection.render(host);
            } finally {
              e.target.disabled = false;
            }
          },
        }, "Queue broadcast"),
      ),
      el("div", { class: "card table-wrap" },
        el("h3", {}, "History"),
        history.length === 0 ? el("p", { class: "card-sub" }, "No broadcasts yet.") : el("table", {},
          el("thead", {}, el("tr", {}, el("th", {}, "When"), el("th", {}, "Title"), el("th", {}, "Audience"), el("th", {}, "Status"), el("th", {}, "Delivered"))),
          el("tbody", {}, history.map((b) =>
            el("tr", {},
              el("td", {}, fmtDateTime(b.createdAt)),
              el("td", {}, el("strong", {}, b.title ?? ""), el("div", { class: "kpi-note" }, b.body ?? "")),
              el("td", {}, SEGMENT_LABELS[b.segment] ?? b.segment ?? "Everyone"),
              el("td", {}, el("span", { class: `badge ${b.status === "sent" ? "green" : b.status === "failed" ? "red" : "orange"}` }, b.status ?? "queued")),
              el("td", {}, b.targeted != null ? `${b.delivered ?? 0}/${b.targeted}` : "—"),
            ),
          )),
        ),
      ),
    );
  },
};
