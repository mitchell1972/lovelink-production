import { supabase } from '../config/supabase';

export const SESSION_TYPES = {
  mood: {
    type: 'mood',
    prompt: 'How are you feeling today?',
    options: ['😊 Happy', '😄 Excited', '😌 Relaxed', '😢 Sad', '😰 Anxious'],
  },
  appreciation: {
    type: 'appreciation',
    prompt: 'Write one thing you appreciate about your partner today.',
    options: null,
  },
  microPlan: {
    type: 'microPlan',
    prompt: 'Choose a small plan for today:',
    options: [
      'Take a 5-min coffee break together',
      'Send a sweet text',
      'Share a meme',
      'Plan a 10-min walk',
      'Cook a quick meal together',
    ],
  },
  wins: {
    type: 'wins',
    prompt: 'Share one small win from today:',
    options: null,
  },
};

const SESSION_TYPE_KEYS = Object.keys(SESSION_TYPES);

const getTodayDateString = () => {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const sessionService = {
  SESSION_TYPES,

  getTodaySessionType() {
    const today = new Date();
    const dateString = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
    let hash = 0;
    for (let i = 0; i < dateString.length; i++) {
      hash = ((hash << 5) - hash) + dateString.charCodeAt(i);
      hash = hash & hash;
    }
    const index = Math.abs(hash) % SESSION_TYPE_KEYS.length;
    const sessionType = SESSION_TYPES[SESSION_TYPE_KEYS[index]];
    console.log('[SESSION] getTodaySessionType:', { dateString, index, type: sessionType.type });
    return sessionType;
  },

  getRandomSessionType() {
    const types = Object.values(SESSION_TYPES);
    const randomType = types[Math.floor(Math.random() * types.length)];
    console.log('[SESSION] getRandomSessionType:', randomType.type);
    return randomType;
  },

  async submitSession(partnershipId, userId, sessionType, answer) {
    console.log('[SESSION] submitSession called:', { partnershipId, userId, sessionType, answer });
    
    const session = SESSION_TYPES[sessionType];
    if (!session) {
      console.log('[SESSION] ERROR: Invalid session type:', sessionType);
      throw new Error('Invalid session type');
    }

    const todayDate = getTodayDateString();
    console.log('[SESSION] Inserting session with date:', todayDate);

    const { data, error } = await supabase
      .from('sessions')
      .insert({
        partnership_id: partnershipId,
        user_id: userId,
        session_type: sessionType,
        prompt: session.prompt,
        answer,
        session_date: todayDate,
      })
      .select()
      .single();

    if (error) {
      console.log('[SESSION] ERROR submitting:', error);
      throw error;
    }
    
    console.log('[SESSION] Successfully submitted:', data);
    return data;
  },

  async getPartnerSession(partnershipId, partnerId, sessionType) {
    return this.getPartnerSessionByDate(partnershipId, partnerId, sessionType, getTodayDateString());
  },

  async getPartnerSessionByDate(partnershipId, partnerId, sessionType, dateString) {
    console.log('[SESSION] getPartnerSessionByDate called:', { partnershipId, partnerId, sessionType, dateString });

    const { data, error } = await supabase
      .from('sessions')
      .select('*')
      .eq('partnership_id', partnershipId)
      .eq('user_id', partnerId)
      .eq('session_type', sessionType)
      .eq('session_date', dateString)
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) {
      console.log('[SESSION] ERROR fetching partner session:', error);
      throw error;
    }
    
    const result = data && data.length > 0 ? data[0] : null;
    console.log('[SESSION] Partner session result:', result ? { id: result.id, answer: result.answer } : 'No session found');
    return result;
  },

  subscribeToSessions(partnershipId, callback) {
    console.log('[SESSION] Subscribing to sessions for partnership:', partnershipId);
    return supabase
      .channel(`sessions:${partnershipId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'sessions',
        filter: `partnership_id=eq.${partnershipId}`,
      }, (payload) => {
        console.log('[SESSION] Real-time update received:', payload);
        callback(payload);
      })
      .subscribe((status) => {
        console.log('[SESSION] Subscription status:', status);
      });
  },
};
