import { supabase } from "../../services/supabaseClient.js";
import { v4 as uuidv4 } from "uuid";

// 🎰 Запустить спин
export const spinCase = async (req, res) => {
  try {
    const { case_id, telegram_id } = req.body;

    if (!case_id || !telegram_id) {
      return res.status(400).json({ error: "case_id и telegram_id обязательны" });
    }

    // 1. Проверяем кейс
    const { data: caseData, error: caseError } = await supabase
      .from("cases")
      .select("*")
      .eq("id", case_id)
      .eq("status", "active")
      .single();

    if (caseError || !caseData) {
      return res.status(404).json({ error: "Кейс не найден или не активен" });
    }

    // 2. Проверяем пользователя
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("*")
      .eq("telegram_id", telegram_id)
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    if (user.stars < caseData.price) {
      return res.status(402).json({ error: `Недостаточно средств (нужно ${caseData.price} звёзд)` });
    }

    // 3. Списываем оплату
    await supabase
      .from("users")
      .update({ stars: user.stars - caseData.price })
      .eq("telegram_id", telegram_id);

    // 4. Получаем предметы кейса
    const { data: items, error: itemsError } = await supabase
      .from("case_items")
      .select("*")
      .eq("case_id", case_id)
      .eq("active", true);

    if (itemsError || !items?.length) {
      return res.status(400).json({ error: "В кейсе нет предметов" });
    }

    // 5. RNG выбор предмета
    const weightsSum = items.reduce((sum, i) => sum + Number(i.weight), 0);
    const rng = Math.random() * weightsSum;

    let selectedItem = null;
    let cumulative = 0;
    for (const item of items) {
      cumulative += Number(item.weight);
      if (rng <= cumulative) {
        selectedItem = item;
        break;
      }
    }

    // 6. Записываем спин
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
        started_at: new Date().toISOString()
      }])
      .select()
      .single();

    if (spinError) throw spinError;

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
    console.error("❌ Ошибка spinCase:", err);
    return res.status(500).json({ error: "Ошибка при спине кейса" });
  }
};

// 🏆 Получить приз
export const claimPrize = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: spin, error: spinError } = await supabase
      .from("case_spins")
      .select("*, case_items(*)")
      .eq("id", id)
      .single();

    if (spinError || !spin) {
      return res.status(404).json({ error: "Спин не найден" });
    }

    if (spin.status !== "won") {
      return res.status(409).json({ error: "Нельзя получить приз — статус не won" });
    }

    const item = spin.case_items;

    if (item.type === "gift") {
      // ищем доступный подарок
      const { data: gift } = await supabase
        .from("case_gifts")
        .select("*")
        .eq("used", false)
        .eq("slug", item.slug)
        .limit(1)
        .single();

      if (!gift) {
        return res.status(409).json({ error: "Нет доступных подарков" });
      }

      // помечаем подарок как использованный
      await supabase.from("case_gifts").update({ used: true }).eq("pending_id", gift.pending_id);

      // создаём запись в pending_rewards
      await supabase.from("pending_rewards").insert([{
        source: "case",
        spin_id: spin.id,
        winner_id: spin.user_id,
        telegram_id: null, // можно заполнить если есть
        username: null, // можно заполнить если есть
        nft_name: gift.nft_name,
        nft_number: gift.nft_number,
        slug: gift.slug,
        msg_id: gift.msg_id,
        status: "pending",
        created_at: new Date().toISOString()
      }]);

    } else if (item.type === "stars") {
      // начисляем звёзды
      await supabase.rpc("increment_user_stars", { p_user_id: spin.user_id, p_amount: item.payout_value || 10 });
    }

    // обновляем статус спина
    await supabase.from("case_spins").update({ status: "reward_sent" }).eq("id", spin.id);

    return res.json({ status: "ok", prize: item });

  } catch (err) {
    console.error("❌ Ошибка claimPrize:", err);
    return res.status(500).json({ error: "Ошибка при получении приза" });
  }
};

// 🔄 Продать приз
export const rerollPrize = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: spin, error: spinError } = await supabase
      .from("case_spins")
      .select("*, case_items(*)")
      .eq("id", id)
      .single();

    if (spinError || !spin) {
      return res.status(404).json({ error: "Спин не найден" });
    }

    if (spin.status !== "won") {
      return res.status(409).json({ error: "Нельзя продать — статус не won" });
    }

    const item = spin.case_items;

    // начисляем пользователю reroll_amount
    const rerollAmount = item.payout_value || 5;

    await supabase.rpc("increment_user_stars", { p_user_id: spin.user_id, p_amount: rerollAmount });

    await supabase
      .from("case_spins")
      .update({ status: "reroll", reroll_amount: rerollAmount })
      .eq("id", spin.id);

    return res.json({ status: "reroll", reroll_amount: rerollAmount });

  } catch (err) {
    console.error("❌ Ошибка rerollPrize:", err);
    return res.status(500).json({ error: "Ошибка при продаже приза" });
  }
};
