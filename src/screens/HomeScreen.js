import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { Card, Heading, Subheading, Button, colors } from '../components/ui';

export const HomeScreen = ({ onNavigate }) => {
  const { user, profile, partnership } = useAuth();
  const userName = profile?.name || user?.user_metadata?.name || 'there';
  const partnerName = partnership?.partner?.name || 'Partner';

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

      <View style={styles.features}>
        {features.map((feature) => (
          <TouchableOpacity
            key={feature.id}
            style={[styles.featureCard, { backgroundColor: feature.color }]}
            onPress={() => onNavigate(feature.id)}
            activeOpacity={0.7}
          >
            <Text style={styles.featureEmoji}>{feature.emoji}</Text>
            <View style={styles.featureText}>
              <Text style={styles.featureTitle}>{feature.title}</Text>
              <Text style={styles.featureSubtitle}>{feature.subtitle}</Text>
            </View>
            <Text style={styles.arrow}>→</Text>
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
});
