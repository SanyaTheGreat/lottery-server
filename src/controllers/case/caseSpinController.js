import { supabase } from "../../services/supabaseClient.js";
import { v4 as uuidv4 } from "uuid";

// 🎰 Запустить спин
export const spinCase = async (req, res) => {
  try {
    const { case_id, telegram_id } = req.body;
    if (!case_id || !telegram_id) {
      return res.status(400).json({ error: "case_id и telegram_id обязательны" });
    }

    // 1) кейс активен?
    const { data: caseData, error: caseError } = await supabase
      .from("cases")
      .select("*")
      .eq("id", case_id)
      .eq("status", "active")
      .single();
    if (caseError || !caseData) return res.status(404).json({ error: "Кейс не найден или не активен" });

    // 2) пользователь существует?
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("*")
      .eq("telegram_id", telegram_id)
      .single();
    if (userError || !user) return res.status(404).json({ error: "Пользователь не найден" });

    // 3) хватает звёзд?
    if (user.stars < caseData.price) {
      return res.status(402).json({ error: `Недостаточно средств (нужно ${caseData.price} звёзд)` });
    }

    // 4) списываем оплату
    await supabase.from("users").update({ stars: user.stars - caseData.price }).eq("telegram_id", telegram_id);

    // 5) берём активные предметы кейса
    const { data: items, error: itemsError } = await supabase
      .from("case_items")
      .select("*")
      .eq("case_id", case_id)
      .eq("active", true);
    if (itemsError || !items?.length) return res.status(400).json({ error: "В кейсе нет предметов" });

    // 6) RNG
    const weightsSum = items.reduce((s, i) => s + Number(i.weight), 0);
    const rng = Math.random() * weightsSum;
    let selectedItem = null, cumulative = 0;
    for (const it of items) {
      cumulative += Number(it.weight);
      if (rng <= cumulative) { selectedItem = it; break; }
    }

    // 7) лог спина
    const spinId = uuidv4();
    const status = selectedItem ? "won" : "lose";
    const { data: spin, error: spinError } = await supabase
      .from("case_spins")
      .insert([{
        id: spinId,
        case_id,
        user_id: user.id,
        item_id: selectedItem?.id || null,
        status,
        rng_roll: rng,
        weights_sum: weightsSum,
        prize_slug: selectedItem?.slug || null,
        price: caseData.price,
        // started_at есть default now() — можно не передавать, но оставить не мешает:
        started_at: new Date().toISOString()
      }])
      .select()
      .single();
    if (spinError) return res.status(500).json({ error: spinError.message });

    // 8) ответ
    return res.json({
      spin_id: spin.id,
      status,
      rng_roll: rng,
      prize: selectedItem ? {
        item_id: selectedItem.id,
        type: selectedItem.type,
        tier: selectedItem.tier,
        slug: selectedItem.slug
      } : null
    });

  } catch (err) {
    console.error("❌ spinCase:", err);
    return res.status(500).json({ error: "Ошибка при спине кейса" });
  }
};

// 🏆 Получить приз (claim)
export const claimPrize = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: spin, error: spinError } = await supabase
      .from("case_spins")
      .select("*, case_items(*)")
      .eq("id", id)
      .single();
    if (spinError || !spin) return res.status(404).json({ error: "Спин не найден" });
    if (spin.status !== "won") return res.status(409).json({ error: "Нельзя получить приз — статус не won" });

    const item = spin.case_items;

    if (item.type === "gift") {
      // 1) берём любой доступный gift по slug
      const { data: gift, error: giftErr } = await supabase
        .from("case_gifts")
        .select("*")
        .eq("used", false)
        .eq("slug", item.slug)
        .limit(1)
        .single();
      if (giftErr || !gift) return res.status(409).json({ error: "Нет доступных подарков" });

      // 2) помечаем gift как использованный
      const { error: updErr } = await supabase
        .from("case_gifts")
        .update({ used: true })
        .eq("pending_id", gift.pending_id);
      if (updErr) return res.status(500).json({ error: updErr.message });

      // 3) кладём в очередь на отправку
      const { error: prErr } = await supabase.from("pending_rewards").insert([{
        source: "case",
        spin_id: spin.id,
        winner_id: spin.user_id,
        telegram_id: null,  // если есть — подставь
        username: null,     // если есть — подставь
        nft_name: gift.nft_name,
        nft_number: gift.nft_number,
        slug: gift.slug,
        msg_id: gift.msg_id,
        status: "pending",
        created_at: new Date().toISOString()
      }]);
      if (prErr) return res.status(500).json({ error: prErr.message });

    } else if (item.type === "stars") {
      // сразу начисляем звёзды (если есть своя процедура — замени)
      const amount = item.payout_value || 10;
      const { data: u } = await supabase.from("users").select("stars").eq("id", spin.user_id).single();
      if (u) await supabase.from("users").update({ stars: (u.stars || 0) + amount }).eq("id", spin.user_id);
    }

    // 4) статус спина
    await supabase.from("case_spins").update({ status: "reward_sent" }).eq("id", spin.id);

    return res.json({ status: "ok", prize: { type: item.type, slug: item.slug, tier: item.tier } });

  } catch (err) {
    console.error("❌ claimPrize:", err);
    return res.status(500).json({ error: "Ошибка при получении приза" });
  }
};

// 🔄 Продать приз (reroll)
export const rerollPrize = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: spin, error: spinError } = await supabase
      .from("case_spins")
      .select("*, case_items(*)")
      .eq("id", id)
      .single();
    if (spinError || !spin) return res.status(404).json({ error: "Спин не найден" });
    if (spin.status !== "won") return res.status(409).json({ error: "Нельзя продать — статус не won" });

    const item = spin.case_items;
    const rerollAmount = item.payout_value || 5;

    // начисляем пользователю (если есть RPC — замени)
    const { data: u } = await supabase.from("users").select("stars").eq("id", spin.user_id).single();
    if (u) await supabase.from("users").update({ stars: (u.stars || 0) + rerollAmount }).eq("id", spin.user_id);

    await supabase
      .from("case_spins")
      .update({ status: "reroll", reroll_amount: rerollAmount })
      .eq("id", spin.id);

    return res.json({ status: "reroll", reroll_amount: rerollAmount });

  } catch (err) {
    console.error("❌ rerollPrize:", err);
    return res.status(500).json({ error: "Ошибка при продаже приза" });
  }
};
