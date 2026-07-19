// Push broadcasts — writes the same adminBroadcasts docs the iOS composer
// does; the sendAdminBroadcast Cloud Function fans them out and stamps status.
import { loadBroadcasts, createBroadcast, invalidate } from "../data.js";
import { el, clear, fmtDateTime, toast } from "../util.js";

export const broadcastsSection = {
  id: "broadcasts",
  title: "Push",
  icon: "📣",
  async render(host) {
    const history = await loadBroadcasts();

    const title = el("input", { type: "text", placeholder: "Notification title", maxlength: "60", style: "width:100%" });
    const body = el("textarea", { rows: 3, placeholder: "Message…", maxlength: "220" });
    const segment = el("select", {},
      el("option", { value: "all" }, "Everyone"),
      el("option", { value: "teens" }, "Teens / drivers"),
      el("option", { value: "parents" }, "Parents"),
      el("option", { value: "premium" }, "Premium users"),
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
              el("td", {}, b.segment ?? "all"),
              el("td", {}, el("span", { class: `badge ${b.status === "sent" ? "green" : b.status === "failed" ? "red" : "orange"}` }, b.status ?? "queued")),
              el("td", {}, b.targeted != null ? `${b.delivered ?? 0}/${b.targeted}` : "—"),
            ),
          )),
        ),
      ),
    );
  },
};
