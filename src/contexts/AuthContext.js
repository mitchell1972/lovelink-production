import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { log } from '../utils/logger';
import { authService } from '../services/authService';
import { profileService } from '../services/profileService';
import { partnerService } from '../services/partnerService';
import { notificationService } from '../services/notificationService';

const AuthContext = createContext({});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [partnership, setPartnership] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const initialLoadDoneRef = useRef(false);
  const loadingUserDataRef = useRef(false);

  // Initialize auth state
  useEffect(() => {
    checkUser();

    // Listen for auth changes
    const { data: authListener } = authService.onAuthStateChange(
      async (event, session) => {
        if (event === 'TOKEN_REFRESHED') {
          // Token refresh — update user object but do NOT reload partnership.
          if (session?.user) setUser(session.user);
          return;
        }
        if (event === 'SIGNED_IN' && session?.user) {
          setUser(session.user);
          // Only do a full data load on the initial sign-in, not on
          // subsequent SIGNED_IN events that Supabase fires after token
          // rehydration from storage. Also skip if checkUser is already
          // running loadUserData to avoid parallel calls.
          if (!initialLoadDoneRef.current && !loadingUserDataRef.current) {
            await loadUserData(session.user.id);
          }
        } else if (event === 'SIGNED_OUT') {
          initialLoadDoneRef.current = false;
          setUser(null);
          setProfile(null);
          setPartnership(null);
        }
      }
    );

    return () => {
      authListener?.subscription?.unsubscribe();
    };
  }, []);

  const checkUser = async () => {
    try {
      setLoading(true);
      const session = await authService.getSession();
      if (session?.user) {
        setUser(session.user);
        await loadUserData(session.user.id);
      }
    } catch (err) {
      log('Error checking user:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadUserData = async (userId) => {
    if (loadingUserDataRef.current) return;
    loadingUserDataRef.current = true;
    try {
      // Load profile
      const userProfile = await profileService.getProfile(userId);
      setProfile(userProfile);

      // Load partnership if exists
      const userPartnership = await partnerService.getPartnership(userId);
      // Never overwrite an existing partnership with null — treat a null
      // DB read as a transient failure when we already have state.
      if (userPartnership) {
        setPartnership(userPartnership);
      } else {
        setPartnership((current) => current ?? null);
      }

      initialLoadDoneRef.current = true;

      // Best-effort: register push notifications without blocking auth flow.
      notificationService
        .registerForPushNotifications(userId)
        .catch((notifErr) => {
          log('[AUTH] Push notification registration skipped:', notifErr?.message || notifErr);
        });
    } catch (err) {
      log('Error loading user data:', err);
    } finally {
      loadingUserDataRef.current = false;
    }
  };

  const signUp = async (email, password, name) => {
    try {
      setError(null);
      setLoading(true);
      const data = await authService.signUp(email, password, name);
      return { success: true, data };
    } catch (err) {
      setError(err.message);
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  };

  const signIn = async (email, password) => {
    try {
      setError(null);
      setLoading(true);
      const data = await authService.signIn(email, password);
      return { success: true, data };
    } catch (err) {
      setError(err.message);
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  };

  const signOut = async () => {
    try {
      setError(null);
      await authService.signOut();
      setUser(null);
      setProfile(null);
      setPartnership(null);
      return { success: true };
    } catch (err) {
      // Ensure user is logged out in-app even if remote sign-out request fails.
      setUser(null);
      setProfile(null);
      setPartnership(null);
      setError(err.message);
      return { success: false, error: err.message };
    }
  };

  const refreshPartnership = async (linkResult = null) => {
    if (!user) return;
    const hasLinkHint =
      !!(linkResult?.success && linkResult?.partnership_id && linkResult?.partner_id);

    const optimistic = hasLinkHint
      ? {
          id: linkResult.partnership_id,
          user1_id: user.id,
          user2_id: linkResult.partner_id,
          status: 'active',
          partner: { id: linkResult.partner_id, name: 'Partner', avatar_url: null },
        }
      : null;

    // Switch out of link screen immediately after a successful link response.
    if (optimistic) {
      setPartnership(optimistic);
    }

    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const attempts = hasLinkHint ? 5 : 1;

    try {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const userPartnership = await partnerService.getPartnership(user.id);
        if (userPartnership) {
          setPartnership(userPartnership);
          return userPartnership;
        }

        if (attempt < attempts - 1) {
          await wait(400 * (attempt + 1));
        }
      }

      if (optimistic) {
        return optimistic;
      }

      // When called without a link hint (e.g. from navigation), a null DB read
      // may be a transient failure. Preserve the current partnership instead of
      // kicking the user back to the link screen.
      if (!hasLinkHint) {
        return partnership;
      }

      setPartnership(null);
      return null;
    } catch (err) {
      log('Error refreshing partnership:', err);
      if (optimistic) {
        return optimistic;
      }
      // Same transient-failure guard for the error path.
      if (!hasLinkHint) {
        return partnership;
      }
      return null;
    }
  };

  // Verify partnership code validity before any communication action.
  // If the partner has regenerated their code the partnership is ended
  // and the user is returned to the LinkPartnerScreen.
  const verifyPartnership = async () => {
    if (!user || !partnership?.id) return null;

    try {
      const result = await partnerService.verifyPartnershipCodeValidity(partnership.id);
      if (!result.valid) {
        log('[AUTH] Partnership code invalid:', result.reason);
        setPartnership(null);
        return null;
      }

      // Code still valid — refresh partnership data for freshness.
      const latest = await partnerService.getPartnership(user.id);
      if (latest) {
        setPartnership(latest);
        return latest;
      }
      setPartnership(null);
      return null;
    } catch (err) {
      log('[AUTH] verifyPartnership error:', err);
      // On error fall back to a normal refresh so we don't block the user.
      return refreshPartnership();
    }
  };

  const value = {
    user,
    profile,
    partnership,
    loading,
    error,
    isAuthenticated: !!user,
    isPaired: !!partnership,
    signUp,
    signIn,
    signOut,
    refreshPartnership,
    verifyPartnership,
    refreshProfile: () => user && loadUserData(user.id),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
