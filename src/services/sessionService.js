import { supabase } from '../config/supabase';
import { log } from '../utils/logger';

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
    const dateString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    let hash = 0;
    for (let i = 0; i < dateString.length; i++) {
      hash = ((hash << 5) - hash) + dateString.charCodeAt(i);
      hash = hash & hash;
    }
    const index = Math.abs(hash) % SESSION_TYPE_KEYS.length;
    const sessionType = SESSION_TYPES[SESSION_TYPE_KEYS[index]];
    log('[SESSION] getTodaySessionType:', { dateString, index, type: sessionType.type });
    return sessionType;
  },

  getRandomSessionType() {
    const types = Object.values(SESSION_TYPES);
    const randomType = types[Math.floor(Math.random() * types.length)];
    log('[SESSION] getRandomSessionType:', randomType.type);
    return randomType;
  },

  async submitSession(partnershipId, userId, sessionType, answer) {
    log('[SESSION] submitSession called:', { partnershipId, userId, sessionType, answer });
    
    const session = SESSION_TYPES[sessionType];
    if (!session) {
      log('[SESSION] ERROR: Invalid session type:', sessionType);
      throw new Error('Invalid session type');
    }

    const todayDate = getTodayDateString();
    log('[SESSION] Inserting session with date:', todayDate);

    const existingToday = await this.getUserSessionByDate(
      partnershipId,
      userId,
      todayDate
    );

    if (existingToday) {
      const duplicateError = new Error('You already submitted your Daily Session for today.');
      duplicateError.code = 'SESSION_ALREADY_SUBMITTED';
      duplicateError.existing = existingToday;
      throw duplicateError;
    }

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
      log('[SESSION] ERROR submitting:', error);
      throw error;
    }
    
    log('[SESSION] Successfully submitted:', data);
    return data;
  },

  async getPartnerSession(partnershipId, partnerId, sessionType) {
    return this.getPartnerSessionByDate(partnershipId, partnerId, sessionType, getTodayDateString());
  },

  async getUserSessionByDate(partnershipId, userId, dateString, sessionType = null) {
    log('[SESSION] getUserSessionByDate called:', { partnershipId, userId, sessionType, dateString });

    const runLookup = async ({ constrainPartnership }) => {
      let query = supabase
        .from('sessions')
        .select('*')
        .eq('user_id', userId)
        .eq('session_date', dateString);

      if (sessionType) {
        query = query.eq('session_type', sessionType);
      }

      if (constrainPartnership && partnershipId) {
        query = query.eq('partnership_id', partnershipId);
      }

      const { data, error } = await query
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(20);

      if (error) {
        log('[SESSION] ERROR fetching user session rows:', error);
        throw error;
      }

      const rows = Array.isArray(data) ? data : (data ? [data] : []);
      return rows[0] || null;
    };

    // Primary path: session should belong to the currently loaded partnership.
    const strict = await runLookup({ constrainPartnership: true });
    if (strict) {
      log('[SESSION] User session result (strict):', { id: strict.id, answer: strict.answer });
      return strict;
    }

    // Fallback for legacy data where duplicate active partnership rows exist and
    // each user may have posted under a different partnership_id.
    if (partnershipId) {
      log('[SESSION] No strict user match; retrying without partnership_id filter');
      const relaxed = await runLookup({ constrainPartnership: false });
      if (relaxed) {
        log('[SESSION] User session result (relaxed):', { id: relaxed.id, answer: relaxed.answer });
      } else {
        log('[SESSION] No user session found (strict or relaxed)');
      }
      return relaxed;
    }

    log('[SESSION] No user session found');
    return null;
  },

  async getPartnerSessionByDate(partnershipId, partnerId, sessionType, dateString) {
    return this.getUserSessionByDate(partnershipId, partnerId, sessionType, dateString);
  },

  subscribeToSessions(partnershipId, callback) {
    log('[SESSION] Subscribing to sessions for partnership:', partnershipId);
    return supabase
      .channel(`sessions:${partnershipId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'sessions',
        filter: `partnership_id=eq.${partnershipId}`,
      }, (payload) => {
        log('[SESSION] Real-time update received:', payload);
        callback(payload);
      })
      .subscribe((status) => {
        log('[SESSION] Subscription status:', status);
      });
  },

  subscribeToUserSessions(userId, callback) {
    log('[SESSION] Subscribing to sessions for user:', userId);
    return supabase
      .channel(`sessions:user:${userId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'sessions',
        filter: `user_id=eq.${userId}`,
      }, (payload) => {
        log('[SESSION] User real-time update received:', payload);
        callback(payload);
      })
      .subscribe((status) => {
        log('[SESSION] User subscription status:', status);
      });
  },
};
