import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Alert, Modal, ScrollView, TouchableOpacity } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { sessionService } from '../services/sessionService';
import { Card, Heading, Subheading, Input, Button, colors } from '../components/ui';

// Generate last 30 days
const getLast30Days = () => {
  const days = [];
  for (let i = 0; i < 30; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    days.push({
      date: date,
      label: i === 0 ? 'Today' : i === 1 ? 'Yesterday' : date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
      dateString: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
    });
  }
  return days;
};

export const SessionScreen = ({ onNavigate }) => {
  const { user, partnership } = useAuth();
  const [session, setSession] = useState(null);
  const [answer, setAnswer] = useState('');
  const [partnerAnswer, setPartnerAnswer] = useState(null);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [selectedDate, setSelectedDate] = useState(getLast30Days()[0]);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [isViewingHistory, setIsViewingHistory] = useState(false);

  const last30Days = getLast30Days();

  useEffect(() => {
    console.log('[SCREEN] SessionScreen mounted');
    console.log('[SCREEN] User:', user?.id);
    console.log('[SCREEN] Partnership:', partnership?.id);
    console.log('[SCREEN] Partner:', partnership?.partner?.id, partnership?.partner?.name);
    loadSessionForDate(selectedDate);
  }, []);

  useEffect(() => {
    if (session?.type && selectedDate) {
      console.log('[SCREEN] Loading sessions for date:', selectedDate.dateString);
      checkPartnerSession(session.type, selectedDate.dateString);
      checkMySession(session.type, selectedDate.dateString);
    }
  }, [session?.type, selectedDate.dateString]);

  const loadSessionForDate = (dateObj) => {
    console.log('[SCREEN] loadSessionForDate called for:', dateObj.dateString);
    
    // Get session type for that date
    const dateString = `${dateObj.date.getFullYear()}-${dateObj.date.getMonth()}-${dateObj.date.getDate()}`;
    let hash = 0;
    for (let i = 0; i < dateString.length; i++) {
      hash = ((hash << 5) - hash) + dateString.charCodeAt(i);
      hash = hash & hash;
    }
    const SESSION_TYPE_KEYS = ['mood', 'appreciation', 'microPlan', 'wins'];
    const index = Math.abs(hash) % SESSION_TYPE_KEYS.length;
    const sessionType = sessionService.SESSION_TYPES[SESSION_TYPE_KEYS[index]];
    
    console.log('[SCREEN] Session type for date:', sessionType.type);
    setSession(sessionType);
    setAnswer('');
    setSubmitted(false);
    setPartnerAnswer(null);
    setIsViewingHistory(dateObj.label !== 'Today');
  };

  const handleDateSelect = (dateObj) => {
    console.log('[SCREEN] Date selected:', dateObj.label, dateObj.dateString);
    setSelectedDate(dateObj);
    setShowDatePicker(false);
    loadSessionForDate(dateObj);
  };

  const tryDifferentSession = () => {
    console.log('[SCREEN] tryDifferentSession called');
    const randomSession = sessionService.getRandomSessionType();
    setSession(randomSession);
    setAnswer('');
    setSubmitted(false);
    setPartnerAnswer(null);
  };

  const checkPartnerSession = async (sessionType, dateString) => {
    console.log('[SCREEN] checkPartnerSession called for type:', sessionType, 'date:', dateString);
    
    if (!partnership?.partner?.id) {
      console.log('[SCREEN] No partner ID available');
      return;
    }
    
    try {
      const partnerSession = await sessionService.getPartnerSessionByDate(
        partnership.id,
        partnership.partner.id,
        sessionType,
        dateString
      );
      
      if (partnerSession?.answer) {
        console.log('[SCREEN] Partner answer found:', partnerSession.answer);
        setPartnerAnswer(partnerSession.answer);
      } else {
        console.log('[SCREEN] No partner answer found');
        setPartnerAnswer(null);
      }
    } catch (err) {
      console.log('[SCREEN] Error in checkPartnerSession:', err);
      setPartnerAnswer(null);
    }
  };

  const checkMySession = async (sessionType, dateString) => {
    console.log('[SCREEN] checkMySession called for type:', sessionType, 'date:', dateString);
    
    if (!user?.id) {
      console.log('[SCREEN] No user ID available');
      return;
    }
    
    try {
      const mySession = await sessionService.getPartnerSessionByDate(
        partnership.id,
        user.id,
        sessionType,
        dateString
      );
      
      if (mySession) {
        console.log('[SCREEN] My previous answer found:', mySession.answer);
        setAnswer(mySession.answer);
        setSubmitted(true);
      } else {
        console.log('[SCREEN] No previous answer found');
      }
    } catch (err) {
      console.log('[SCREEN] Error in checkMySession:', err);
    }
  };

  const handleSubmit = async () => {
    console.log('[SCREEN] handleSubmit called with answer:', answer);
    
    if (!answer.trim()) {
      Alert.alert('Please enter or select an answer');
      return;
    }

    if (isViewingHistory) {
      Alert.alert('Cannot Submit', 'You can only submit answers for today\'s session.');
      return;
    }

    setLoading(true);
    try {
      console.log('[SCREEN] Submitting session...');
      await sessionService.submitSession(
        partnership.id,
        user.id,
        session.type,
        answer.trim()
      );
      console.log('[SCREEN] Session submitted successfully');
      setSubmitted(true);
      Alert.alert('Submitted! 💕', 'Your partner will see your response.');
      await checkPartnerSession(session.type, selectedDate.dateString);
    } catch (err) {
      console.log('[SCREEN] Error submitting:', err);
      Alert.alert('Error', err.message || 'Failed to submit');
    } finally {
      setLoading(false);
    }
  };

  const refreshPartnerAnswer = () => {
    console.log('[SCREEN] refreshPartnerAnswer called');
    if (session?.type) {
      checkPartnerSession(session.type, selectedDate.dateString);
      Alert.alert('Refreshed!', 'Checked for partner response.');
    }
  };

  if (!session) {
    console.log('[SCREEN] No session loaded yet');
    return null;
  }

  return (
    <Card>
      <Heading>Daily Session</Heading>
      
      {/* Date indicator */}
      <Text style={styles.dateLabel}>
        {isViewingHistory ? `📜 Viewing: ${selectedDate.label}` : `📅 ${selectedDate.label}`}
      </Text>
      
      <Subheading>{session.prompt}</Subheading>

      {session.options ? (
        <View style={styles.optionsContainer}>
          {session.options.map((option) => (
            <Button
              key={option}
              title={option}
              variant={answer === option ? 'secondary' : 'primary'}
              onPress={() => {
                console.log('[SCREEN] Option selected:', option);
                setAnswer(option);
              }}
              style={styles.optionButton}
              disabled={submitted || isViewingHistory}
            />
          ))}
        </View>
      ) : (
        <Input
          placeholder="Your message..."
          value={answer}
          onChangeText={setAnswer}
          multiline
          numberOfLines={4}
          editable={!submitted && !isViewingHistory}
        />
      )}

      {!submitted && !isViewingHistory ? (
        <Button title="📤 Submit" onPress={handleSubmit} loading={loading} />
      ) : (
        <View style={styles.submittedContainer}>
          <Text style={styles.submittedText}>
            {isViewingHistory && !answer ? '📭 You didn\'t respond' : '✅ Submitted!'}
          </Text>
          {answer && <Text style={styles.yourAnswer}>You said: {answer}</Text>}
        </View>
      )}

      {partnerAnswer ? (
        <View style={styles.partnerContainer}>
          <Text style={styles.partnerLabel}>{partnership.partner.name} said:</Text>
          <Text style={styles.partnerAnswer}>{partnerAnswer}</Text>
        </View>
      ) : (
        <View style={styles.waitingContainer}>
          <Text style={styles.waitingText}>
            {isViewingHistory 
              ? `${partnership.partner.name} didn't respond`
              : `Waiting for ${partnership.partner.name}'s response...`
            }
          </Text>
          {!isViewingHistory && (
            <Button
              title="🔄 Refresh"
              variant="outline"
              onPress={refreshPartnerAnswer}
              style={styles.refreshBtn}
            />
          )}
        </View>
      )}

      <View style={styles.buttonRow}>
        <Button 
          title="📅 History" 
          variant="outline" 
          onPress={() => setShowDatePicker(true)} 
          style={styles.halfButton} 
        />
        <Button 
          title="🔄 Random" 
          variant="outline" 
          onPress={tryDifferentSession} 
          style={styles.halfButton}
          disabled={isViewingHistory}
        />
      </View>

      {isViewingHistory && (
        <Button 
          title="📅 Back to Today" 
          variant="primary" 
          onPress={() => handleDateSelect(last30Days[0])} 
          style={styles.todayBtn}
        />
      )}

      <Button title="← Back" variant="secondary" onPress={() => onNavigate('home')} style={styles.backBtn} />

      {/* Date Picker Modal */}
      <Modal
        visible={showDatePicker}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowDatePicker(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Select Date</Text>
            <Text style={styles.modalSubtitle}>View past sessions (last 30 days)</Text>
            
            <ScrollView style={styles.dateList}>
              {last30Days.map((dateObj, index) => (
                <TouchableOpacity
                  key={index}
                  style={[
                    styles.dateItem,
                    selectedDate.dateString === dateObj.dateString && styles.dateItemSelected
                  ]}
                  onPress={() => handleDateSelect(dateObj)}
                >
                  <Text style={[
                    styles.dateItemText,
                    selectedDate.dateString === dateObj.dateString && styles.dateItemTextSelected
                  ]}>
                    {dateObj.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            
            <Button 
              title="Cancel" 
              variant="secondary" 
              onPress={() => setShowDatePicker(false)} 
            />
          </View>
        </View>
      </Modal>
    </Card>
  );
};

const styles = StyleSheet.create({
  dateLabel: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '600',
    marginBottom: 5,
    textAlign: 'center',
  },
  optionsContainer: { marginVertical: 10 },
  optionButton: { marginVertical: 5 },
  submittedContainer: { backgroundColor: '#E8F5E9', padding: 15, borderRadius: 10, marginVertical: 10 },
  submittedText: { fontSize: 16, fontWeight: '600', color: '#4CAF50' },
  yourAnswer: { marginTop: 5, fontStyle: 'italic', color: '#666' },
  partnerContainer: { backgroundColor: '#FFF3E0', padding: 15, borderRadius: 10, marginVertical: 10 },
  partnerLabel: { fontSize: 14, fontWeight: '600', color: '#666' },
  partnerAnswer: { marginTop: 5, fontSize: 16, color: '#333' },
  waitingContainer: { backgroundColor: '#F5F5F5', padding: 15, borderRadius: 10, marginVertical: 10, alignItems: 'center' },
  waitingText: { fontSize: 14, color: '#999', fontStyle: 'italic', textAlign: 'center' },
  refreshBtn: { marginTop: 10 },
  buttonRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 15 },
  halfButton: { width: '48%' },
  todayBtn: { marginTop: 10 },
  backBtn: { marginTop: 10 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: 'white',
    borderRadius: 20,
    padding: 20,
    width: '85%',
    maxHeight: '70%',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 5,
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 15,
  },
  dateList: {
    maxHeight: 300,
    marginBottom: 15,
  },
  dateItem: {
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  dateItemSelected: {
    backgroundColor: colors.primary,
    borderRadius: 10,
  },
  dateItemText: {
    fontSize: 16,
    color: '#333',
  },
  dateItemTextSelected: {
    color: 'white',
    fontWeight: '600',
  },
});
