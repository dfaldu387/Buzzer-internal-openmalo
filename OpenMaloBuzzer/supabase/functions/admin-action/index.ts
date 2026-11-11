// Admin-action Edge Function
// Verifies caller identity via PIN, checks role, then executes privileged operations.
// All sensitive mutations (pin_hash, role, user deletion) MUST go through this function.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ─── Crypto ────────────────────────────────────────────────

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(buf), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

function generateSalt(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

async function hashPinV2(pin: string): Promise<string> {
  const salt = generateSalt();
  let h = await sha256Hex(`${salt}:${pin}:openmalo_buzzer_v2`);
  for (let i = 0; i < 1000; i++) h = await sha256Hex(`${salt}:${h}`);
  return `v2:${salt}:${h}`;
}

async function verifyPinV2(pin: string, stored: string): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 3) return false;
  const salt = parts[1];
  let h = await sha256Hex(`${salt}:${pin}:openmalo_buzzer_v2`);
  for (let i = 0; i < 1000; i++) h = await sha256Hex(`${salt}:${h}`);
  // Constant-time comparison
  if (parts[2].length !== h.length) return false;
  let diff = 0;
  for (let i = 0; i < h.length; i++)
    diff |= parts[2].charCodeAt(i) ^ h.charCodeAt(i);
  return diff === 0;
}

function verifyPinLegacy(pin: string, stored: string): boolean {
  let hash = 0;
  const str = `openmalo_${pin}_salt`;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash.toString(36) === stored;
}

async function verifyPin(pin: string, stored: string): Promise<boolean> {
  if (stored.startsWith("v2:")) return verifyPinV2(pin, stored);
  return verifyPinLegacy(pin, stored);
}

// ─── Supabase REST helpers ─────────────────────────────────

const svcHeaders: Record<string, string> = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
};

async function dbGet(path: string): Promise<any[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { ...svcHeaders, Prefer: "return=representation" },
  });
  return res.ok ? await res.json() : [];
}

async function dbPost(table: string, body: any): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...svcHeaders, Prefer: "return=representation" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Insert failed: ${err}`);
  }
  const data = await res.json();
  return Array.isArray(data) ? data[0] : data;
}

async function dbPatch(path: string, body: any): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: "PATCH",
    headers: { ...svcHeaders, Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Update failed: ${err}`);
  }
}

async function dbDelete(path: string): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: "DELETE",
    headers: svcHeaders,
  });
}

// ─── Cascade delete ────────────────────────────────────────

async function cascadeDeleteUser(userId: string): Promise<void> {
  await dbDelete(`user_favorites?or=(user_id.eq.${userId},target_user_id.eq.${userId})`);
  await dbDelete(`user_tokens?user_id=eq.${userId}`);
  await dbDelete(`voice_mails?or=(from_user_id.eq.${userId},to_user_id.eq.${userId})`);
  await dbDelete(`call_logs?or=(caller_id.eq.${userId},receiver_id.eq.${userId})`);
  await dbDelete(`buzzes?or=(from_user_id.eq.${userId},to_user_id.eq.${userId})`);

  const groups = await dbGet(
    `groups?member_ids=cs.{${userId}}&select=id,member_ids`,
  );
  for (const g of groups) {
    const updated = (g.member_ids || []).filter((id: string) => id !== userId);
    await dbPatch(`groups?id=eq.${g.id}`, { member_ids: updated });
  }

  await dbDelete(`users?id=eq.${userId}`);
}

// ─── Main handler ──────────────────────────────────────────

function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "authorization, content-type, apikey",
      },
    });
  }

  try {
    const { caller_id, pin, action, payload } = await req.json();
    if (!caller_id || !pin || !action) {
      return json({ error: "Missing caller_id, pin, or action" }, 400);
    }

    // Authenticate caller
    const callers = await dbGet(
      `users?id=eq.${encodeURIComponent(caller_id)}&is_active=eq.true&select=id,pin_hash,role`,
    );
    const caller = callers[0];
    if (!caller) return json({ error: "User not found" }, 401);
    if (!(await verifyPin(pin, caller.pin_hash))) {
      return json({ error: "Invalid PIN" }, 401);
    }

    const isAdmin = caller.role === "owner" || caller.role === "manager";

    switch (action) {
      // ── Self-service actions ──────────────────────────────

      case "update_own_pin": {
        if (!payload?.new_pin || payload.new_pin.length !== 4) {
          return json({ error: "new_pin must be 4 digits" }, 400);
        }
        const newHash = await hashPinV2(payload.new_pin);
        await dbPatch(`users?id=eq.${encodeURIComponent(caller_id)}`, {
          pin_hash: newHash,
        });
        return json({ ok: true });
      }

      case "delete_own_account": {
        await cascadeDeleteUser(caller_id);
        return json({ ok: true });
      }

      // ── Admin actions ─────────────────────────────────────

      case "admin_add_user": {
        if (!isAdmin) return json({ error: "Admin role required" }, 403);
        if (!payload?.name || !payload?.phone || !payload?.pin) {
          return json({ error: "name, phone, and pin are required" }, 400);
        }
        const pinHash = await hashPinV2(payload.pin);
        const row = await dbPost("users", {
          name: payload.name,
          phone: payload.phone,
          pin_hash: pinHash,
          role: payload.role || "member",
          last_seen_at: 0,
          is_active: true,
        });
        return json({ ok: true, id: row.id });
      }

      case "admin_remove_user": {
        if (!isAdmin) return json({ error: "Admin role required" }, 403);
        if (!payload?.target_user_id) {
          return json({ error: "target_user_id is required" }, 400);
        }
        if (payload.target_user_id === caller_id) {
          return json(
            { error: "Use delete_own_account to delete yourself" },
            400,
          );
        }
        await cascadeDeleteUser(payload.target_user_id);
        return json({ ok: true });
      }

      case "admin_reset_pin": {
        if (!isAdmin) return json({ error: "Admin role required" }, 403);
        if (!payload?.target_user_id || !payload?.new_pin) {
          return json(
            { error: "target_user_id and new_pin are required" },
            400,
          );
        }
        const resetHash = await hashPinV2(payload.new_pin);
        await dbPatch(
          `users?id=eq.${encodeURIComponent(payload.target_user_id)}`,
          { pin_hash: resetHash },
        );
        return json({ ok: true });
      }

      case "admin_update_role": {
        if (!isAdmin) return json({ error: "Admin role required" }, 403);
        if (!payload?.target_user_id || !payload?.role) {
          return json({ error: "target_user_id and role are required" }, 400);
        }
        if (!["owner", "manager", "member"].includes(payload.role)) {
          return json({ error: "Invalid role" }, 400);
        }
        await dbPatch(
          `users?id=eq.${encodeURIComponent(payload.target_user_id)}`,
          { role: payload.role },
        );
        return json({ ok: true });
      }

      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
