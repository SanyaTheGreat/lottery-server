import fetch from 'node-fetch';
globalThis.fetch = fetch;

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config()


const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY



console.log("🔗 URL:", supabaseUrl)
console.log("🔑 KEY (start):", supabaseKey?.substring(0, 20))

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ Supabase ENV переменные не загружены");
}


export const supabase = createClient(supabaseUrl, supabaseKey)

supabase.from('users').select('*').limit(1).then(({ data, error }) => {
    if (error) {
      console.error("❌ Initial Supabase test error:", error.message)
    } else {
      console.log("✅ Supabase initial test success:", data)
    }
  })