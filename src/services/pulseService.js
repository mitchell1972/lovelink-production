import { supabase } from '../config/supabase';

export const pulseService = {
  async sendPulse(partnershipId, senderId) {
    console.log('[PULSE SERVICE] sendPulse called:', { partnershipId, senderId });

    const { data, error } = await supabase
      .from('pulses')
      .insert({
        partnership_id: partnershipId,
        sender_id: senderId,
      })
      .select()
      .single();

    if (error) {
      console.log('[PULSE SERVICE] ERROR sending:', error);
      throw error;
    }

    console.log('[PULSE SERVICE] Pulse sent:', data);
    return data;
  },

  async getMyPulses(partnershipId, userId) {
    console.log('[PULSE SERVICE] getMyPulses called');

    const { data, error } = await supabase
      .from('pulses')
      .select('*')
      .eq('partnership_id', partnershipId)
      .eq('sender_id', userId)
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) {
      console.log('[PULSE SERVICE] ERROR fetching my pulses:', error);
      throw error;
    }

    return data;
  },

  async getReceivedPulses(partnershipId, userId) {
    console.log('[PULSE SERVICE] getReceivedPulses called');

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
      .from('pulses')
      .select('*')
      .eq('partnership_id', partnershipId)
      .neq('sender_id', userId)
      .gte('created_at', today.toISOString())
      .order('created_at', { ascending: false });

    if (error) {
      console.log('[PULSE SERVICE] ERROR fetching received pulses:', error);
      throw error;
    }

    return data;
  },

  async deletePulse(pulseId) {
    console.log('[PULSE SERVICE] deletePulse called:', pulseId);

    const { error } = await supabase
      .from('pulses')
      .delete()
      .eq('id', pulseId);

    if (error) {
      console.log('[PULSE SERVICE] ERROR deleting:', error);
      throw error;
    }

    console.log('[PULSE SERVICE] Pulse deleted');
  },

  async markPulseReceived(pulseId) {
    console.log('[PULSE SERVICE] markPulseReceived called:', pulseId);

    const { data, error } = await supabase
      .from('pulses')
      .update({ received_at: new Date().toISOString() })
      .eq('id', pulseId)
      .select()
      .single();

    if (error) {
      console.log('[PULSE SERVICE] ERROR marking received:', error);
      throw error;
    }

    return data;
  },

  subscribeToPulses(partnershipId, callback) {
    console.log('[PULSE SERVICE] Subscribing to pulses');

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
          console.log('[PULSE SERVICE] Real-time update:', payload.eventType);
          callback(payload);
        }
      )
      .subscribe((status) => {
        console.log('[PULSE SERVICE] Subscription status:', status);
      });
  },
};
