import { supabase } from '../config/supabase';

export const authService = {
  async signUp(email, password, name) {
    console.log('[AUTH] signUp called:', email);
    
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name },
      },
    });

    if (error) {
      console.log('[AUTH] signUp error:', error);
      throw error;
    }

    console.log('[AUTH] signUp success');
    return data;
  },

  async signIn(email, password) {
    console.log('[AUTH] signIn called:', email);
    
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.log('[AUTH] signIn error:', error);
      throw error;
    }

    console.log('[AUTH] signIn success');
    return data;
  },

  async signOut() {
    console.log('[AUTH] signOut called');
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  },

  async resetPassword(email) {
    console.log('[AUTH] resetPassword called:', email);
    
    // Don't specify redirectTo - Supabase will use its default password reset page
    const { data, error } = await supabase.auth.resetPasswordForEmail(email);

    if (error) {
      console.log('[AUTH] resetPassword error:', error);
      throw error;
    }

    console.log('[AUTH] resetPassword email sent');
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
