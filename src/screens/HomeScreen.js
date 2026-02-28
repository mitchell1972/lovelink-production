import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { getTrialAccessStatus, TRIAL_GATED_FEATURES } from '../services/premiumService';
import { Card, Heading, Subheading, Button, colors } from '../components/ui';

export const HomeScreen = ({ onNavigate }) => {
  const { user, profile, partnership } = useAuth();
  const [trialStatus, setTrialStatus] = useState(null);
  const userName = profile?.name || user?.user_metadata?.name || 'there';
  const partnerName = partnership?.partner?.name || 'Partner';

  useEffect(() => {
    let isMounted = true;

    const loadTrialStatus = async () => {
      if (!user?.id) return;
      const status = await getTrialAccessStatus(user.id);
      if (isMounted) {
        setTrialStatus(status);
      }
    };

    loadTrialStatus();

    return () => {
      isMounted = false;
    };
  }, [user?.id]);

  const features = [
    {
      id: 'session',
      emoji: '💭',
      title: 'Daily Session',
      subtitle: 'Answer today\'s question together',
      color: '#E8F5E9',
    },
    {
      id: 'moments',
      emoji: '📸',
      title: 'Moments',
      subtitle: 'Share photos with each other',
      color: '#FFF3E0',
    },
    {
      id: 'pulse',
      emoji: '💓',
      title: 'Pulse',
      subtitle: 'Send a quick thinking-of-you',
      color: '#FCE4EC',
    },
    {
      id: 'plan',
      emoji: '📅',
      title: 'Plans',
      subtitle: 'Plan your next date together',
      color: '#E3F2FD',
    },
  ];

  const isFeatureLocked = (featureId) =>
    !!trialStatus &&
    !trialStatus.hasAccess &&
    TRIAL_GATED_FEATURES.includes(featureId);

  const handleFeaturePress = (featureId) => {
    if (!isFeatureLocked(featureId)) {
      onNavigate(featureId);
      return;
    }

    Alert.alert(
      'Subscription Required',
      'Your 7-day free trial has ended. Subscribe to keep using Daily Session, Moments, Pulse, and Plans.',
      [
        { text: 'Not Now', style: 'cancel' },
        { text: 'Go Premium', onPress: () => onNavigate('premium') },
      ]
    );
  };

  const renderTrialBanner = () => {
    if (!trialStatus || trialStatus.isPremium) return null;

    if (trialStatus.isInTrial) {
      const dayLabel = trialStatus.daysRemaining === 1 ? 'day' : 'days';
      return (
        <TouchableOpacity style={styles.trialBanner} onPress={() => onNavigate('premium')}>
          <Text style={styles.trialBannerText}>
            ⏳ Free trial: {trialStatus.daysRemaining} {dayLabel} left
          </Text>
        </TouchableOpacity>
      );
    }

    return (
      <TouchableOpacity style={styles.trialExpiredBanner} onPress={() => onNavigate('premium')}>
        <Text style={styles.trialExpiredText}>
          🔒 Trial ended - Subscribe to unlock Daily Session, Moments, Pulse, and Plans
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <Card>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Heading>Hey {userName}! 👋</Heading>
          <Subheading>Connected with {partnerName}</Subheading>
        </View>
        <TouchableOpacity 
          style={styles.settingsBtn}
          onPress={() => onNavigate('settings')}
        >
          <Text style={styles.settingsIcon}>⚙️</Text>
        </TouchableOpacity>
      </View>

      {renderTrialBanner()}

      <View style={styles.features}>
        {features.map((feature) => (
          <TouchableOpacity
            key={feature.id}
            style={[styles.featureCard, { backgroundColor: feature.color }]}
            onPress={() => handleFeaturePress(feature.id)}
            activeOpacity={0.7}
          >
            <Text style={styles.featureEmoji}>{feature.emoji}</Text>
            <View style={styles.featureText}>
              <Text style={styles.featureTitle}>{feature.title}</Text>
              <Text style={styles.featureSubtitle}>
                {isFeatureLocked(feature.id) ? 'Locked - Premium required' : feature.subtitle}
              </Text>
            </View>
            <Text style={styles.arrow}>{isFeatureLocked(feature.id) ? '🔒' : '→'}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Button
        title="💎 Premium"
        variant="outline"
        onPress={() => onNavigate('premium')}
        style={styles.premiumBtn}
      />
    </Card>
  );
};

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  headerText: {
    flex: 1,
  },
  settingsBtn: {
    padding: 8,
  },
  settingsIcon: {
    fontSize: 24,
  },
  features: {
    marginTop: 10,
  },
  featureCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    borderRadius: 12,
    marginBottom: 12,
  },
  featureEmoji: {
    fontSize: 28,
    marginRight: 12,
  },
  featureText: {
    flex: 1,
  },
  featureTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  featureSubtitle: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  arrow: {
    fontSize: 18,
    color: '#999',
  },
  premiumBtn: {
    marginTop: 10,
  },
  trialBanner: {
    backgroundColor: '#FFF8E1',
    borderWidth: 1,
    borderColor: '#F9A825',
    borderRadius: 10,
    padding: 10,
    marginTop: 8,
  },
  trialBannerText: {
    color: '#7A5A00',
    fontWeight: '600',
    fontSize: 13,
    textAlign: 'center',
  },
  trialExpiredBanner: {
    backgroundColor: '#FFEBEE',
    borderWidth: 1,
    borderColor: '#E57373',
    borderRadius: 10,
    padding: 10,
    marginTop: 8,
  },
  trialExpiredText: {
    color: '#B71C1C',
    fontWeight: '600',
    fontSize: 13,
    textAlign: 'center',
  },
});
