import { supabase } from '../config/supabase';

export const partnerService = {
  /**
   * Generate a new unique partner code for the user
   */
  async generateCode(userId) {
    // First, invalidate any existing unused codes
    await supabase
      .from('partner_codes')
      .delete()
      .eq('user_id', userId)
      .is('used_at', null);

    // Generate new code using the database function
    const { data: codeResult, error: codeError } = await supabase
      .rpc('generate_partner_code');

    if (codeError) throw codeError;

    // Insert the new code
    const { data, error } = await supabase
      .from('partner_codes')
      .insert({
        user_id: userId,
        code: codeResult,
        expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(), // 48 hours
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  /**
   * Get the user's current active code
   */
  async getActiveCode(userId) {
    const { data, error } = await supabase
      .from('partner_codes')
      .select('*')
      .eq('user_id', userId)
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    // If no code found, generate a new one
    if (error?.code === 'PGRST116') {
      return this.generateCode(userId);
    }

    if (error) throw error;
    return data;
  },

  /**
   * Validate a partner code (check if it exists and is valid)
   */
  async validateCode(code) {
    const normalized = (code || '').trim().toUpperCase();

    // Fast client-side validation
    if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(normalized)) {
      return { valid: false, error: 'Invalid or expired code' };
    }

    // Primary path: secure RPC (does not expose all active codes via SELECT policy)
    const { data, error } = await supabase.rpc('validate_partner_code', {
      p_code: normalized,
    });

    if (!error && data) {
      return data;
    }

    // Backward-compatible fallback for environments where RPC is not yet deployed.
    if (error?.code === 'PGRST202' || error?.code === '42883') {
      const { data: legacyData, error: legacyError } = await supabase
        .from('partner_codes')
        .select('*, profiles:user_id(name)')
        .eq('code', normalized)
        .is('used_at', null)
        .gt('expires_at', new Date().toISOString())
        .single();

      if (legacyError) {
        if (legacyError.code === 'PGRST116') {
          return { valid: false, error: 'Invalid or expired code' };
        }
        throw legacyError;
      }

      if (legacyData.user_id) {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (user?.id && legacyData.user_id === user.id) {
          return { valid: false, error: 'Cannot use your own code' };
        }
      }

      return { valid: true, code: legacyData };
    }

    if (error) {
      throw error;
    }

    return { valid: false, error: 'Invalid or expired code' };
  },

  /**
   * Link with a partner using their code
   */
  async linkWithPartner(code) {
    const { data, error } = await supabase
      .rpc('link_partners', { p_code: code.toUpperCase() });

    if (error) throw error;
    return data;
  },

  /**
   * Get the current partnership
   */
  async getPartnership(userId) {
    const { data, error } = await supabase
      .from('partnerships')
      .select(`
        *,
        partner1:user1_id(id, name, avatar_url),
        partner2:user2_id(id, name, avatar_url)
      `)
      .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
      .eq('status', 'active')
      .single();

    if (error?.code === 'PGRST116') {
      return null; // No partnership found
    }

    if (error) throw error;

    // Determine which partner is the "other" person
    const partner = data.user1_id === userId ? data.partner2 : data.partner1;
    return { ...data, partner };
  },

  /**
   * End a partnership
   */
  async endPartnership(partnershipId) {
    const { data, error } = await supabase
      .from('partnerships')
      .update({ status: 'ended' })
      .eq('id', partnershipId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },
};
