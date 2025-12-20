import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

// Replace these with your Supabase project credentials
// Get these from: https://supabase.com/dashboard/project/YOUR_PROJECT/settings/api
const SUPABASE_URL = 'https://tfrhdxatjsyobmyffuzg.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_GxepMKxepwVIz7JhqLhpBw_BYezF3AM';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Helper to check if Supabase is configured
export const isSupabaseConfigured = () => {
  return SUPABASE_URL !== 'YOUR_SUPABASE_URL' && SUPABASE_ANON_KEY !== 'YOUR_SUPABASE_ANON_KEY';
};
