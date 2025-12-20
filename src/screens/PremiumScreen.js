import React from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { Card, Heading, Subheading, Button, colors } from '../components/ui';

export const PremiumScreen = ({ onNavigate }) => {
  const handleSubscribe = () => {
    // In production, this would integrate with RevenueCat or Stripe
    Alert.alert(
      'Premium Coming Soon! 💎',
      'Premium features are currently in development. Thanks for your interest!',
      [{ text: 'OK' }]
    );
  };

  const features = [
    {
      emoji: '🎯',
      title: 'Bonus Session Packs',
      description: 'Gratitude, reflection, adventure, and more',
    },
    {
      emoji: '📅',
      title: 'Premium Plan Templates',
      description: 'Date ideas with reminders',
    },
    {
      emoji: '🖼️',
      title: 'Extended Moments',
      description: 'Unlimited storage & filters',
    },
    {
      emoji: '💓',
      title: 'Custom Pulse Patterns',
      description: 'Unique haptic rhythms',
    },
    {
      emoji: '📊',
      title: 'Relationship Insights',
      description: 'Track your connection over time',
    },
    {
      emoji: '🎨',
      title: 'Custom Themes',
      description: 'Personalize your app colors',
    },
  ];

  return (
    <Card>
      <Heading>Upgrades ⭐</Heading>
      <Subheading>Enhance your LoveLink experience</Subheading>

      <View style={styles.featuresContainer}>
        {features.map((feature, index) => (
          <View key={index} style={styles.featureRow}>
            <Text style={styles.featureEmoji}>{feature.emoji}</Text>
            <View style={styles.featureText}>
              <Text style={styles.featureTitle}>{feature.title}</Text>
              <Text style={styles.featureDesc}>{feature.description}</Text>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.priceContainer}>
        <Text style={styles.priceLabel}>LoveLink Premium</Text>
        <Text style={styles.price}>$4.99/month</Text>
        <Text style={styles.priceNote}>or $39.99/year (save 33%)</Text>
      </View>

      <Button
        title="💎 Subscribe to Premium"
        onPress={handleSubscribe}
      />

      <Text style={styles.disclaimer}>
        Cancel anytime. Subscription auto-renews.
      </Text>

      <Button
        title="← Back"
        variant="secondary"
        onPress={() => onNavigate('home')}
        style={styles.backBtn}
      />
    </Card>
  );
};

const styles = StyleSheet.create({
  featuresContainer: {
    marginVertical: 15,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    backgroundColor: '#F8F8FF',
    padding: 12,
    borderRadius: 10,
  },
  featureEmoji: {
    fontSize: 24,
    marginRight: 12,
  },
  featureText: {
    flex: 1,
  },
  featureTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  featureDesc: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  priceContainer: {
    alignItems: 'center',
    backgroundColor: '#EDE7F6',
    padding: 20,
    borderRadius: 15,
    marginVertical: 15,
  },
  priceLabel: {
    fontSize: 14,
    color: colors.textLight,
    fontWeight: '600',
  },
  price: {
    fontSize: 32,
    fontWeight: 'bold',
    color: colors.primary,
    marginTop: 5,
  },
  priceNote: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 5,
  },
  disclaimer: {
    fontSize: 11,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 10,
  },
  backBtn: {
    marginTop: 15,
  },
});
