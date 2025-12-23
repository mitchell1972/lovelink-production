// src/screens/PulseScreen.js
// Send heartbeat pulses to partner with premium patterns

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Animated,
  Vibration,
  ScrollView,
} from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { pulseService } from '../services/pulseService';
import { getAvailablePulsePatterns, getPremiumStatus } from '../services/premiumService';

// All pulse patterns (some locked for free users)
const ALL_PULSE_PATTERNS = {
  heartbeat: {
    name: 'Heartbeat',
    icon: '💓',
    vibration: [0, 200, 100, 200],
    description: 'Classic heartbeat rhythm',
    premium: false,
  },
  flutter: {
    name: 'Flutter',
    icon: '💕',
    vibration: [0, 100, 50, 100, 50, 100],
    description: 'Excited butterflies',
    premium: true,
  },
  steady: {
    name: 'Steady',
    icon: '❤️',
    vibration: [0, 500],
    description: 'Long, steady pulse',
    premium: true,
  },
  excited: {
    name: 'Excited',
    icon: '💗',
    vibration: [0, 50, 50, 50, 50, 50, 50, 50, 50, 50],
    description: 'Rapid excitement',
    premium: true,
  },
  calm: {
    name: 'Calm',
    icon: '💜',
    vibration: [0, 300, 200, 300, 200, 300],
    description: 'Peaceful waves',
    premium: true,
  },
};

export default function PulseScreen({ onNavigate }) {
  const { user, profile, partnership } = useAuth();
  const [sending, setSending] = useState(false);
  const [myPulses, setMyPulses] = useState([]);
  const [receivedPulses, setReceivedPulses] = useState([]);
  const [selectedPattern, setSelectedPattern] = useState('heartbeat');
  const [availablePatterns, setAvailablePatterns] = useState(['heartbeat']);
  const [isPremium, setIsPremium] = useState(false);
  const pulseAnim = useState(new Animated.Value(1))[0];

  useEffect(() => {
    loadPulses();
    loadAvailablePatterns();
  }, []);

  const loadAvailablePatterns = async () => {
    if (!user) return;
    try {
      const status = await getPremiumStatus(user.id);
      setIsPremium(status.isPremium);
      const patterns = await getAvailablePulsePatterns(user.id);
      setAvailablePatterns(patterns);
    } catch (error) {
      console.error('Error loading patterns:', error);
      setAvailablePatterns(['heartbeat']);
    }
  };

  const loadPulses = async () => {
    if (!user || !partnership?.id) return;
    try {
      const [myData, receivedData] = await Promise.all([
        pulseService.getMyPulses(partnership.id, user.id),
        pulseService.getReceivedPulses(partnership.id, user.id),
      ]);
      setMyPulses(myData || []);
      setReceivedPulses(receivedData || []);
    } catch (error) {
      console.error('Error loading pulses:', error);
    }
  };

  const handleBack = () => {
    onNavigate('home');
  };

  const animatePulse = () => {
    Animated.sequence([
      Animated.timing(pulseAnim, {
        toValue: 1.3,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(pulseAnim, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const handleSendPulse = async () => {
    if (!partnership?.id) {
      Alert.alert('No Partner', 'Connect with your partner first!');
      return;
    }

    setSending(true);
    animatePulse();
    
    const pattern = ALL_PULSE_PATTERNS[selectedPattern];
    Vibration.vibrate(pattern.vibration);

    try {
      await pulseService.sendPulse(partnership.id, user.id);
      await loadPulses();
      Alert.alert(
        pattern.icon + ' Pulse Sent!',
        'Your partner will feel your ' + pattern.name.toLowerCase()
      );
    } catch (error) {
      console.error('Error sending pulse:', error);
      Alert.alert('Error', 'Failed to send pulse. Please try again.');
    } finally {
      setSending(false);
    }
  };

  const handleDeletePulse = async (pulseId) => {
    Alert.alert(
      'Delete Pulse',
      'Remove this pulse from your history?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await pulseService.deletePulse(pulseId);
              await loadPulses();
              Alert.alert('Deleted', 'Pulse removed from history');
            } catch (error) {
              Alert.alert('Error', 'Failed to delete pulse');
            }
          },
        },
      ]
    );
  };

  const renderPatternOption = (patternKey) => {
    const pattern = ALL_PULSE_PATTERNS[patternKey];
    const isAvailable = availablePatterns.includes(patternKey);
    const isSelected = selectedPattern === patternKey;

    return (
      <TouchableOpacity
        key={patternKey}
        style={[
          styles.patternOption,
          isSelected && styles.patternOptionSelected,
          !isAvailable && styles.patternOptionLocked,
        ]}
        onPress={() => {
          if (isAvailable) {
            setSelectedPattern(patternKey);
            Vibration.vibrate(pattern.vibration);
          } else {
            Alert.alert(
              '🔒 Premium Pattern',
              '"' + pattern.name + '" is a Premium-only pattern.\n\nUpgrade to unlock all 5 pulse patterns!',
              [
                { text: 'Maybe Later', style: 'cancel' },
                { text: '💎 Go Premium', onPress: () => onNavigate('premium') },
              ]
            );
          }
        }}
        disabled={sending}
      >
        <Text style={styles.patternIcon}>{pattern.icon}</Text>
        <Text style={[
          styles.patternName,
          !isAvailable && styles.patternNameLocked,
        ]}>
          {pattern.name}
        </Text>
        {!isAvailable && (
          <Text style={styles.lockIcon}>🔒</Text>
        )}
        {isSelected && isAvailable && (
          <Text style={styles.checkIcon}>✓</Text>
        )}
      </TouchableOpacity>
    );
  };

  if (!partnership?.id) {
    return (
      <View style={styles.noPartnerContainer}>
        <Text style={styles.noPartnerIcon}>🔗</Text>
        <Text style={styles.noPartnerText}>Connect with your partner first!</Text>
        <TouchableOpacity style={styles.backButton} onPress={handleBack}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const allPulses = [...myPulses.map(p => ({...p, isFromMe: true})), ...receivedPulses.map(p => ({...p, isFromMe: false}))]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 10);

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <TouchableOpacity style={styles.backBtn} onPress={handleBack}>
        <Text style={styles.backBtnText}>← Back</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Pulse 💓</Text>
      <Text style={styles.subtitle}>Let them know you're thinking of them</Text>

      {isPremium ? (
        <View style={styles.premiumBadge}>
          <Text style={styles.premiumBadgeText}>💎 All Patterns Unlocked</Text>
        </View>
      ) : (
        <TouchableOpacity 
          style={styles.upgradeBanner}
          onPress={() => onNavigate('premium')}
        >
          <Text style={styles.upgradeBannerText}>
            🔓 Unlock 4 more patterns with Premium →
          </Text>
        </TouchableOpacity>
      )}

      <Text style={styles.sectionTitle}>Choose Pattern</Text>
      <View style={styles.patternsGrid}>
        {Object.keys(ALL_PULSE_PATTERNS).map(renderPatternOption)}
      </View>

      <View style={styles.selectedInfo}>
        <Text style={styles.selectedInfoText}>
          {ALL_PULSE_PATTERNS[selectedPattern].description}
        </Text>
      </View>

      <TouchableOpacity
        style={styles.pulseButton}
        onPress={handleSendPulse}
        disabled={sending}
        activeOpacity={0.8}
      >
        <Animated.View
          style={[
            styles.pulseCircle,
            { transform: [{ scale: pulseAnim }] },
          ]}
        >
          <Text style={styles.pulseIcon}>
            {ALL_PULSE_PATTERNS[selectedPattern].icon}
          </Text>
        </Animated.View>
        <Text style={styles.pulseText}>
          {sending ? 'Sending...' : 'Tap to Send Pulse'}
        </Text>
      </TouchableOpacity>

      {allPulses.length > 0 && (
        <View style={styles.recentSection}>
          <Text style={styles.recentTitle}>Recent Pulses</Text>
          {allPulses.map((pulse) => (
            <TouchableOpacity
              key={pulse.id}
              style={styles.pulseItem}
              onLongPress={() => handleDeletePulse(pulse.id)}
            >
              <Text style={styles.pulseItemIcon}>💓</Text>
              <View style={styles.pulseItemInfo}>
                <Text style={styles.pulseItemText}>
                  {pulse.isFromMe ? 'You sent a pulse' : 'Received a pulse'}
                </Text>
                <Text style={styles.pulseItemTime}>
                  {new Date(pulse.created_at).toLocaleString()}
                </Text>
              </View>
              <Text style={styles.deleteHint}>🗑️</Text>
            </TouchableOpacity>
          ))}
          <Text style={styles.deleteHintText}>Long press any pulse to delete</Text>
        </View>
      )}

      {receivedPulses.length > 0 && (
        <View style={styles.receivedBanner}>
          <Text style={styles.receivedText}>
            💕 Your partner sent you {receivedPulses.length} pulse{receivedPulses.length > 1 ? 's' : ''} today!
          </Text>
        </View>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
  },
  backBtn: {
    marginBottom: 10,
  },
  backBtnText: {
    color: '#fff',
    fontSize: 16,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.8)',
    textAlign: 'center',
    marginBottom: 20,
  },
  premiumBadge: {
    backgroundColor: 'rgba(255, 215, 0, 0.2)',
    padding: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 20,
  },
  premiumBadgeText: {
    color: '#FFD700',
    fontWeight: '600',
    fontSize: 13,
  },
  upgradeBanner: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 20,
  },
  upgradeBannerText: {
    color: '#FFD700',
    fontWeight: '500',
    fontSize: 13,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 12,
  },
  patternsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 16,
  },
  patternOption: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    width: '30%',
    flexGrow: 1,
    position: 'relative',
  },
  patternOptionSelected: {
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderWidth: 2,
    borderColor: '#fff',
  },
  patternOptionLocked: {
    opacity: 0.6,
  },
  patternIcon: {
    fontSize: 28,
    marginBottom: 4,
  },
  patternName: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '500',
  },
  patternNameLocked: {
    color: 'rgba(255,255,255,0.6)',
  },
  lockIcon: {
    position: 'absolute',
    top: 4,
    right: 4,
    fontSize: 12,
  },
  checkIcon: {
    position: 'absolute',
    top: 4,
    right: 4,
    fontSize: 14,
    color: '#4ade80',
    fontWeight: 'bold',
  },
  selectedInfo: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    padding: 12,
    borderRadius: 8,
    marginBottom: 24,
  },
  selectedInfoText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 13,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  pulseButton: {
    alignItems: 'center',
    marginBottom: 32,
  },
  pulseCircle: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  pulseIcon: {
    fontSize: 64,
  },
  pulseText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
  },
  recentSection: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  recentTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 12,
  },
  pulseItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  pulseItemIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  pulseItemInfo: {
    flex: 1,
  },
  pulseItemText: {
    color: '#fff',
    fontSize: 14,
  },
  pulseItemTime: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    marginTop: 2,
  },
  deleteHint: {
    fontSize: 16,
    opacity: 0.5,
  },
  deleteHintText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 12,
    fontStyle: 'italic',
  },
  receivedBanner: {
    backgroundColor: 'rgba(255, 105, 180, 0.2)',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  receivedText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '500',
  },
  noPartnerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  noPartnerIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  noPartnerText: {
    fontSize: 18,
    color: '#fff',
    textAlign: 'center',
    marginBottom: 20,
  },
  backButton: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  backButtonText: {
    color: '#fff',
    fontSize: 16,
  },
});
