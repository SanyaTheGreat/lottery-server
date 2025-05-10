import { supabase } from '../services/supabaseClient.js';
import { drawWinner } from '../controllers/wheel/drawWinner.js';

// Проверка и запуск розыгрышей
const checkAndRunDraws = async () => {
  try {
    const now = new Date().toISOString();

    const { data: wheels, error } = await supabase
      .from('wheels')
      .select('id')
      .eq('status', 'active')
      .lte('run_at', now);

    if (error) {
      console.error('❌ Ошибка при получении колёс:', error);
      return;
    }

    if (!wheels || wheels.length === 0) {
      console.log('⏳ Нет колёс, готовых к запуску...');
      return;
    }

    for (const wheel of wheels) {
      console.log(`🎯 Запускаем розыгрыш для колеса: ${wheel.id}`);

      // Мокаем Express-подобные объекты req/res
      const mockReq = { params: { wheel_id: wheel.id } };
      const mockRes = {
        status: (code) => ({
          json: (data) => console.log(`🔁 Ответ drawWinner (${code}):`, data)
        })
      };

      try {
        await drawWinner(mockReq, mockRes);
      } catch (err) {
        console.error(`🚫 Ошибка при запуске drawWinner для колеса ${wheel.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('🔥 Общая ошибка авто-розыгрыша:', err.message);
  }
};

// Запускаем проверку каждые 10 секунд
setInterval(checkAndRunDraws, 10_000);

console.log('🔁 Авто-розыгрыш запущен...');
