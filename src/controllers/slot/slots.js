import { supabase } from "../../services/supabaseClient.js";
import { v4 as uuidv4 } from "uuid";

// POST /api/slots/spin   🔐 JWT
// body: { slot_id: uuid, idempotency_key?: uuid }
export const spinSlot = async (req, res) => {
  console.log("=== spinSlot start ===");
  console.time("spinSlot-total");

  try {
    const telegram_id = req.user?.telegram_id;
    if (!telegram_id) return res.status(401).json({ error: "Unauthorized" });

    const { slot_id, idempotency_key } = req.body || {};
    if (!slot_id) return res.status(400).json({ error: "slot_id обязателен" });

    // idem check
    console.time("check-idempotency");
    if (idempotency_key) {
      const { data: existing } = await supabase
        .from("slot_spins")
        .select(
          "id, status, value, symbol_left, symbol_mid, symbol_right, effect_key, prize_type, prize_amount, inventory_id"
        )
        .eq("idempotency_key", idempotency_key)
        .maybeSingle();
      console.timeEnd("check-idempotency");

      if (existing) {
        console.log("✅ найден idempotency_key — возврат результата");
        console.timeEnd("spinSlot-total");
        return res.json({
          spin_id: existing.id,
          status: existing.status,
          value: existing.value,
          symbols: {
            l: existing.symbol_left,
            m: existing.symbol_mid,
            r: existing.symbol_right,
          },
          effect_key: existing.effect_key,
          prize: existing.prize_type
            ? { type: existing.prize_type, amount: existing.prize_amount ?? undefined }
            : undefined,
          inventory_id: existing.inventory_id ?? undefined,
        });
      }
    } else {
      console.timeEnd("check-idempotency");
    }

    // slot info
    console.time("get-slot");
    const { data: slot, error: slotErr } = await supabase
      .from("slots")
      .select(
        "id, active, price, gift_count, is_infinite, nft_name, stars_prize, ref_earn"
      )
      .eq("id", slot_id)
      .single();
    console.timeEnd("get-slot");

    if (slotErr || !slot)
      return res.status(404).json({ error: "Слот не найден" });
    if (!slot.active)
      return res.status(404).json({ error: "Слот не активен" });
    if (!slot.is_infinite && Number(slot.gift_count) <= 0)
      return res.status(409).json({ error: "Слот недоступен (нет подарков)" });

    // user
    console.time("get-user");
    const { data: user, error: userErr } = await supabase
      .from("users")
      .select("id, stars, telegram_id, referred_by")
      .eq("telegram_id", telegram_id)
      .single();
    console.timeEnd("get-user");

    if (userErr || !user)
      return res.status(404).json({ error: "Пользователь не найден" });

    // списание
    const price = Number(slot.price || 0);
    if ((user.stars || 0) < price)
      return res.status(402).json({ error: `Не хватает ⭐ (нужно ${price})` });

    console.time("debit-user-stars");
    const { error: debitErr } = await supabase
      .from("users")
      .update({ stars: Number(user.stars) - price })
      .eq("id", user.id);
    console.timeEnd("debit-user-stars");

    if (debitErr)
      return res.status(500).json({ error: debitErr.message });

    // рефералка (только запись)
    console.time("insert-referral");
    try {
      const referrerId = user.referred_by;
      const refAmountTon = Number(slot.ref_earn || 0);
      if (referrerId && refAmountTon > 0) {
        await supabase.from("referral_earnings").insert([
          {
            referrer_id: referrerId,
            referred_id: user.id,
            wheel_id: null,
            amount: refAmountTon,
          },
        ]);
      }
    } catch (err) {
      console.log("⚠️ Ошибка записи referral_earnings:", err.message);
    }
    console.timeEnd("insert-referral");

    // RNG
    const value = 1 + Math.floor(Math.random() * 64);

    console.time("get-outcome");
    const { data: outcome, error: outErr } = await supabase
      .from("slot_outcomes")
      .select(
        "value, symbol_left, symbol_mid, symbol_right, effect_key, prize_type"
      )
      .eq("value", value)
      .single();
    console.timeEnd("get-outcome");

    if (outErr || !outcome)
      return res.status(500).json({ error: "Не настроен slot_outcomes для value" });

    // результат
    let status = "lose";
    let prize_type = outcome.prize_type || null;
    const computedPrize =
      prize_type === "stars" ? Number(slot.stars_prize || 0) : 0;

    let inventory_id = null;

    console.time("handle-prize");
    if (prize_type === "stars" && computedPrize > 0) {
      const { error: addErr } = await supabase
        .from("users")
        .update({ stars: Number(user.stars) - price + computedPrize })
        .eq("id", user.id);
      if (addErr) {
        console.timeEnd("handle-prize");
        return res.status(500).json({ error: addErr.message });
      }
      status = "win_stars";
    } else if (prize_type === "gift") {
      const invId = uuidv4();
      const { data: inv, error: invErr } = await supabase
        .from("user_inventory")
        .insert([
          {
            id: invId,
            user_id: user.id,
            slot_id: slot.id,
            nft_name: slot.nft_name,
            status: "jackpot",
          },
        ])
        .select("id")
        .single();
      if (invErr) {
        console.timeEnd("handle-prize");
        return res.status(500).json({ error: invErr.message });
      }
      inventory_id = inv.id;
      status = "win_gift";
    }
    console.timeEnd("handle-prize");

    // запись спина
    console.time("insert-spin");
    const spin_id = uuidv4();
    const idem = idempotency_key || uuidv4();
    const { error: spinErr } = await supabase.from("slot_spins").insert([
      {
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
      },
    ]);
    console.timeEnd("insert-spin");

    if (spinErr)
      return res.status(500).json({ error: spinErr.message });

    console.timeEnd("spinSlot-total");
    console.log("=== spinSlot finished ===");

    return res.json({
      spin_id,
      status,
      value,
      symbols: {
        l: outcome.symbol_left,
        m: outcome.symbol_mid,
        r: outcome.symbol_right,
      },
      effect_key: outcome.effect_key,
      prize:
        prize_type === "stars"
          ? { type: "stars", amount: computedPrize }
          : prize_type === "gift"
          ? { type: "gift" }
          : undefined,
      inventory_id: inventory_id ?? undefined,
    });
  } catch (err) {
    console.error("spinSlot failed:", err);
    console.timeEnd("spinSlot-total");
    return res.status(500).json({ error: "spinSlot failed" });
  }
};
