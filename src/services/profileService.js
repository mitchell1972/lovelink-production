import { supabase } from '../config/supabase';

export const profileService = {
  /**
   * Get the current user's profile
   */
  async getProfile(userId) {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) throw error;
    return data;
  },

  /**
   * Update the current user's profile
   */
  async updateProfile(userId, updates) {
    const { data, error } = await supabase
      .from('profiles')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', userId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  /**
   * Get partner's profile
   */
  async getPartnerProfile(partnerId) {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, name, avatar_url')
      .eq('id', partnerId)
      .single();

    if (error) throw error;
    return data;
  },

  /**
   * Upload avatar image
   */
  async uploadAvatar(userId, file) {
    const fileExt = file.uri.split('.').pop();
    const filePath = `${userId}/avatar.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(filePath, file, { upsert: true });

    if (uploadError) throw uploadError;

    const { data } = supabase.storage.from('avatars').getPublicUrl(filePath);

    // Update profile with new avatar URL
    await this.updateProfile(userId, { avatar_url: data.publicUrl });

    return data.publicUrl;
  },
};
