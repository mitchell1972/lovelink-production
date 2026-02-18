import React, { createContext, useContext, useState, useEffect } from 'react';
import { authService } from '../services/authService';
import { profileService } from '../services/profileService';
import { partnerService } from '../services/partnerService';
import { notificationService } from '../services/notificationService';
import { supabase } from '../config/supabase';

const AuthContext = createContext({});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [partnership, setPartnership] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Initialize auth state
  useEffect(() => {
    checkUser();

    // Listen for auth changes
    const { data: authListener } = authService.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_IN' && session?.user) {
          setUser(session.user);
          await loadUserData(session.user.id);
        } else if (event === 'SIGNED_OUT') {
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
      console.error('Error checking user:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadUserData = async (userId) => {
    try {
      // Load profile
      const userProfile = await profileService.getProfile(userId);
      setProfile(userProfile);

      // Load partnership if exists
      const userPartnership = await partnerService.getPartnership(userId);
      setPartnership(userPartnership);

      // Best-effort: register push notifications without blocking auth flow.
      notificationService
        .registerForPushNotifications(userId)
        .catch((notifErr) => {
          console.log('[AUTH] Push notification registration skipped:', notifErr?.message || notifErr);
        });
    } catch (err) {
      console.error('Error loading user data:', err);
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
      setError(err.message);
      return { success: false, error: err.message };
    }
  };

  const refreshPartnership = async () => {
    if (!user) return;
    try {
      const userPartnership = await partnerService.getPartnership(user.id);
      setPartnership(userPartnership);
      return userPartnership;
    } catch (err) {
      console.error('Error refreshing partnership:', err);
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
    refreshProfile: () => user && loadUserData(user.id),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
