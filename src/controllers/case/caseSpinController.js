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

    if (user.stars < 23) { // 💰 фиксированная цена кейса
      return res.status(402).json({ error: "Недостаточно средств (нужно 23 звезды)" });
    }

    // 3. Списываем оплату
    await supabase
      .from("users")
      .update({ stars: user.stars - 23 })
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
        price: 23,
        started_at: new Date().toISOString()
      }])
      .select()
      .single();

    if (spinError) throw spinError;

    // 7. Отдаём результат
    return res.json({
      spin_id: spin.id,
      status,
      rng_roll: rng,
      prize: selectedItem ? {
        item_id: selectedItem.id,
        type: selectedItem.type,
        title: selectedItem.title,
        tier: selectedItem.tier,
        slug: selectedItem.slug
      } : null
    });

  } catch (err) {
    console.error("❌ Ошибка spinCase:", err);
    return res.status(500).json({ error: "Ошибка при спине кейса" });
  }
};
