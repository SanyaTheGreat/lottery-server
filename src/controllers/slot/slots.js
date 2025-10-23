// src/controllers/slot/slots.js
import { supabase } from "../../services/supabaseClient.js";
import { v4 as uuidv4 } from "uuid";

// POST /api/slots/spin   🔐 JWT
// body: { slot_id: uuid, idempotency_key?: uuid }
export const spinSlot = async (req, res) => {
  try {
    const telegram_id = req.user?.telegram_id;
    if (!telegram_id) return res.status(401).json({ error: "Unauthorized" });

    const { slot_id, idempotency_key } = req.body || {};
    if (!slot_id) return res.status(400).json({ error: "slot_id обязателен" });

    // idem check
    if (idempotency_key) {
      const { data: existing } = await supabase
        .from("slot_spins")
        .select("id, status, value, symbol_left, symbol_mid, symbol_right, effect_key, prize_type, prize_amount, inventory_id")
        .eq("idempotency_key", idempotency_key)
        .maybeSingle();
      if (existing) {
        return res.json({
          spin_id: existing.id,
          status: existing.status,
          value: existing.value,
          symbols: { l: existing.symbol_left, m: existing.symbol_mid, r: existing.symbol_right },
          effect_key: existing.effect_key,
          prize: existing.prize_type
            ? { type: existing.prize_type, amount: existing.prize_amount ?? undefined }
            : undefined,
          inventory_id: existing.inventory_id ?? undefined,
        });
      }
    }

    // slot info
    const { data: slot, error: slotErr } = await supabase
      .from("slots")
      .select("id, active, price, gift_count, is_infinite, nft_name, stars_prize, ref_earn")
      .eq("id", slot_id)
      .single();
    if (slotErr || !slot) return res.status(404).json({ error: "Слот не найден" });
    if (!slot.active) return res.status(404).json({ error: "Слот не активен" });
    const available = !!(slot.is_infinite || Number(slot.gift_count) > 0);
    if (!available) return res.status(409).json({ error: "Слот недоступен (нет подарков)" });

    // user
    const { data: user, error: uErr } = await supabase
      .from("users")
      .select("id, stars, telegram_id, referred_by")
      .eq("telegram_id", telegram_id)
      .single();
    if (uErr || !user) return res.status(404).json({ error: "Пользователь не найден" });

    const price = Number(slot.price || 0);
    const balance = Number(user.stars || 0);
    if (balance < price) {
      return res.status(402).json({ error: `Не хватает ⭐ (нужно ${price})` });
    }

    // списание
    await supabase
      .from("users")
      .update({ stars: balance - price })
      .eq("id", user.id);

    // RNG
    const value = 1 + Math.floor(Math.random() * 64);
    const { data: outcome, error: outErr } = await supabase
      .from("slot_outcomes")
      .select("value, symbol_left, symbol_mid, symbol_right, effect_key, prize_type")
      .eq("value", value)
      .single();
    if (outErr || !outcome)
      return res.status(500).json({ error: "Не настроен slot_outcomes для value" });

    let status = "lose";
    let prize_type = outcome.prize_type || null;
    let computedPrize = 0;
    let inventory_id = null;

    if (prize_type === "stars" && Number(slot.stars_prize) > 0) {
      computedPrize = Number(slot.stars_prize);
      await supabase
        .from("users")
        .update({ stars: balance - price + computedPrize })
        .eq("id", user.id);
      status = "win_stars";

    } else if (prize_type === "gift") {
      const invId = uuidv4();
      const { data: inv } = await supabase
        .from("user_inventory")
        .insert([{
          id: invId,
          user_id: user.id,
          slot_id: slot.id,
          nft_name: slot.nft_name,
          status: "jackpot",
        }])
        .select("id")
        .single();
      inventory_id = inv?.id ?? null;
      status = "win_gift";
    }

    // запись спина
    const spin_id = uuidv4();
    const idem = idempotency_key || uuidv4();
    await supabase.from("slot_spins").insert([{
      id: spin_id,
      slot_id: slot.id,
      user_id: user.id,
      status,
      value,
      symbol_left: outcome.symbol_left,
      symbol_mid: outcome.symbol_mid,
      symbol_right: outcome.symbol_right,
      effect_key: outcome.effect_key,
      pay_currency: "stars",
      prize_type,
      prize_amount: computedPrize,
      inventory_id,
      idempotency_key: idem,
    }]);

    // ответ пользователю сразу
    res.json({
      spin_id,
      status,
      value,
      symbols: { l: outcome.symbol_left, m: outcome.symbol_mid, r: outcome.symbol_right },
      effect_key: outcome.effect_key,
      prize:
        prize_type === "stars"
          ? { type: "stars", amount: computedPrize }
          : prize_type === "gift"
          ? { type: "gift" }
          : undefined,
      inventory_id: inventory_id ?? undefined,
    });

    // рефералка — в фоне
    if (user.referred_by && Number(slot.ref_earn) > 0) {
      setImmediate(async () => {
        try {
          await supabase.from("referral_earnings").insert([{
            referrer_id: user.referred_by,
            referred_id: user.id,
            wheel_id: null,
            amount: Number(slot.ref_earn),
          }]);
          await supabase.rpc("increment_referral_earnings", {
            user_id_input: user.referred_by,
            add_amount: Number(slot.ref_earn),
          });
        } catch (e) {
          console.warn("[referral_skip]", e.message);
        }
      });
    }
  } catch (e) {
    console.error("spinSlot failed:", e);
    return res.status(500).json({ error: "spinSlot failed" });
  }
};
