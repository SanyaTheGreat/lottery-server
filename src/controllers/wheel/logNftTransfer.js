import { supabase } from '../../services/supabaseClient.js';

export const logNftTransfer = async (req, res) => {
  const {
    wheel_id,
    winner_id,
    telegram_id,
    username,
    nft_name,
    nft_number
  } = req.body;

  if (
    !wheel_id ||
    !winner_id ||
    !telegram_id ||
    !username || // теперь обязательно
    !nft_name ||
    !nft_number
  ) {
    return res.status(400).json({
      error: 'Missing required fields (wheel_id, winner_id, telegram_id, username, nft_name, nft_number)'
    });
  }

  const { data, error } = await supabase
    .from('pending_rewards')
    .insert([
      {
        wheel_id,
        winner_id,
        telegram_id,
        username,
        nft_name,
        nft_number,
        status: 'pending'
      }
    ])
    .select()
    .single();

  if (error) {
    console.error('❌ Error logging NFT transfer:', error);
    return res.status(500).json({ error: 'Failed to log NFT transfer' });
  }

  res.status(201).json({
    message: 'NFT transfer logged successfully',
    reward: data
  });
};
