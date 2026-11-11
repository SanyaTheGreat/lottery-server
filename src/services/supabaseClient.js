import fetch from 'node-fetch';
globalThis.fetch = fetch;

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config()


const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY




if (!supabaseUrl || !supabaseKey) {
  console.error("❌ Supabase ENV переменные не загружены");
}


export const supabase = createClient(supabaseUrl, supabaseKey)
