import { supabase } from '../config/supabase';
import { log } from '../utils/logger';

const missingRpcFunctionCodes = new Set(['PGRST202', '42883']);

export const partnerService = {
  /**
   * Generate a new unique partner code for the user.
   * In newer DB deployments this also unlinks any active partnership first.
   */
  async generateCode(userId) {
    // Preferred path: server-side RPC that atomically unlinks (if needed)
    // and generates a new code.
    const { data: regenerateData, error: regenerateError } = await supabase
      .rpc('regenerate_partner_code');

    if (!regenerateError && regenerateData) {
      if (regenerateData.success === false) {
        throw new Error(regenerateData.error || 'Failed to generate partner code');
      }

      if (regenerateData.code?.code) {
        return {
          ...regenerateData.code,
          unlinked: !!regenerateData.unlinked,
        };
      }
    }

    if (regenerateError && !missingRpcFunctionCodes.has(regenerateError.code)) {
      throw regenerateError;
    }

    // Safety guard: do not allow "generate new code" to proceed for linked
    // users when the secure unlink-and-regenerate RPC is unavailable.
    let activePartnership = null;
    try {
      activePartnership = await this.getPartnership(userId);
    } catch (partnershipLookupError) {
      throw new Error(
        'Could not verify your partnership state. Please try again.'
      );
    }

    if (activePartnership?.id) {
      throw new Error(
        'For safety, this environment must install the unlink migration before generating a new code while linked. Run migrations/regenerate-code-unlinks-partnership.sql in Supabase, then try again.'
      );
    }

    // Backward-compatible fallback for DBs that don't have the RPC yet.
    const { error: invalidateError } = await supabase
      .from('partner_codes')
      .delete()
      .eq('user_id', userId)
      .is('used_at', null);

    if (invalidateError) throw invalidateError;

    // Generate new code using the existing function
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
    return {
      ...data,
      unlinked: false,
    };
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

    if (!error) {
      if (data?.success && (!data?.partner_id || !data?.partnership_id)) {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (user?.id) {
          const currentPartnership = await this.getPartnership(user.id);
          if (currentPartnership?.id) {
            return {
              ...data,
              partnership_id: data.partnership_id || currentPartnership.id,
              partner_id: data.partner_id || currentPartnership.partner?.id || null,
            };
          }
        }
      }

      return data;
    }

    const message = (error.message || '').toLowerCase();
    const isAlreadyLinkedConstraint =
      error.code === '23514' ||
      message.includes('one active partnership') ||
      message.includes('already in an active partnership') ||
      message.includes('already linked');

    if (isAlreadyLinkedConstraint) {
      return {
        success: false,
        error:
          'One of you is already linked to another partner. Unlink first before creating a new connection.',
      };
    }

    // Some DB deployments still throw a raw unique constraint error when the
    // couple is already linked. Recover gracefully instead of hard-failing.
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
      throw lookupError;
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
    const getBaseRows = async () => {
      const { data, error } = await supabase
        .from('partnerships')
        .select('*')
        .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(20);

      if (error) throw error;
      return Array.isArray(data) ? data : (data ? [data] : []);
    };

    const getRowsWithEmbeddedProfiles = async () => {
      const { data, error } = await supabase
        .from('partnerships')
        .select(`
          *,
          partner1:user1_id(id, name, avatar_url),
          partner2:user2_id(id, name, avatar_url)
        `)
        .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(20);

      if (error) throw error;
      return Array.isArray(data) ? data : (data ? [data] : []);
    };

    let rows = [];
    let usedFallback = false;

    try {
      rows = await getRowsWithEmbeddedProfiles();
    } catch (embeddedError) {
      // Some PostgREST deployments can fail embedding when FK relationships are ambiguous.
      // Fall back to a plain partnerships query and fetch partner profile separately.
      log('[PARTNER] Embedded partnership query failed, using fallback:', embeddedError?.message || embeddedError);
      rows = await getBaseRows();
      usedFallback = true;
    }

    if (!rows.length) return null;

    // Legacy data can contain multiple active rows (for example A-B and B-A).
    // Always pick the same newest row for both users to avoid mismatched
    // partnership IDs across devices.
    const selected = rows[0];

    const partnerId = selected.user1_id === userId ? selected.user2_id : selected.user1_id;
    let partner = selected.user1_id === userId ? selected.partner2 : selected.partner1;

    if (!partner?.id || usedFallback) {
      const { data: partnerProfile } = await supabase
        .from('profiles')
        .select('id, name, avatar_url')
        .eq('id', partnerId)
        .maybeSingle();

      if (partnerProfile?.id) {
        partner = partnerProfile;
      }
    }

    return {
      ...selected,
      partner: partner || (partnerId ? { id: partnerId, name: 'Partner', avatar_url: null } : null),
    };
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
