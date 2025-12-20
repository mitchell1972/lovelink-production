import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Vibration, Alert } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { pulseService } from '../services/pulseService';
import { Card, Heading, Subheading, Button, colors } from '../components/ui';

export const PulseScreen = ({ onNavigate }) => {
  const { user, partnership } = useAuth();
  const [tapCount, setTapCount] = useState(0);
  const [lastTapTime, setLastTapTime] = useState(null);
  const [pulseSent, setPulseSent] = useState(false);
  const [lastPulse, setLastPulse] = useState(null);
  const [receivedPulses, setReceivedPulses] = useState([]);
  const [loading, setLoading] = useState(false);
  
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    console.log('[PULSE] Screen mounted');
    loadPulses();
    
    const subscription = pulseService.subscribeToPulses(
      partnership.id,
      (payload) => {
        console.log('[PULSE] Real-time update:', payload.eventType);
        if (payload.new && payload.new.sender_id !== user.id) {
          Vibration.vibrate([0, 200, 100, 200, 100, 200]);
          Alert.alert('💓 Pulse Received!', `${partnership.partner.name} is thinking of you!`);
          loadPulses();
        }
      }
    );

    return () => subscription?.unsubscribe();
  }, []);

  const loadPulses = async () => {
    console.log('[PULSE] loadPulses called');
    try {
      // Get my last pulse
      const myPulses = await pulseService.getMyPulses(partnership.id, user.id);
      if (myPulses && myPulses.length > 0) {
        setLastPulse(myPulses[0]);
        // Check if pulse was sent in last 5 minutes
        const pulseTime = new Date(myPulses[0].created_at);
        const now = new Date();
        const diffMinutes = (now - pulseTime) / (1000 * 60);
        setPulseSent(diffMinutes < 5);
      }
      
      // Get received pulses
      const received = await pulseService.getReceivedPulses(partnership.id, user.id);
      setReceivedPulses(received || []);
      console.log('[PULSE] Loaded pulses - sent:', myPulses?.length, 'received:', received?.length);
    } catch (err) {
      console.log('[PULSE] ERROR loading pulses:', err);
    }
  };

  const handleTap = () => {
    const now = Date.now();
    
    if (lastTapTime && now - lastTapTime > 2000) {
      setTapCount(1);
    } else {
      setTapCount(prev => prev + 1);
    }
    
    setLastTapTime(now);
    
    Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 1.3, duration: 100, useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 1, duration: 100, useNativeDriver: true }),
    ]).start();

    Vibration.vibrate(50);

    if (tapCount + 1 >= 3) {
      sendPulse();
    }
  };

  const sendPulse = async () => {
    console.log('[PULSE] sendPulse called');
    setLoading(true);
    try {
      const pulse = await pulseService.sendPulse(partnership.id, user.id);
      console.log('[PULSE] Pulse sent:', pulse);
      setLastPulse(pulse);
      setPulseSent(true);
      setTapCount(0);
      
      Vibration.vibrate([0, 100, 50, 100, 50, 100]);
      
      Animated.sequence([
        Animated.timing(glowAnim, { toValue: 1, duration: 300, useNativeDriver: false }),
        Animated.timing(glowAnim, { toValue: 0, duration: 500, useNativeDriver: false }),
      ]).start();

      setTimeout(() => setPulseSent(false), 300000); // Reset after 5 min
    } catch (err) {
      console.log('[PULSE] ERROR sending:', err);
      Alert.alert('Error', 'Failed to send pulse');
    } finally {
      setLoading(false);
    }
  };

  const withdrawPulse = async () => {
    console.log('[PULSE] withdrawPulse called');
    if (!lastPulse) return;
    
    Alert.alert(
      'Withdraw Pulse',
      'Take back your last pulse? Your partner won\'t see it anymore.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Withdraw',
          style: 'destructive',
          onPress: async () => {
            try {
              await pulseService.deletePulse(lastPulse.id);
              console.log('[PULSE] Pulse withdrawn');
              setLastPulse(null);
              setPulseSent(false);
              Alert.alert('Withdrawn', 'Your pulse has been taken back.');
              loadPulses();
            } catch (err) {
              console.log('[PULSE] ERROR withdrawing:', err);
              Alert.alert('Error', 'Failed to withdraw pulse');
            }
          },
        },
      ]
    );
  };

  const glowColor = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['rgba(255, 107, 107, 0)', 'rgba(255, 107, 107, 0.5)'],
  });

  return (
    <Card>
      <Heading>Pulse</Heading>
      <Subheading>Tap the heart 3 times to send a pulse to {partnership.partner.name}</Subheading>

      <View style={styles.pulseContainer}>
        <Animated.View style={[styles.glowCircle, { backgroundColor: glowColor }]} />
        
        <Animated.Text
          style={[styles.heart, { transform: [{ scale: pulseAnim }] }]}
          onPress={handleTap}
        >
          💓
        </Animated.Text>

        <View style={styles.tapIndicator}>
          {[1, 2, 3].map((i) => (
            <View
              key={i}
              style={[styles.tapDot, tapCount >= i && styles.tapDotActive]}
            />
          ))}
        </View>
      </View>

      {pulseSent && (
        <View style={styles.sentContainer}>
          <Text style={styles.sentText}>
            💕 Pulse sent! {partnership.partner.name} will feel your love.
          </Text>
          <Button
            title="↩️ Withdraw Pulse"
            variant="outline"
            size="small"
            onPress={withdrawPulse}
            style={styles.withdrawBtn}
          />
        </View>
      )}

      {receivedPulses.length > 0 && (
        <View style={styles.receivedContainer}>
          <Text style={styles.receivedText}>
            💓 You received {receivedPulses.length} pulse(s) from {partnership.partner.name}!
          </Text>
        </View>
      )}

      <Text style={styles.instructions}>
        Tap the heart 3 times within 2 seconds to send a pulse
      </Text>

      <Button title="🔄 Refresh" variant="outline" onPress={loadPulses} style={styles.refreshBtn} />
      <Button title="← Back" variant="secondary" onPress={() => onNavigate('home')} style={styles.backBtn} />
    </Card>
  );
};

const styles = StyleSheet.create({
  pulseContainer: { alignItems: 'center', justifyContent: 'center', marginVertical: 30, position: 'relative' },
  glowCircle: { position: 'absolute', width: 200, height: 200, borderRadius: 100 },
  heart: { fontSize: 100 },
  tapIndicator: { flexDirection: 'row', marginTop: 20 },
  tapDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#E0E0E0', marginHorizontal: 5 },
  tapDotActive: { backgroundColor: '#FF6B6B' },
  sentContainer: { backgroundColor: '#FCE4EC', padding: 15, borderRadius: 10, marginBottom: 15, alignItems: 'center' },
  sentText: { color: '#FF6B6B', textAlign: 'center', fontWeight: '600' },
  withdrawBtn: { marginTop: 10 },
  receivedContainer: { backgroundColor: '#FFF3E0', padding: 15, borderRadius: 10, marginBottom: 15 },
  receivedText: { color: '#E65100', textAlign: 'center', fontWeight: '600' },
  instructions: { textAlign: 'center', color: '#999', fontSize: 12, marginBottom: 15 },
  refreshBtn: { marginTop: 5 },
  backBtn: { marginTop: 10 },
});
