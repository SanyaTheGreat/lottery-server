import crypto from "crypto";

export function verifyTelegramWebApp(initData, botToken, maxAgeSec = 86400) {
  if (!initData || !botToken) return { ok: false, reason: "Missing initData or botToken" };

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  const authDate = params.get("auth_date");
  const userStr = params.get("user");
  if (!hash || !authDate || !userStr) return { ok: false, reason: "Missing required fields" };

  const now = Math.floor(Date.now() / 1000);
  if (now - Number(authDate) > maxAgeSec) return { ok: false, reason: "initData expired" };

  params.delete("hash");
  const dataCheckString = Array.from(params.entries())
    .sort(([a,],[b,]) => a.localeCompare(b))
    .map(([k,v]) => `${k}=${v}`)
    .join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const calculatedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  if (calculatedHash !== hash) return { ok: false, reason: "Bad signature" };

  try {
    const user = JSON.parse(userStr);
    if (!user?.id) return { ok: false, reason: "Bad user payload" };
    return { ok: true, user };
  } catch {
    return { ok: false, reason: "User JSON parse error" };
  }
}
