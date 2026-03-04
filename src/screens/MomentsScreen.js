// src/screens/MomentsScreen.js
// Photo gallery with premium feature gating

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  FlatList,
  Alert,
  ActivityIndicator,
  Modal,
  Dimensions,
  RefreshControl,
  Platform,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../contexts/AuthContext';
import { momentsService } from '../services/momentsService';
import { notificationService } from '../services/notificationService';
import { checkMomentsLimit, getPremiumStatus } from '../services/premiumService';
import { isServiceTimeoutError } from '../services/serviceTimeout';
import { showAlert, showConfirm, showUpgradePrompt } from '../services/webAlert';

const { width } = Dimensions.get('window');
const imageSize = (width - 48) / 3;

export default function MomentsScreen({ onNavigate }) {
  const { user, profile, partnership } = useAuth();
  const [moments, setMoments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selectedMoment, setSelectedMoment] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [limitInfo, setLimitInfo] = useState(null);
  const [isPremium, setIsPremium] = useState(false);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    loadMoments();
  }, [user?.id, partnership?.id]);

  const checkPremiumAndLimits = async () => {
    if (!user) return;
    try {
      const status = await getPremiumStatus(user.id);
      setIsPremium(status.isPremium);
      const limits = await checkMomentsLimit(user.id, partnership?.id || null);
      setLimitInfo(limits);
    } catch (error) {
      console.error('Error checking premium:', error);
    }
  };

  const loadMoments = async (showLoader = true) => {
    if (showLoader) {
      setLoading(true);
    }

    if (!user || !partnership?.id) {
      setMoments([]);
      setLoadError('');
      if (showLoader) {
        setLoading(false);
      }
      return;
    }
    
    try {
      setLoadError('');
      const data = await momentsService.getMoments(partnership.id);
      setMoments(data || []);
      checkPremiumAndLimits().catch((error) => {
        console.error('Error checking premium after loading moments:', error);
      });
    } catch (error) {
      console.error('Error loading moments:', error);
      const message = isServiceTimeoutError(error)
        ? 'Loading moments is taking too long. Please try again.'
        : 'Failed to load moments. Please try again.';
      setLoadError(message);
    } finally {
      if (showLoader) {
        setLoading(false);
      }
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadMoments(false);
    setRefreshing(false);
  }, [user?.id, partnership?.id]);

  const handleBack = () => {
    onNavigate('home');
  };

  const handleAddMoment = async () => {
    // Check limits first
    try {
      const limits = await checkMomentsLimit(user.id, partnership?.id || null);
      
      if (!limits.allowed) {
        showUpgradePrompt({
          title: '📸 Photo Limit Reached',
          message: 'You\'ve reached the ' + limits.limit + ' photo limit on the free plan.\n\nUpgrade to Premium for unlimited photos!',
          upgradeText: '💎 Go Premium',
          cancelText: 'Maybe Later',
          onUpgrade: () => onNavigate('premium'),
        });
        return;
      }

      // Show remaining photos for free users
      if (!limits.isPremium && limits.limit !== Infinity) {
        const remaining = limits.limit - limits.current;
        if (remaining <= 3 && remaining > 0) {
          showAlert(
            '📸 Almost at Limit',
            'You have ' + remaining + ' photo' + (remaining === 1 ? '' : 's') + ' left on the free plan.'
          );
        }
      }
    } catch (error) {
      console.error('Error checking limits:', error);
    }

    // Show choice: Camera or Gallery
    if (Platform.OS === 'web') {
      pickImage('gallery');
      return;
    }

    Alert.alert(
      'Add Moment',
      'Choose how to add your photo',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: '📷 Take Photo', onPress: () => pickImage('camera') },
        { text: '🖼️ Choose from Gallery', onPress: () => pickImage('gallery') },
      ]
    );
  };

  const pickImage = async (source) => {
    let permissionResult;
    
    if (source === 'camera') {
      permissionResult = await ImagePicker.requestCameraPermissionsAsync();
      if (permissionResult.status !== 'granted') {
        showAlert('Permission needed', 'Please allow camera access to take photos.');
        return;
      }
    } else {
      permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (permissionResult.status !== 'granted') {
        showAlert('Permission needed', 'Please allow photo access to add moments.');
        return;
      }
    }

    const options = {
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    };

    const result = source === 'camera' 
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);

    if (!result.canceled && result.assets[0]) {
      setUploading(true);
      try {
        const caption = await promptForCaption();
        const newMoment = await momentsService.uploadMoment(
          partnership.id,
          user.id, 
          result.assets[0].uri,
          caption
        );
        if (newMoment) {
          setMoments(prev => [newMoment, ...prev]);
          await checkPremiumAndLimits();

          try {
            const myName = profile?.name || user?.user_metadata?.name || 'Your partner';
            await notificationService.notifyPartnerNewMoment(partnership.partner.id, myName);
          } catch (notifError) {
            console.log('[MOMENTS] Notification send failed (non-blocking):', notifError?.message || notifError);
          }
        }
      } catch (error) {
        console.error('Upload error:', error);
        showAlert('Error', 'Failed to upload photo. Please try again.');
      } finally {
        setUploading(false);
      }
    }
  };

  const promptForCaption = () => {
    // Alert.prompt is iOS-only. On Android, skip caption input
    // to avoid blocking uploads in production.
    if (Platform.OS !== 'ios') {
      return Promise.resolve('');
    }

    return new Promise((resolve) => {
      Alert.prompt(
        'Add Caption',
        'Add a caption to your moment (optional)',
        [
          { text: 'Skip', onPress: () => resolve(''), style: 'cancel' },
          { text: 'Add', onPress: (text) => resolve(text || '') },
        ],
        'plain-text',
        ''
      );
    });
  };

  const handleDeleteMoment = async (moment) => {
    if (moment.user_id !== user.id) {
      showAlert('Cannot Delete', "You can only delete your own photos.");
      return;
    }

    showConfirm({
      title: 'Delete Moment',
      message: 'Are you sure you want to delete this photo?',
      confirmText: 'Delete',
      destructive: true,
      onConfirm: async () => {
        try {
          await momentsService.deleteMoment(moment.id, moment.image_url);
          setMoments(prev => prev.filter(m => m.id !== moment.id));
          setSelectedMoment(null);
          await checkPremiumAndLimits();
        } catch (error) {
          showAlert('Error', 'Failed to delete photo.');
        }
      },
    });
  };

  const renderMoment = ({ item }) => (
    <TouchableOpacity
      style={styles.momentItem}
      onPress={() => setSelectedMoment(item)}
    >
      <Image source={{ uri: item.image_url }} style={styles.momentImage} />
      {item.user_id === user?.id && (
        <View style={styles.myBadge}>
          <Text style={styles.myBadgeText}>Me</Text>
        </View>
      )}
    </TouchableOpacity>
  );

  const renderLimitBanner = () => {
    if (!limitInfo || limitInfo.isPremium) return null;
    
    const used = limitInfo.current;
    const total = limitInfo.limit;
    const percentage = (used / total) * 100;
    
    return (
      <TouchableOpacity 
        style={styles.limitBanner}
        onPress={() => onNavigate('premium')}
      >
        <View style={styles.limitInfo}>
          <Text style={styles.limitText}>
            📸 {used}/{total} photos used
          </Text>
          <Text style={styles.limitUpgrade}>Upgrade for unlimited →</Text>
        </View>
        <View style={styles.limitBarContainer}>
          <View style={[styles.limitBar, { width: Math.min(percentage, 100) + '%' }]} />
        </View>
      </TouchableOpacity>
    );
  };

  const renderBackFooter = () => (
    <View style={styles.listFooter}>
      <TouchableOpacity style={styles.listFooterBackButton} onPress={handleBack}>
        <Text style={styles.listFooterBackButtonText}>← Back</Text>
      </TouchableOpacity>
    </View>
  );

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

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

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack}>
          <Text style={styles.headerBack}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Our Moments 📸</Text>
        <TouchableOpacity onPress={handleAddMoment} disabled={uploading}>
          {uploading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.headerAdd}>+</Text>
          )}
        </TouchableOpacity>
      </View>

      {isPremium ? (
        <View style={styles.premiumBadge}>
          <Text style={styles.premiumBadgeText}>💎 Premium - Unlimited Photos</Text>
        </View>
      ) : (
        renderLimitBanner()
      )}

      {loadError ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{loadError}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => loadMoments()}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {moments.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>📷</Text>
          <Text style={styles.emptyText}>No moments yet</Text>
          <Text style={styles.emptySubtext}>
            Tap + to add your first photo together!
          </Text>
          <TouchableOpacity style={styles.emptyBackBtn} onPress={handleBack}>
            <Text style={styles.emptyBackText}>← Back</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={moments}
          renderItem={renderMoment}
          keyExtractor={(item) => item.id}
          numColumns={3}
          contentContainerStyle={styles.grid}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ListFooterComponent={renderBackFooter}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#fff"
            />
          }
        />
      )}

      <Modal visible={!!selectedMoment} transparent animationType="fade">
        <View style={styles.modalContainer}>
          <TouchableOpacity
            style={styles.modalClose}
            onPress={() => setSelectedMoment(null)}
          >
            <Text style={styles.modalCloseText}>✕</Text>
          </TouchableOpacity>
          
          {selectedMoment && (
            <View style={styles.modalContent}>
              <Image
                source={{ uri: selectedMoment.image_url }}
                style={styles.modalImage}
                resizeMode="contain"
              />
              {selectedMoment.caption && (
                <Text style={styles.modalCaption}>{selectedMoment.caption}</Text>
              )}
              <Text style={styles.modalDate}>
                {new Date(selectedMoment.created_at).toLocaleDateString()}
              </Text>
              
              {selectedMoment.user_id === user?.id && (
                <TouchableOpacity
                  style={styles.deleteButton}
                  onPress={() => handleDeleteMoment(selectedMoment)}
                >
                  <Text style={styles.deleteButtonText}>🗑️ Delete</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  headerBack: {
    fontSize: 28,
    color: '#fff',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  headerAdd: {
    fontSize: 32,
    color: '#fff',
    fontWeight: '300',
  },
  premiumBadge: {
    backgroundColor: 'rgba(255, 215, 0, 0.2)',
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  premiumBadgeText: {
    color: '#FFD700',
    fontWeight: '600',
    fontSize: 13,
  },
  errorBanner: {
    backgroundColor: 'rgba(255, 235, 238, 0.95)',
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 8,
    padding: 12,
  },
  errorText: {
    color: '#B71C1C',
    fontSize: 13,
    marginBottom: 8,
  },
  retryButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#B71C1C',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  limitBanner: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 12,
    borderRadius: 8,
  },
  limitInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  limitText: {
    color: '#fff',
    fontWeight: '500',
    fontSize: 13,
  },
  limitUpgrade: {
    color: '#FFD700',
    fontSize: 12,
    fontWeight: '600',
  },
  limitBarContainer: {
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  limitBar: {
    height: '100%',
    backgroundColor: '#FFD700',
    borderRadius: 2,
  },
  grid: {
    padding: 12,
  },
  momentItem: {
    margin: 4,
    borderRadius: 8,
    overflow: 'hidden',
  },
  momentImage: {
    width: imageSize,
    height: imageSize,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  myBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: '#6C63FF',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  myBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 20,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'center',
    marginBottom: 20,
  },
  emptyBackBtn: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 22,
  },
  emptyBackText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  listFooter: {
    marginTop: 16,
    marginBottom: 28,
    paddingHorizontal: 4,
  },
  listFooterBackButton: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  listFooterBackButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
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
  modalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalClose: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 10,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCloseText: {
    color: '#fff',
    fontSize: 28,
  },
  modalContent: {
    alignItems: 'center',
    padding: 20,
  },
  modalImage: {
    width: width - 40,
    height: width - 40,
    borderRadius: 12,
  },
  modalCaption: {
    color: '#fff',
    fontSize: 16,
    marginTop: 16,
    textAlign: 'center',
  },
  modalDate: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    marginTop: 8,
  },
  deleteButton: {
    marginTop: 20,
    backgroundColor: 'rgba(255,59,48,0.2)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  deleteButtonText: {
    color: '#ff3b30',
    fontSize: 14,
    fontWeight: '500',
  },
});
