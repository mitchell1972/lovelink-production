import { supabase } from '../config/supabase';
import { log } from '../utils/logger';
import { withServiceTimeout } from './serviceTimeout';

export const pulseService = {
  async sendPulse(partnershipId, senderId, pattern = 'heartbeat') {
    log('[PULSE SERVICE] sendPulse called:', { partnershipId, senderId, pattern });

    const { data, error } = await supabase
      .from('pulses')
      .insert({
        partnership_id: partnershipId,
        sender_id: senderId,
        pattern,
      })
      .select()
      .single();

    if (error) {
      log('[PULSE SERVICE] ERROR sending:', error);
      throw error;
    }

    log('[PULSE SERVICE] Pulse sent:', data);
    return data;
  },

  async getMyPulses(partnershipId, userId) {
    log('[PULSE SERVICE] getMyPulses called');

    const { data, error } = await withServiceTimeout(
      supabase
        .from('pulses')
        .select('*')
        .eq('partnership_id', partnershipId)
        .eq('sender_id', userId)
        .order('created_at', { ascending: false })
        .limit(10),
      'pulse.getMyPulses'
    );

    if (error) {
      log('[PULSE SERVICE] ERROR fetching my pulses:', error);
      throw error;
    }

    return data;
  },

  async getReceivedPulses(partnershipId, userId) {
    log('[PULSE SERVICE] getReceivedPulses called');

    const { data, error } = await withServiceTimeout(
      supabase
        .from('pulses')
        .select('*')
        .eq('partnership_id', partnershipId)
        .neq('sender_id', userId)
        .order('created_at', { ascending: false })
        .limit(10),
      'pulse.getReceivedPulses'
    );

    if (error) {
      log('[PULSE SERVICE] ERROR fetching received pulses:', error);
      throw error;
    }

    return data;
  },

  async deletePulse(pulseId, userId) {
    log('[PULSE SERVICE] deletePulse called:', pulseId);

    if (!userId) {
      throw new Error('Missing user id');
    }

    const { error } = await supabase
      .from('pulses')
      .delete()
      .eq('id', pulseId)
      .eq('sender_id', userId);

    if (error) {
      log('[PULSE SERVICE] ERROR deleting:', error);
      throw error;
    }

    log('[PULSE SERVICE] Pulse deleted');
  },

  async markPulseReceived(pulseId) {
    log('[PULSE SERVICE] markPulseReceived called:', pulseId);

    const { data, error } = await supabase
      .from('pulses')
      .update({ received_at: new Date().toISOString() })
      .eq('id', pulseId)
      .select()
      .single();

    if (error) {
      log('[PULSE SERVICE] ERROR marking received:', error);
      throw error;
    }

    return data;
  },

  subscribeToPulses(partnershipId, callback) {
    log('[PULSE SERVICE] Subscribing to pulses');

    return supabase
      .channel(`pulses:${partnershipId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'pulses',
          filter: `partnership_id=eq.${partnershipId}`,
        },
        (payload) => {
          log('[PULSE SERVICE] Real-time update:', payload.eventType);
          callback(payload);
        }
      )
      .subscribe((status) => {
        log('[PULSE SERVICE] Subscription status:', status);
      });
  },
};
