import { supabase } from '../config/supabase';
import { log } from '../utils/logger';

export const authService = {
  async signUp(email, password, name) {
    log('[AUTH] signUp called:', email);
    
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name },
      },
    });

    if (error) {
      log('[AUTH] signUp error:', error);
      throw error;
    }

    log('[AUTH] signUp success');
    return data;
  },

  async signIn(email, password) {
    log('[AUTH] signIn called:', email);
    
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      log('[AUTH] signIn error:', error);
      throw error;
    }

    log('[AUTH] signIn success');
    return data;
  },

  async signOut() {
    log('[AUTH] signOut called');
    // Use local scope so logout works even when network is flaky.
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error && !/auth session missing/i.test(error.message || '')) {
      throw error;
    }
  },

  async resetPassword(email) {
    log('[AUTH] resetPassword called:', email);
    
    // Don't specify redirectTo - Supabase will use its default password reset page
    const { data, error } = await supabase.auth.resetPasswordForEmail(email);

    if (error) {
      log('[AUTH] resetPassword error:', error);
      throw error;
    }

    log('[AUTH] resetPassword email sent');
    return data;
  },

  async getSession() {
    const { data: { session } } = await supabase.auth.getSession();
    return session;
  },

  onAuthStateChange(callback) {
    return supabase.auth.onAuthStateChange(callback);
  },
};
