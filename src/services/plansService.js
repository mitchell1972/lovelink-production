import { supabase } from '../config/supabase';

// Keep in sync with DB check constraints in supabase-schema.sql
export const BUDGET_OPTIONS = ['Low', 'Medium', 'High'];
export const VIBE_OPTIONS = ['Casual', 'Romantic', 'Adventurous', 'Relaxing'];

export const plansService = {
  async createPlan(partnershipId, userId, planData) {
    console.log('[PLANS SERVICE] createPlan called');

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
      console.log('[PLANS SERVICE] CREATE ERROR:', error);
      throw new Error('Create failed: ' + error.message);
    }

    console.log('[PLANS SERVICE] Plan created:', data.id);
    return data;
  },

  async getPlans(partnershipId) {
    console.log('[PLANS SERVICE] getPlans called');

    const { data, error } = await supabase
      .from('plans')
      .select('*')
      .eq('partnership_id', partnershipId)
      .order('created_at', { ascending: false });

    if (error) {
      console.log('[PLANS SERVICE] FETCH ERROR:', error);
      throw error;
    }

    console.log('[PLANS SERVICE] Fetched:', data?.length, 'plans');
    return data;
  },

  async confirmPlan(planId, userId) {
    console.log('[PLANS SERVICE] confirmPlan called:', planId);

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
      console.log('[PLANS SERVICE] CONFIRM ERROR:', error);
      throw new Error('Confirm failed: ' + error.message);
    }

    console.log('[PLANS SERVICE] Plan confirmed');
    return data;
  },

  async rejectPlan(planId, userId) {
    console.log('[PLANS SERVICE] rejectPlan called:', planId);

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
      console.log('[PLANS SERVICE] REJECT ERROR:', error);
      throw new Error('Reject failed: ' + error.message);
    }

    console.log('[PLANS SERVICE] Plan rejected');
    return data;
  },

  async completePlan(planId) {
    console.log('[PLANS SERVICE] completePlan called:', planId);

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
      console.log('[PLANS SERVICE] COMPLETE ERROR:', error);
      throw new Error('Complete failed: ' + error.message);
    }

    console.log('[PLANS SERVICE] Plan completed');
    return data;
  },

  async deletePlan(planId) {
    console.log('[PLANS SERVICE] deletePlan called:', planId);

    const { error } = await supabase
      .from('plans')
      .delete()
      .eq('id', planId);

    if (error) {
      console.log('[PLANS SERVICE] DELETE ERROR:', error);
      throw new Error('Delete failed: ' + error.message);
    }

    console.log('[PLANS SERVICE] Plan deleted successfully');
  },

  subscribeToPlans(partnershipId, callback) {
    console.log('[PLANS SERVICE] Subscribing');
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
