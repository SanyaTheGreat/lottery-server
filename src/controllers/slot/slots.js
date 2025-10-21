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

    // idem
    if (idempotency_key) {
      const { data: existing } = await supabase
        .from("slot_spins")
        .select(
          "id, status, value, symbol_left, symbol_mid, symbol_right, effect_key, balance_before, balance_after, prize_type, prize_amount, inventory_id"
        )
        .eq("idempotency_key", idempotency_key)
        .maybeSingle();
      if (existing) {
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
          balance_before: existing.balance_before ?? undefined,
          balance_after: existing.balance_after ?? undefined,
        });
      }
    }

    // slot (+ stars_prize)
    const { data: slot, error: slotErr } = await supabase
      .from("slots")
      .select("id, active, price, gift_count, is_infinite, nft_name, stars_prize")
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
    const balance_before = Number(user.stars || 0);
    if (balance_before < price) {
      return res.status(402).json({ error: `Не хватает ⭐ (нужно ${price})` });
    }

    // списание
    {
      const { error: debErr } = await supabase
        .from("users")
        .update({ stars: balance_before - price })
        .eq("id", user.id);
      if (debErr) return res.status(500).json({ error: debErr.message });
    }

    // рефералка 5% от TON-эквивалента цены
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
            await supabase.from("referral_earnings").insert([{
              referrer_id: referrerId,
              referred_id: user.id,
              wheel_id: null,
              amount: refAmountTon
            }]);

            const { data: refUser } = await supabase
              .from("users")
              .select("referral_earnings")
              .eq("id", referrerId)
              .single();

            await supabase
              .from("users")
              .update({ referral_earnings: Number(refUser?.referral_earnings || 0) + refAmountTon })
              .eq("id", referrerId);
          }
        }
      }
    } catch { /* не критично для спина */ }

    // RNG 1..64
    const value = 1 + Math.floor(Math.random() * 64);

    // outcomes (общая) — prize_amount больше не используем
    const { data: outcome, error: outErr } = await supabase
      .from("slot_outcomes")
      .select(
        "value, symbol_left, symbol_mid, symbol_right, effect_key, prize_type"
      )
      .eq("value", value)
      .single();
    if (outErr || !outcome)
      return res.status(500).json({ error: "Не настроен slot_outcomes для value" });

    let status = "lose";
    let prize_type = outcome.prize_type || null;
    const computedPrize = prize_type === "stars" ? Number(slot.stars_prize || 0) : 0;

    let inventory_id = null;
    let balance_after = balance_before - price;

    if (prize_type === "stars" && computedPrize > 0) {
      const add = computedPrize;
      const { error: addErr } = await supabase
        .from("users")
        .update({ stars: balance_after + add })
        .eq("id", user.id);
      if (addErr) return res.status(500).json({ error: addErr.message });

      balance_after += add;
      status = "win_stars";

    } else if (prize_type === "gift") {
      const invId = uuidv4();
      const { data: inv, error: invErr } = await supabase
        .from("user_inventory")
        .insert([{
          id: invId,
          user_id: user.id,
          slot_id: slot.id,
          nft_name: slot.nft_name,
          status: "jackpot"
        }])
        .select("id")
        .single();
      if (invErr) return res.status(500).json({ error: invErr.message });
      inventory_id = inv.id;
      status = "win_gift";
    }

    // запись спина (сохраняем фактический prize_amount)
    const spin_id = uuidv4();
    const idem = idempotency_key || uuidv4();
    const { error: spinErr } = await supabase
      .from("slot_spins")
      .insert([{
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
        idempotency_key: idem
      }]);
    if (spinErr) return res.status(500).json({ error: spinErr.message });

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
      balance_before,
      balance_after,
    });
  } catch (e) {
    return res.status(500).json({ error: "spinSlot failed" });
  }
};

// GET /api/slots/active  (публично)
export const getActiveSlots = async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("slots")
      .select("id, name, price, gift_count, is_infinite, active, nft_name, stars_prize")
      .eq("active", true)
      .order("name", { ascending: true });
    if (error) return res.status(500).json({ error: error.message });

    const list = (data || []).map((s) => ({
      ...s,
      available: !!(s.is_infinite || Number(s.gift_count) > 0),
    }));
    return res.json(list);
  } catch {
    return res.status(500).json({ error: "getActiveSlots failed" });
  }
};

// GET /api/slots/outcomes  (публично)
export const getOutcomes = async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("slot_outcomes")
      .select(
        "value, symbol_left, symbol_mid, symbol_right, effect_key, prize_type"
      )
      .order("value", { ascending: true });
    if (error) return res.status(500).json({ error: error.message });

    const map = {};
    for (const o of data || []) {
      map[o.value] = {
        l: o.symbol_left,
        m: o.symbol_mid,
        r: o.symbol_right,
        effect_key: o.effect_key,
        prize: o.prize_type
          ? { type: o.prize_type }
          : { type: "none" },
      };
    }
    return res.json(map);
  } catch {
    return res.status(500).json({ error: "getOutcomes failed" });
  }
};

// GET /api/slots/history?limit=20   🔐 JWT
export const getSlotsHistory = async (req, res) => {
  try {
    const telegram_id = req.user?.telegram_id;
    if (!telegram_id) return res.status(401).json({ error: "Unauthorized" });

    const limit = Math.min(Number(req.query.limit || 20), 100);

    const { data: user } = await supabase
      .from("users")
      .select("id")
      .eq("telegram_id", telegram_id)
      .single();

    const { data, error } = await supabase
      .from("slot_spins")
      .select(
        "id, created_at, slot_id, status, value, symbol_left, symbol_mid, symbol_right, prize_type, prize_amount"
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) return res.status(500).json({ error: error.message });

    return res.json(
      (data || []).map((r) => ({
        id: r.id,
        created_at: r.created_at,
        slot_id: r.slot_id,
        status: r.status,
        value: r.value,
        symbols: { l: r.symbol_left, m: r.symbol_mid, r: r.symbol_right },
        prize: r.prize_type
          ? { type: r.prize_type, amount: r.prize_amount ?? undefined }
          : undefined,
      }))
    );
  } catch {
    return res.status(500).json({ error: "getSlotsHistory failed" });
  }
};

// GET /api/inventory   🔐 JWT
export const getInventory = async (req, res) => {
  try {
    const telegram_id = req.user?.telegram_id;
    if (!telegram_id) return res.status(401).json({ error: "Unauthorized" });

    const { data: user } = await supabase
      .from("users")
      .select("id")
      .eq("telegram_id", telegram_id)
      .single();

    const { data, error } = await supabase
      .from("user_inventory")
      .select("id, slot_id, nft_name, status, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  } catch {
    return res.status(500).json({ error: "getInventory failed" });
  }
};
