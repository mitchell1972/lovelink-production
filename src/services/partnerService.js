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
    const normalizedCode = (code || '').trim().toUpperCase();

    const { data, error } = await supabase.rpc('link_partners', {
      p_code: normalizedCode,
    });

    if (!error) return data;

    // Some DB deployments still throw a raw unique constraint error when the
    // couple is already linked. Recover gracefully instead of hard-failing.
    const message = (error.message || '').toLowerCase();
    const isDuplicatePartnership =
      error.code === '23505' ||
      message.includes('unique_partnership') ||
      message.includes('duplicate key value');

    if (!isDuplicatePartnership) {
      throw error;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    const currentUserId = user?.id;

    if (!currentUserId) {
      return {
        success: false,
        error: 'Unable to verify existing partnership. Please sign in again.',
      };
    }

    let partnerUserId = null;
    try {
      const validation = await this.validateCode(normalizedCode);
      if (validation?.valid) {
        partnerUserId = validation.code?.user_id || null;
      }
    } catch {
      // Ignore validation failures here; we can still look for an active
      // partnership for the current user.
    }

    const { data: rows, error: lookupError } = await supabase
      .from('partnerships')
      .select('id, status, user1_id, user2_id')
      .or(`user1_id.eq.${currentUserId},user2_id.eq.${currentUserId}`)
      .order('created_at', { ascending: false });

    if (lookupError) {
      throw error;
    }

    const allRows = Array.isArray(rows) ? rows : [];
    const matchingRows = partnerUserId
      ? allRows.filter(
          (row) => row.user1_id === partnerUserId || row.user2_id === partnerUserId
        )
      : allRows;

    const activePartnership = matchingRows.find((row) => row.status === 'active');
    if (activePartnership) {
      const resolvedPartnerId =
        partnerUserId ||
        (activePartnership.user1_id === currentUserId
          ? activePartnership.user2_id
          : activePartnership.user1_id);

      return {
        success: true,
        partnership_id: activePartnership.id,
        partner_id: resolvedPartnerId,
        already_linked: true,
      };
    }

    if (matchingRows.length > 0) {
      return {
        success: false,
        error:
          'A previous partnership record already exists for this couple. Please contact support to reactivate it.',
      };
    }

    throw error;
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
