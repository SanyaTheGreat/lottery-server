import { supabase } from '../../services/supabaseClient.js'

export const claimReward = async (req, res) => {
  const { telegram_id } = req.body

  if (!telegram_id) {
    return res.status(400).json({ error: 'telegram_id is required' })
  }

  // Получаем pending подарок
  const { data: reward, error: fetchError } = await supabase
    .from('pending_rewards')
    .select('*')
    .eq('telegram_id', telegram_id)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (fetchError || !reward) {
    return res.status(404).json({ error: 'No pending reward found' })
  }

  try {
    await sendTelegramGift(reward.telegram_id, reward.nft_name)

    const { error: updateError } = await supabase
      .from('pending_rewards')
      .update({ status: 'confirmed', sent_at: new Date().toISOString() })
      .eq('id', reward.id)

    if (updateError) {
      console.error('❌ Error updating reward status:', updateError)
      return res.status(500).json({ error: 'Failed to update reward status' })
    }

    res.json({ message: 'Reward sent successfully' })
  } catch (err) {
    console.error('❌ Failed to send gift:', err.message)
    return res.status(500).json({ error: 'Failed to send gift' })
  }
}
