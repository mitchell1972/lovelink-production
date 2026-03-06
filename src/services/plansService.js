import { supabase } from '../config/supabase';
import { log } from '../utils/logger';
import { partnerService } from './partnerService';
import { withServiceTimeout } from './serviceTimeout';

// Keep in sync with DB check constraints in supabase-schema.sql
export const BUDGET_OPTIONS = ['Low', 'Medium', 'High'];
export const VIBE_OPTIONS = ['Casual', 'Romantic', 'Adventurous', 'Relaxing'];

export const plansService = {
  async assertCurrentActivePartnership(partnershipId, userId, options = {}) {
    const { enforceExpected = true } = options;

    // Verify code validity before checking partnership status.
    if (partnershipId) {
      try {
        const validity = await partnerService.verifyPartnershipCodeValidity(partnershipId);
        if (!validity.valid) {
          const err = new Error(
            validity.reason || 'Your partner regenerated their code. Please reconnect.'
          );
          err.code = 'PARTNERSHIP_DISCONNECTED';
          throw err;
        }
      } catch (codeErr) {
        if (codeErr.code === 'PARTNERSHIP_DISCONNECTED') throw codeErr;
        log('[PLANS SERVICE] Code validity check failed, continuing with status check:', codeErr?.message);
      }
    }

    const activePartnershipId = await this.getCurrentActivePartnershipId(userId);

    if (!activePartnershipId) {
      const err = new Error('Your partner connection is no longer active. Please reconnect.');
      err.code = 'PARTNERSHIP_DISCONNECTED';
      throw err;
    }

    if (enforceExpected && partnershipId && activePartnershipId !== partnershipId) {
      const err = new Error(
        'Your partner connection changed. Return to pairing and connect again.'
      );
      err.code = 'PARTNERSHIP_DISCONNECTED';
      throw err;
    }

    return activePartnershipId;
  },

  async getCurrentActivePartnershipId(userId) {
    const { data, error } = await supabase
      .from('partnerships')
      .select('id')
      .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) {
      throw error;
    }

    const rows = Array.isArray(data) ? data : (data ? [data] : []);
    return rows[0]?.id || null;
  },

  async assertPlanBelongsToActivePartnership(planId, userId) {
    const { data: plan, error: planError } = await supabase
      .from('plans')
      .select('id, partnership_id')
      .eq('id', planId)
      .maybeSingle();

    if (planError) {
      throw new Error('Could not verify this plan right now.');
    }

    if (!plan?.id) {
      throw new Error('Plan no longer exists.');
    }

    const activePartnershipId = await this.assertCurrentActivePartnership(
      plan.partnership_id,
      userId,
      { enforceExpected: false }
    );

    if (plan.partnership_id !== activePartnershipId) {
      const err = new Error(
        'This plan belongs to a previous partner connection and can no longer be updated.'
      );
      err.code = 'OLD_PARTNERSHIP_PLAN';
      throw err;
    }
  },

  async createPlan(partnershipId, userId, planData) {
    log('[PLANS SERVICE] createPlan called');
    await this.assertCurrentActivePartnership(partnershipId, userId);

    const safeBudget = BUDGET_OPTIONS.includes(planData.budget)
      ? planData.budget
      : 'Medium';
    const safeVibe = VIBE_OPTIONS.includes(planData.vibe)
      ? planData.vibe
      : 'Casual';

    const { data, error } = await supabase
      .from('plans')
      .insert({
        partnership_id: partnershipId,
        created_by: userId,
        title: planData.title,
        scheduled_date: planData.scheduledDate,
        budget: safeBudget,
        vibe: safeVibe,
        status: 'draft',
      })
      .select()
      .single();

    if (error) {
      log('[PLANS SERVICE] CREATE ERROR:', error);
      throw new Error('Create failed: ' + error.message);
    }

    log('[PLANS SERVICE] Plan created:', data.id);
    return data;
  },

  async getPlans(partnershipId, userId = null) {
    log('[PLANS SERVICE] getPlans called');
    if (userId) {
      await this.assertCurrentActivePartnership(partnershipId, userId);
    }

    const { data, error } = await withServiceTimeout(
      supabase
        .from('plans')
        .select('*')
        .eq('partnership_id', partnershipId)
        .order('created_at', { ascending: false }),
      'plans.getPlans'
    );

    if (error) {
      log('[PLANS SERVICE] FETCH ERROR:', error);
      throw error;
    }

    log('[PLANS SERVICE] Fetched:', data?.length, 'plans');
    return data;
  },

  async confirmPlan(planId, userId) {
    log('[PLANS SERVICE] confirmPlan called:', planId);
    await this.assertPlanBelongsToActivePartnership(planId, userId);

    const { data, error } = await supabase
      .from('plans')
      .update({
        status: 'confirmed',
        confirmed_by: userId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', planId)
      .select()
      .single();

    if (error) {
      log('[PLANS SERVICE] CONFIRM ERROR:', error);
      throw new Error('Confirm failed: ' + error.message);
    }

    log('[PLANS SERVICE] Plan confirmed');
    return data;
  },

  async rejectPlan(planId, userId) {
    log('[PLANS SERVICE] rejectPlan called:', planId);
    await this.assertPlanBelongsToActivePartnership(planId, userId);

    const { data, error } = await supabase
      .from('plans')
      .update({
        status: 'rejected',
        updated_at: new Date().toISOString(),
      })
      .eq('id', planId)
      .select()
      .single();

    if (error) {
      log('[PLANS SERVICE] REJECT ERROR:', error);
      throw new Error('Reject failed: ' + error.message);
    }

    log('[PLANS SERVICE] Plan rejected');
    return data;
  },

  async completePlan(planId, userId) {
    log('[PLANS SERVICE] completePlan called:', planId);
    await this.assertPlanBelongsToActivePartnership(planId, userId);

    const { data, error } = await supabase
      .from('plans')
      .update({
        status: 'completed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', planId)
      .select()
      .single();

    if (error) {
      log('[PLANS SERVICE] COMPLETE ERROR:', error);
      throw new Error('Complete failed: ' + error.message);
    }

    log('[PLANS SERVICE] Plan completed');
    return data;
  },

  async deletePlan(planId, userId) {
    log('[PLANS SERVICE] deletePlan called:', planId);
    await this.assertPlanBelongsToActivePartnership(planId, userId);

    const { data, error } = await supabase
      .from('plans')
      .delete()
      .eq('id', planId)
      .select();

    if (error) {
      log('[PLANS SERVICE] DELETE ERROR:', error);
      throw new Error('Delete failed: ' + error.message);
    }

    if (!data || data.length === 0) {
      log('[PLANS SERVICE] DELETE returned 0 rows — likely RLS policy blocked it');
      throw new Error(
        'Could not delete this plan. You may only be able to delete plans you created.'
      );
    }

    log('[PLANS SERVICE] Plan deleted successfully');
  },

  subscribeToPlans(partnershipId, callback) {
    log('[PLANS SERVICE] Subscribing');
    return supabase
      .channel(`plans:${partnershipId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'plans',
        filter: `partnership_id=eq.${partnershipId}`,
      }, callback)
      .subscribe();
  },
};
