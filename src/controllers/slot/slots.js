import { supabase } from "../../services/supabaseClient.js";
import { v4 as uuidv4 } from "uuid";

export const spinSlot = async (req, res) => {
  const start = Date.now();
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
        console.log(`[slot] idem hit ${existing.id}`);
        return res.json({
          spin_id: existing.id,
          status: existing.status,
          symbols: {
            l: existing.symbol_left,
            m: existing.symbol_mid,
            r: existing.symbol_right,
          },
          prize: existing.prize_type
            ? { type: existing.prize_type, amount: existing.prize_amount ?? undefined }
            : undefined,
          inventory_id: existing.inventory_id ?? undefined,
        });
      }
    }

    // slot
    const { data: slot, error: slotErr } = await supabase
      .from("slots")
      .select("id, active, price, gift_count, is_infinite, nft_name, stars_prize")
      .eq("id", slot_id)
      .single();
    if (slotErr || !slot) return res.status(404).json({ error: "Слот не найден" });
    if (!slot.active) return res.status(409).json({ error: "Слот не активен" });

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
    const balance_before = Number(user.stars || 0);
    if (balance_before < price) {
      return res.status(402).json({ error: `Не хватает ⭐ (нужно ${price})` });
    }

    // списание
    await supabase.from("users").update({ stars: balance_before - price }).eq("id", user.id);

    // RNG
    const value = 1 + Math.floor(Math.random() * 64);

    const { data: outcome } = await supabase
      .from("slot_outcomes")
      .select("symbol_left, symbol_mid, symbol_right, effect_key, prize_type")
      .eq("value", value)
      .maybeSingle();
    if (!outcome) return res.status(500).json({ error: "Нет slot_outcomes для value" });

    let status = "lose";
    let prize_type = outcome.prize_type || null;
    let computedPrize = 0;
    let balance_after = balance_before - price;
    let inventory_id = null;

    if (prize_type === "stars" && Number(slot.stars_prize) > 0) {
      computedPrize = Number(slot.stars_prize);
      balance_after += computedPrize;
      await supabase
        .from("users")
        .update({ stars: balance_after })
        .eq("id", user.id);
      status = "win_stars";
    } else if (prize_type === "gift") {
      const invId = uuidv4();
      await supabase
        .from("user_inventory")
        .insert([
          {
            id: invId,
            user_id: user.id,
            slot_id: slot.id,
            nft_name: slot.nft_name,
            status: "jackpot",
          },
        ]);
      inventory_id = invId;
      status = "win_gift";
    }

    // запись спина
    const spin_id = uuidv4();
    const idem = idempotency_key || uuidv4();
    await supabase.from("slot_spins").insert([
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
        balance_before,
        balance_after,
        pay_currency: "stars",
        prize_type,
        prize_amount: computedPrize,
        inventory_id,
        idempotency_key: idem,
      },
    ]);

    // 👉 мгновенный ответ пользователю
    res.json({
      spin_id,
      status,
      symbols: {
        l: outcome.symbol_left,
        m: outcome.symbol_mid,
        r: outcome.symbol_right,
      },
      prize:
        prize_type === "stars"
          ? { type: "stars", amount: computedPrize }
          : prize_type === "gift"
          ? { type: "gift" }
          : undefined,
      balance_before,
      balance_after,
    });

    // фоновая рефералка (не блокирует ответ)
    setImmediate(async () => {
      try {
        const referrerId = user.referred_by || null;
        if (referrerId) {
          const { data: rateRow } = await supabase
            .from("fx_rates")
            .select("stars_per_ton")
            .eq("id", 1)
            .single();
          const spt = Number(rateRow?.stars_per_ton || 0);
          if (spt > 0) {
            const priceTon = price / spt;
            const refAmountTon = +(priceTon * 0.05).toFixed(9);
            if (refAmountTon > 0) {
              await supabase.from("referral_earnings").insert([
                {
                  referrer_id: referrerId,
                  referred_id: user.id,
                  wheel_id: null,
                  amount: refAmountTon,
                },
              ]);
              const { data: refUser } = await supabase
                .from("users")
                .select("referral_earnings")
                .eq("id", referrerId)
                .single();
              await supabase
                .from("users")
                .update({
                  referral_earnings:
                    Number(refUser?.referral_earnings || 0) + refAmountTon,
                })
                .eq("id", referrerId);
            }
          }
        }
      } catch (e) {
        console.warn("[slot-referral] background skipped:", e?.message);
      } finally {
        console.log(`[slot] background done in ${Date.now() - start}ms`);
      }
    });
  } catch (e) {
    console.error("[slot-spin] failed:", e);
    return res.status(500).json({ error: "spinSlot failed" });
  }
};
