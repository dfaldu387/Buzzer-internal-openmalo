const FIREBASE_PROJECT_ID = Deno.env.get("FIREBASE_PROJECT_ID")!;
const FIREBASE_CLIENT_EMAIL = Deno.env.get("FIREBASE_CLIENT_EMAIL")!;
const FIREBASE_PRIVATE_KEY = Deno.env.get("FIREBASE_PRIVATE_KEY")!.replace(/\\n/g, "\n");

function base64url(data: Uint8Array | string): string {
  const str =
    typeof data === "string"
      ? btoa(data)
      : btoa(String.fromCharCode(...data));
  return str.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: FIREBASE_CLIENT_EMAIL,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  );

  const signInput = new TextEncoder().encode(`${header}.${claims}`);

  const pemBody = FIREBASE_PRIVATE_KEY.replace(
    /-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----/g,
    ""
  ).replace(/\s/g, "");

  const keyData = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, signInput)
  );

  const jwt = `${header}.${claims}.${base64url(signature)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  let tokenData: any;
  try {
    tokenData = await res.json();
  } catch (parseErr) {
    throw new Error(`OAuth2 response parse failed (HTTP ${res.status}): ${parseErr}`);
  }
  if (!tokenData.access_token) {
    throw new Error(`OAuth2 error: ${JSON.stringify(tokenData)}`);
  }
  return tokenData.access_token;
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
    const { fcm_token, data, platform } = await req.json();
    if (!fcm_token) {
      return new Response(JSON.stringify({ error: "Missing fcm_token" }), {
        status: 400,
      });
    }

    const accessToken = await getAccessToken();
    // If platform is unknown (null/undefined), send a universal message that
    // works on BOTH platforms: notification field (needed for iOS system
    // notification) + android high priority + apns with sound/content-available.
    // This prevents silent failures when the platform column is NULL.
    const isIOS = platform === "ios";
    const isUnknown = !platform;

    // Build alert text
    const alertTitle = data?.type === "buzz"
      ? `Buzz from ${data?.from_user_name || "User"}`
      : data?.type === "voice_message"
      ? `Voice message from ${data?.from_user_name || "User"}`
      : data?.type === "buzz_cancelled"
      ? "Buzz cancelled"
      : undefined;
    const alertBody = data?.type === "buzz"
      ? (data?.reason || "Incoming buzz")
      : data?.type === "voice_message"
      ? `${data?.duration || "0"}s voice message`
      : data?.type === "buzz_cancelled"
      ? `${data?.from_user_name || "User"} cancelled the buzz`
      : undefined;

    // Build platform-specific FCM message:
    // iOS: notification message (with `notification` field) so sound plays in killed state
    // Android: data-only message so background handler fires → BuzzerService alarm
    const message: Record<string, any> = {
      token: fcm_token,
      data: data || {},
    };

    if (isIOS || isUnknown) {
      // iOS: notification with sound so the buzzer alarm plays on arrival.
      message.apns = {
        headers: {
          "apns-priority": "10",
          "apns-push-type": data?.type === "buzz_cancelled" ? "background" : "alert",
          ...(data?.buzz_id ? { "apns-collapse-id": data.buzz_id } : {}),
        },
        payload: {
          aps: {
            ...(alertTitle ? { alert: { title: alertTitle, body: alertBody } } : {}),
            ...(data?.type === "buzz" ? {
              sound: `${data?.sound_id || "buzz_alarm"}.wav`,
              "interruption-level": "time-sensitive",
              "category": "buzz_actions",
            } : data?.type === "voice_message" ? {
              sound: "default",
            } : {}),
            ...(data?.type === "buzz_cancelled" ? { "content-available": 1 } : {}),
          },
        },
      };
      if (isUnknown) {
        message.android = { priority: "high" };
      }
    } else {
      // Data-only message for Android — background handler fires in all states.
      message.android = { priority: "high" };
      message.apns = {
        headers: {
          "apns-priority": "10",
          "apns-push-type": "alert",
          ...(data?.buzz_id ? { "apns-collapse-id": data.buzz_id } : {}),
        },
        payload: {
          aps: {
            ...(data?.type === "buzz_cancelled" ? { "content-available": 1 } : {}),
            sound: data?.type === "buzz"
              ? `${data?.sound_id || "buzz_alarm"}.wav`
              : data?.type === "voice_message" ? "default" : undefined,
            alert: { title: alertTitle, body: alertBody },
            ...(data?.type === "buzz" ? { "interruption-level": "time-sensitive", "category": "buzz_actions" } : {}),
          },
        },
      };
    }

    const fcmRes = await fetch(
      `https://fcm.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/messages:send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message }),
      }
    );

    const result = await fcmRes.json();

    // Detect stale/expired FCM tokens from FCM v1 error format and return
    // a structured error the client can easily match.
    if (!fcmRes.ok) {
      const fcmErrorCode = result?.error?.details?.find(
        (d: any) => d["@type"] === "type.googleapis.com/google.firebase.fcm.v1.FcmError"
      )?.errorCode;
      if (fcmErrorCode === "UNREGISTERED" || fcmErrorCode === "INVALID_ARGUMENT") {
        return new Response(JSON.stringify({
          error: {
            code: fcmErrorCode === "UNREGISTERED"
              ? "messaging/registration-token-not-registered"
              : "messaging/invalid-registration-token",
          },
        }), {
          status: 410,  // Gone — token is no longer valid
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    return new Response(JSON.stringify(result), {
      status: fcmRes.ok ? 200 : 500,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
});
