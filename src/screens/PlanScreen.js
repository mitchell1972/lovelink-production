import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Keyboard,
  InputAccessoryView,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useAuth } from '../contexts/AuthContext';
import { plansService, BUDGET_OPTIONS, VIBE_OPTIONS } from '../services/plansService';
import { notificationService } from '../services/notificationService';
import { isServiceTimeoutError } from '../services/serviceTimeout';
import { showAlert, showConfirm } from '../services/webAlert';
import { Card, Heading, Subheading, Input, Button } from '../components/ui';

export const PlanScreen = ({ onNavigate }) => {
  const { user, partnership, refreshPartnership } = useAuth();
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  
  const [title, setTitle] = useState('');
  const [selectedDate, setSelectedDate] = useState(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [budget, setBudget] = useState('Medium');
  const [vibe, setVibe] = useState('Casual');
  const titleInputAccessoryViewId = 'plan-title-input-accessory';
  const handleDisconnectedPartnership = async (message = null) => {
    await refreshPartnership();
    showAlert(
      'Partner Changed',
      message || 'Your partner connection is no longer active. Please reconnect.'
    );
  };

  const handleTitleChange = (nextTitle) => {
    setTitle(nextTitle);
  };

  useEffect(() => {
    if (!partnership?.id) {
      return undefined;
    }

    console.log('[PLAN SCREEN] Mounted');
    loadPlans();
    
    const subscription = plansService.subscribeToPlans(
      partnership.id,
      (payload) => {
        console.log('[PLAN SCREEN] Real-time update:', payload.eventType);
        loadPlans();
      }
    );

    return () => subscription?.unsubscribe();
  }, [partnership?.id]);

  const loadPlans = async () => {
    if (!partnership?.id) {
      setPlans([]);
      setLoading(false);
      return;
    }

    console.log('[PLAN SCREEN] loadPlans called');
    setLoading(true);
    setLoadError('');
    try {
      const data = await plansService.getPlans(partnership.id, user?.id);
      setPlans(data || []);
    } catch (err) {
      if (err?.code === 'PARTNERSHIP_DISCONNECTED') {
        await handleDisconnectedPartnership(err.message);
        return;
      }
      console.log('[PLAN SCREEN] ERROR loading plans:', err);
      const message = isServiceTimeoutError(err)
        ? 'Loading plans is taking too long. Please try again.'
        : (err?.message || 'Failed to load plans.');
      setLoadError(message);
    } finally {
      setLoading(false);
    }
  };

  // Format date for display
  const formatDisplayDate = (date) => {
    if (!date) return null;
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    return `${day}/${month}/${year} ${hours}:${mins}`;
  };

  // Convert Date object to ISO string for Supabase
  const toISOString = (date) => {
    if (!date) return null;
    return date.toISOString();
  };

  const handleDateChange = (event, date) => {
    if (Platform.OS === 'android') {
      setShowDatePicker(false);
      setShowTimePicker(false);
    }
    
    if (event.type === 'dismissed') return;
    
    if (date) {
      if (showDatePicker) {
        // Date was selected, now show time picker
        setSelectedDate(date);
        setShowDatePicker(false);
        if (Platform.OS === 'android') {
          // On Android, show time picker after date is selected
          setTimeout(() => setShowTimePicker(true), 100);
        }
      } else if (showTimePicker) {
        // Time was selected, update the date with the new time
        const newDate = new Date(selectedDate || new Date());
        newDate.setHours(date.getHours());
        newDate.setMinutes(date.getMinutes());
        setSelectedDate(newDate);
        setShowTimePicker(false);
      }
    }
  };

  const handleIOSDateChange = (event, date) => {
    if (date) {
      setSelectedDate(date);
    }
  };

  const handleAddPlan = async () => {
    console.log('[PLAN SCREEN] handleAddPlan called');
    if (!title.trim()) {
      showAlert('Error', 'Please enter a plan title');
      return;
    }

    setLoading(true);
    try {
      await plansService.createPlan(partnership.id, user.id, {
        title: title.trim(),
        scheduledDate: toISOString(selectedDate),
        budget,
        vibe,
      });
      
      setTitle('');
      setSelectedDate(null);
      setBudget('Medium');
      setVibe('Casual');
      setShowAddForm(false);

      try {
        const myName = user?.user_metadata?.name || 'Your partner';
        await notificationService.notifyPartnerNewPlan(partnership?.partner?.id, myName, title.trim());
      } catch (notifError) {
        console.log('[PLAN SCREEN] Notification send failed (non-blocking):', notifError?.message || notifError);
      }
      
      showAlert('Plan Created! 📅', `Waiting for ${partnership?.partner?.name || 'your partner'} to confirm.`);
    } catch (err) {
      console.log('[PLAN SCREEN] ERROR creating plan:', err);
      if (err?.code === 'PARTNERSHIP_DISCONNECTED') {
        await handleDisconnectedPartnership(err.message);
        return;
      }
      showAlert('Error', err.message || 'Failed to create plan');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async (plan) => {
    console.log('[PLAN SCREEN] handleConfirm called');
    try {
      await plansService.confirmPlan(plan.id, user.id);

      try {
        const myName = user?.user_metadata?.name || 'Your partner';
        await notificationService.notifyPartnerPlanConfirmed(partnership?.partner?.id, myName, plan.title);
      } catch (notifError) {
        console.log('[PLAN SCREEN] Notification send failed (non-blocking):', notifError?.message || notifError);
      }

      showAlert('Plan Confirmed! 🎉', 'You both agreed to this plan!');
      loadPlans();
    } catch (err) {
      if (err?.code === 'OLD_PARTNERSHIP_PLAN' || err?.code === 'PARTNERSHIP_DISCONNECTED') {
        await handleDisconnectedPartnership(err.message);
        return;
      }
      showAlert('Error', err?.message || 'Failed to confirm plan');
    }
  };

  const handleReject = async (plan) => {
    console.log('[PLAN SCREEN] handleReject called');
    try {
      await plansService.rejectPlan(plan.id, user.id);
      showAlert('Plan Rejected', 'Maybe suggest a different idea?');
      loadPlans();
    } catch (err) {
      if (err?.code === 'OLD_PARTNERSHIP_PLAN' || err?.code === 'PARTNERSHIP_DISCONNECTED') {
        await handleDisconnectedPartnership(err.message);
        return;
      }
      showAlert('Error', err?.message || 'Failed to reject plan');
    }
  };

  const handleComplete = async (plan) => {
    console.log('[PLAN SCREEN] handleComplete called');
    try {
      await plansService.completePlan(plan.id, user.id);
      showAlert('Done! ✨', 'Hope you had a great time!');
      loadPlans();
    } catch (err) {
      if (err?.code === 'OLD_PARTNERSHIP_PLAN' || err?.code === 'PARTNERSHIP_DISCONNECTED') {
        await handleDisconnectedPartnership(err.message);
        return;
      }
      showAlert('Error', err?.message || 'Failed to complete plan');
    }
  };

  const handleDelete = (plan) => {
    console.log('[PLAN SCREEN] handleDelete called');
    showConfirm({
      title: 'Delete Plan',
      message: `Are you sure you want to delete "${plan.title}"?`,
      confirmText: 'Delete',
      destructive: true,
      onConfirm: async () => {
        try {
          await plansService.deletePlan(plan.id, user.id);
          showAlert('Deleted', 'Plan has been removed.');
          loadPlans();
        } catch (err) {
          if (err?.code === 'OLD_PARTNERSHIP_PLAN' || err?.code === 'PARTNERSHIP_DISCONNECTED') {
            await handleDisconnectedPartnership(err.message);
            return;
          }
          showAlert('Error', err?.message || 'Failed to delete plan');
        }
      },
    });
  };

  const clearDate = () => {
    setSelectedDate(null);
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'draft': return '#FFF3E0';
      case 'confirmed': return '#E8F5E9';
      case 'rejected': return '#FFEBEE';
      case 'completed': return '#E3F2FD';
      default: return '#F5F5F5';
    }
  };

  const getStatusEmoji = (status) => {
    switch (status) {
      case 'draft': return '⏳';
      case 'confirmed': return '✅';
      case 'rejected': return '❌';
      case 'completed': return '🎉';
      default: return '📅';
    }
  };

  return (
    <ScrollView
      style={styles.screenScroll}
      contentContainerStyle={styles.screenScrollContent}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}
    >
      <Card>
        <Heading>Plans</Heading>
        <Subheading>Plan dates together with {partnership?.partner?.name || 'your partner'}</Subheading>

        {loadError ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{loadError}</Text>
            <Button title="Retry" size="small" variant="secondary" onPress={loadPlans} />
          </View>
        ) : null}

        {showAddForm ? (
          <View style={styles.form}>
            <Input
              placeholder="What do you want to do?"
              value={title}
              onChangeText={handleTitleChange}
              autoCorrect={false}
              spellCheck={false}
              returnKeyType="done"
              blurOnSubmit
              onSubmitEditing={Keyboard.dismiss}
              inputAccessoryViewID={Platform.OS === 'ios' ? titleInputAccessoryViewId : undefined}
            />

            {Platform.OS === 'ios' && (
              <InputAccessoryView nativeID={titleInputAccessoryViewId}>
                <View style={styles.inputAccessory}>
                  <TouchableOpacity onPress={Keyboard.dismiss} style={styles.inputAccessoryBtn}>
                    <Text style={styles.inputAccessoryBtnText}>Done</Text>
                  </TouchableOpacity>
                </View>
              </InputAccessoryView>
            )}
          
          {/* Date Picker Button */}
          <View style={styles.datePickerContainer}>
            <TouchableOpacity 
              style={styles.dateButton} 
              onPress={() => setShowDatePicker(true)}
            >
              <Text style={styles.dateButtonText}>
                {selectedDate 
                  ? `📅 ${formatDisplayDate(selectedDate)}` 
                  : '📅 Select Date & Time (optional)'}
              </Text>
            </TouchableOpacity>
            
            {selectedDate && (
              <TouchableOpacity style={styles.clearButton} onPress={clearDate}>
                <Text style={styles.clearButtonText}>✕</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Android: Show Date Picker */}
          {showDatePicker && Platform.OS === 'android' && (
            <DateTimePicker
              value={selectedDate || new Date()}
              mode="date"
              display="default"
              onChange={handleDateChange}
              minimumDate={new Date()}
            />
          )}

          {/* Android: Show Time Picker */}
          {showTimePicker && Platform.OS === 'android' && (
            <DateTimePicker
              value={selectedDate || new Date()}
              mode="time"
              display="default"
              onChange={handleDateChange}
            />
          )}

          {/* iOS: Inline DateTime Picker */}
          {showDatePicker && Platform.OS === 'ios' && (
            <View style={styles.iosPickerContainer}>
              <DateTimePicker
                value={selectedDate || new Date()}
                mode="datetime"
                display="spinner"
                onChange={handleIOSDateChange}
                minimumDate={new Date()}
                style={styles.iosPicker}
              />
              <Button 
                title="Done" 
                size="small" 
                onPress={() => setShowDatePicker(false)} 
              />
            </View>
          )}

          <Text style={styles.label}>Budget:</Text>
          <View style={styles.optionRow}>
            {BUDGET_OPTIONS.map((opt) => (
              <Button
                key={opt}
                title={opt}
                size="small"
                variant={budget === opt ? 'secondary' : 'primary'}
                onPress={() => setBudget(opt)}
                style={styles.optionBtn}
              />
            ))}
          </View>

          <Text style={styles.label}>Vibe:</Text>
          <View style={styles.optionRow}>
            {VIBE_OPTIONS.map((opt) => (
              <Button
                key={opt}
                title={opt}
                size="small"
                variant={vibe === opt ? 'secondary' : 'primary'}
                onPress={() => setVibe(opt)}
                style={styles.optionBtn}
              />
            ))}
          </View>

            <Button title="💾 Save Plan" onPress={handleAddPlan} loading={loading} />
            <Button title="Cancel" variant="secondary" onPress={() => setShowAddForm(false)} />
          </View>
        ) : (
          <Button title="➕ Add Plan" onPress={() => setShowAddForm(true)} />
        )}

        <View style={styles.plansList}>
          {plans.length === 0 && !showAddForm ? (
            <Text style={styles.emptyText}>No plans yet. Create one!</Text>
          ) : (
            plans.map((plan) => (
              <View
                key={plan.id}
                style={[styles.planCard, { backgroundColor: getStatusColor(plan.status) }]}
              >
                <View style={styles.planHeader}>
                  <Text style={styles.planTitle}>
                    {getStatusEmoji(plan.status)} {plan.title}
                  </Text>
                  <TouchableOpacity onPress={() => handleDelete(plan)} style={styles.deleteBtn}>
                    <Text style={styles.deleteBtnText}>🗑️</Text>
                  </TouchableOpacity>
                </View>
                
                {plan.scheduled_date && (
                  <Text style={styles.planDate}>
                    📅 {formatDisplayDate(new Date(plan.scheduled_date))}
                  </Text>
                )}
                <Text style={styles.planMeta}>💰 {plan.budget} • ✨ {plan.vibe}</Text>
                <Text style={styles.planCreator}>
                  Created by {plan.created_by === user.id ? 'you' : (partnership?.partner?.name || 'your partner')}
                </Text>

                {plan.status === 'draft' && plan.created_by !== user.id && (
                  <View style={styles.actionRow}>
                    <Button title="✅ Confirm" size="small" onPress={() => handleConfirm(plan)} style={styles.actionBtn} />
                    <Button title="❌ Reject" size="small" variant="danger" onPress={() => handleReject(plan)} style={styles.actionBtn} />
                  </View>
                )}

                {plan.status === 'draft' && plan.created_by === user.id && (
                  <Text style={styles.waitingText}>Waiting for {partnership?.partner?.name || 'your partner'}...</Text>
                )}

                {plan.status === 'confirmed' && (
                  <Button title="✨ Mark Complete" size="small" onPress={() => handleComplete(plan)} style={styles.completeBtn} />
                )}
              </View>
            ))
          )}
        </View>

        <Button title="← Back" variant="secondary" onPress={() => onNavigate('home')} style={styles.backBtn} />
      </Card>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  screenScroll: {
    flex: 1,
  },
  screenScrollContent: {
    paddingBottom: 40,
  },
  form: { marginTop: 10 },
  errorBanner: {
    backgroundColor: '#FFEBEE',
    borderRadius: 10,
    marginTop: 12,
    padding: 12,
  },
  errorText: {
    color: '#B71C1C',
    fontSize: 13,
    marginBottom: 8,
  },
  label: { fontSize: 14, fontWeight: '600', color: '#666', marginTop: 10, marginBottom: 5 },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 10 },
  optionBtn: { marginRight: 8, marginBottom: 8 },
  
  // Date Picker Styles
  datePickerContainer: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    marginVertical: 8 
  },
  dateButton: {
    flex: 1,
    backgroundColor: '#F5F5F5',
    borderRadius: 10,
    padding: 15,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  dateButtonText: {
    fontSize: 16,
    color: '#666',
  },
  clearButton: {
    marginLeft: 10,
    backgroundColor: '#FFEBEE',
    borderRadius: 20,
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  clearButtonText: {
    fontSize: 16,
    color: '#E53935',
    fontWeight: 'bold',
  },
  iosPickerContainer: {
    backgroundColor: '#F5F5F5',
    borderRadius: 10,
    padding: 10,
    marginVertical: 10,
  },
  iosPicker: {
    height: 180,
  },
  
  plansList: { marginTop: 15 },
  planCard: { padding: 15, borderRadius: 10, marginBottom: 10 },
  planHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  planTitle: { fontSize: 16, fontWeight: '600', color: '#333', flex: 1 },
  deleteBtn: { padding: 5 },
  deleteBtnText: { fontSize: 18 },
  planDate: { fontSize: 14, color: '#666', marginTop: 5 },
  planMeta: { fontSize: 13, color: '#999', marginTop: 5 },
  planCreator: { fontSize: 12, color: '#999', fontStyle: 'italic', marginTop: 5 },
  waitingText: { fontSize: 12, color: '#FF9800', fontStyle: 'italic', marginTop: 8 },
  actionRow: { flexDirection: 'row', marginTop: 10 },
  actionBtn: { flex: 1, marginHorizontal: 5 },
  completeBtn: { marginTop: 10 },
  emptyText: { textAlign: 'center', color: '#999', fontStyle: 'italic', marginTop: 20 },
  backBtn: { marginTop: 15 },
  inputAccessory: {
    backgroundColor: '#F5F5F5',
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'flex-end',
  },
  inputAccessoryBtn: {
    backgroundColor: '#6C63FF',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  inputAccessoryBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
});
