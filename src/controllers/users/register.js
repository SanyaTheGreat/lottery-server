import { supabase } from '../../services/supabaseClient.js';
import { beginCell } from '@ton/ton';

// base64 -> base64url (без паддинга)
function toBase64Url(base64) {
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// TON payload из telegram_id
function makeTonPayloadFromTgId(telegram_id) {
  const cell = beginCell().storeUint(0, 32).storeStringTail(String(telegram_id)).endCell();
  return toBase64Url(cell.toBoc().toString('base64'));
}

/**
 * Безопасный апсерт пользователя.
 * Требует JWT-мидлвару (req.user).
 * Опционально поддерживает реферала через ?ref=<telegram_id> (только при первом создании).
 */
const addUser = async (req, res) => {
  try {
    const tgId = req.user?.telegram_id;
    const usernameFromToken = req.user?.username || '';
    const avatarUrlFromToken = req.user?.photo_url || null;

    if (!tgId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Ищем пользователя
    const { data: existingUser, error: checkError } = await supabase
      .from('users')
      .select('id, username, avatar_url, referred_by, payload')
      .eq('telegram_id', tgId)
      .maybeSingle();

    if (checkError) {
      console.error('❌ Database check failed:', checkError.message);
      return res.status(500).json({ error: 'Database check failed' });
    }

    // === Если пользователь уже есть ===
    if (existingUser) {
      const patch = {};

      // если username/avatar изменились
      if (usernameFromToken && usernameFromToken !== existingUser.username)
        patch.username = usernameFromToken;
      if (avatarUrlFromToken && avatarUrlFromToken !== existingUser.avatar_url)
        patch.avatar_url = avatarUrlFromToken;

      // 🧩 если payload отсутствует — сгенерировать
      if (!existingUser.payload) {
        patch.payload = makeTonPayloadFromTgId(tgId);
      }

      if (Object.keys(patch).length) {
        const { data: updated, error: updateError } = await supabase
          .from('users')
          .update(patch)
          .eq('telegram_id', tgId)
          .select()
          .single();

        if (updateError) {
          console.error('❌ Update user failed:', updateError.message);
          return res.status(500).json({ error: 'Update failed' });
        }

        return res.status(200).json({
          message: 'User already existed — profile updated',
          user: updated,
        });
      }

      // ничего не изменилось
      return res.status(200).json({
        message: 'User already existed — no changes',
        user: existingUser,
      });
    }

    // === Новый пользователь ===
    const payload = makeTonPayloadFromTgId(tgId);

    // Реферал — однократно
    let referred_by = null;
    const ref = req.query?.ref ?? req.query?.referrer;
    if (ref && String(ref) !== String(tgId)) {
      const { data: referrer } = await supabase
        .from('users')
        .select('id')
        .eq('telegram_id', ref)
        .maybeSingle();
      if (referrer) referred_by = referrer.id;
    }

    const newUserData = {
      telegram_id: tgId,
      username: usernameFromToken || '',
      wallet: null,
      tickets: 0,
      payload,
      avatar_url: avatarUrlFromToken || null,
      ...(referred_by && { referred_by }),
    };

    const { data, error } = await supabase
      .from('users')
      .insert([newUserData])
      .select()
      .single();

    if (error) {
      console.error('❌ Insert user failed:', error.message);
      return res.status(500).json({ error: 'Insert failed' });
    }

    return res.status(201).json({
      message: 'User registered successfully',
      user: data,
    });
  } catch (err) {
    console.error('❌ addUser unexpected error:', err?.message || err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

export default addUser;
