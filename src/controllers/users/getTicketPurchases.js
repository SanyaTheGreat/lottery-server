import { supabase } from '../../services/supabaseClient.js'

const getTicketPurchases = async (req, res) => {
  const { telegram_id } = req.params

  if (!telegram_id) {
    return res.status(400).json({ error: 'Telegram ID is required' })
  }

  const { data, error } = await supabase
    .from('sells')
    .select('amount, wallet, created_at')
    .eq('telegram_id', telegram_id)
    .order('created_at', { ascending: false })

  if (error) {
    return res.status(500).json({ error: error.message })
  }

  res.status(200).json(data)
}

export default getTicketPurchases
