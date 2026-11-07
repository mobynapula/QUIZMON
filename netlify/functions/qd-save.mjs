import { getStore } from "@netlify/blobs";
import { createHash, timingSafeEqual } from "node:crypto";

const ok = id => /^[a-z0-9]{6,60}$/.test(id || "");
const R = (body, status = 200) => new Response(body, {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});
const J = (value, status = 200) => R(JSON.stringify(value), status);
const norm = value => String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const identityKey = (name, grade, section) => "deleted-account-" + createHash("sha256").update(`${norm(name)}|${String(grade ?? "")}|${norm(section)}`).digest("hex");
const deletedIdKey = id => "deleted-id-" + id;
const adminSecret = () => String(process.env.QUIZMON_ADMIN_KEY || "");

function authorized(req) {
  const expected = Buffer.from(adminSecret());
  const supplied = Buffer.from(String(req.headers.get("x-quizmon-admin") || ""));
  return expected.length > 0 && expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

async function adminAction(req, store, body) {
  if (!adminSecret()) return J({ error: "Admin access is not configured. Add QUIZMON_ADMIN_KEY in Netlify environment variables." }, 503);
  if (!authorized(req)) return J({ error: "Admin key not accepted." }, 401);

  if (body.kind === "admin:list") {
    const { blobs } = await store.list();
    const entries = blobs.filter(item => ok(item.key));
    const players = await Promise.all(entries.map(async item => {
      try {
        const data = await store.get(item.key, { type: "json" });
        if (!data || typeof data !== "object" || !data.n) return null;
        const safe = { ...data };
        delete safe.ph;
        delete safe.sah;
        delete safe.pin;
        delete safe.sq;
        return { id: item.key, ids: [item.key], data: safe };
      } catch {
        return null;
      }
    }));
    return J({ players: players.filter(Boolean) });
  }

  if (body.kind === "admin:update") {
    const ids = [...new Set((Array.isArray(body.ids) ? body.ids : [body.id]).filter(ok))];
    if (!ids.length || !body.patch || typeof body.patch !== "object" || Array.isArray(body.patch)) return J({ error: "Invalid account update." }, 400);
    const patch = {};
    if (typeof body.patch.ph === "string" && body.patch.ph.length <= 100) patch.ph = body.patch.ph;
    if (!Object.keys(patch).length) return J({ error: "No supported account changes were supplied." }, 400);
    let updated = 0;
    for (const id of ids) {
      const data = await store.get(id, { type: "json" });
      if (!data || typeof data !== "object" || !data.n) continue;
      await store.set(id, JSON.stringify({ ...data, ...patch }));
      updated++;
    }
    if (!updated) return J({ error: "Account not found." }, 404);
    return J({ ok: true, updated });
  }

  if (body.kind === "admin:delete") {
    const ids = [...new Set((Array.isArray(body.ids) ? body.ids : [body.id]).filter(ok))];
    if (!ids.length) return J({ error: "Invalid account ID." }, 400);
    const records = [];
    for (const id of ids) {
      const data = await store.get(id, { type: "json" });
      if (data && typeof data === "object" && data.n) records.push({ id, data });
    }
    if (!records.length) return J({ error: "Account not found." }, 404);
    const first = records[0].data;
    const identity = `${norm(first.n)}|${String(first.g ?? (first.P && first.P.g) ?? "")}|${norm(first.sec ?? (first.P && first.P.sec) ?? "")}`;
    for (const entry of records) {
      const d = entry.data;
      const other = `${norm(d.n)}|${String(d.g ?? (d.P && d.P.g) ?? "")}|${norm(d.sec ?? (d.P && d.P.sec) ?? "")}`;
      if (other !== identity) return J({ error: "The selected records do not belong to the same student account." }, 400);
    }
    await store.set(identityKey(first.n, first.g ?? (first.P && first.P.g), first.sec ?? (first.P && first.P.sec)), String(Date.now()));
    const idSet = new Set(records.map(x => x.id));
    await Promise.all(records.map(async ({ id }) => {
      await store.set(deletedIdKey(id), String(Date.now()));
      await store.delete(id);
    }));
    const { blobs: recoveryBlobs } = await store.list({ prefix: "r-" });
    await Promise.all(recoveryBlobs.map(async item => {
      try {
        const recovery = await store.get(item.key, { type: "json" });
        if (recovery && idSet.has(recovery.key)) await store.delete(item.key);
      } catch {
        // Keep an unreadable recovery record rather than risk deleting an unrelated item.
      }
    }));
    return J({ ok: true, deleted: records.length });
  }

  return J({ error: "Unknown admin action." }, 400);
}

export default async (req) => {
  const store = getStore("quizmon-saves");
  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      const recoveryId = url.searchParams.get("rec");
      const id = url.searchParams.get("id");
      if (recoveryId) {
        if (!ok(recoveryId)) return R("{}", 400);
        const record = await store.get("r-" + recoveryId, { type: "json" });
        if (!record) return R("{}", 404);
        if (await store.get(deletedIdKey(record.key))) return R("{}", 410);
        return J({ q: record.q });
      }
      if (!ok(id)) return R("{}", 400);
      if (await store.get(deletedIdKey(id))) return R("{}", 410);
      const name = url.searchParams.get("n"), grade = url.searchParams.get("g"), section = url.searchParams.get("sec");
      if (name && grade && section && await store.get(identityKey(name, grade, section))) return R("{}", 410);
      const data = await store.get(id);
      return data ? R(data) : R("{}", 404);
    }

    if (req.method === "POST") {
      const raw = await req.text();
      if (raw.length > 500000) return R("{}", 413);
      let body;
      try { body = JSON.parse(raw); } catch { return R("{}", 400); }

      if (typeof body.kind === "string" && body.kind.startsWith("admin:")) return await adminAction(req, store, body);
      if (!ok(body.id)) return R("{}", 400);

      if (body.kind === "rec") {
        if (!ok(body.key) || !body.q || !body.ah) return R("{}", 400);
        if (await store.get(deletedIdKey(body.key))) return R("{}", 410);
        const old = await store.get("r-" + body.id, { type: "json" });
        if (old && old.ah !== body.ah && old.ah !== body.prev) return R("{}", 403);
        await store.setJSON("r-" + body.id, {
          q: String(body.q).slice(0, 80),
          ah: String(body.ah),
          key: body.key,
          f: old ? old.f || 0 : 0,
          t: old ? old.t || 0 : 0,
        });
        return R("{}");
      }

      if (body.kind === "recover") {
        const record = await store.get("r-" + body.id, { type: "json" });
        if (!record || await store.get(deletedIdKey(record.key))) return R("{}", 404);
        if ((record.f || 0) >= 8 && Date.now() - (record.t || 0) < 900000) return R("{}", 429);
        if (record.ah !== body.ah) {
          record.f = (record.f || 0) + 1;
          record.t = Date.now();
          await store.setJSON("r-" + body.id, record);
          return R("{}", 403);
        }
        record.f = 0;
        await store.setJSON("r-" + body.id, record);
        const data = await store.get(record.key);
        return data ? J({ data: JSON.parse(data) }) : R("{}", 404);
      }

      if (!body.data) return R("{}", 400);
      if (await store.get(deletedIdKey(body.id))) return R("{}", 410);
      if (body.data.n && body.data.g != null && body.data.sec) {
        const deletedIdentity = identityKey(body.data.n, body.data.g, body.data.sec);
        if (await store.get(deletedIdentity)) return R("{}", 410);
      }
      await store.set(body.id, JSON.stringify(body.data));
      return R("{}");
    }

    return R("{}", 405);
  } catch (error) {
    console.error("qd-save error:", error);
    return J({ error: "The save service could not complete the request." }, 500);
  }
};
