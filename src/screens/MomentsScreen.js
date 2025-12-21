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
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../contexts/AuthContext';
import { getMoments, uploadMoment, deleteMoment } from '../services/momentsService';
import { checkMomentsLimit, getPremiumStatus } from '../services/premiumService';

const { width } = Dimensions.get('window');
const imageSize = (width - 48) / 3;

export default function MomentsScreen({ onBack, onNavigate }) {
  const { user, profile } = useAuth();
  const [moments, setMoments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selectedMoment, setSelectedMoment] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [limitInfo, setLimitInfo] = useState(null);
  const [isPremium, setIsPremium] = useState(false);

  useEffect(() => {
    loadMoments();
    checkPremiumAndLimits();
  }, []);

  const checkPremiumAndLimits = async () => {
    if (!user) return;
    const status = await getPremiumStatus(user.id);
    setIsPremium(status.isPremium);
    const limits = await checkMomentsLimit(user.id);
    setLimitInfo(limits);
  };

  const loadMoments = async () => {
    if (!user || !profile?.partner_id) {
      setLoading(false);
      return;
    }
    
    try {
      const data = await getMoments(user.id, profile.partner_id);
      setMoments(data || []);
      await checkPremiumAndLimits();
    } catch (error) {
      console.error('Error loading moments:', error);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadMoments();
    setRefreshing(false);
  }, [user, profile]);

  const handleAddMoment = async () => {
    // Check limits first
    const limits = await checkMomentsLimit(user.id);
    
    if (!limits.allowed) {
      Alert.alert(
        '📸 Photo Limit Reached',
        `You've reached the ${limits.limit} photo limit on the free plan.\n\nUpgrade to Premium for unlimited photos!`,
        [
          { text: 'Maybe Later', style: 'cancel' },
          { 
            text: '💎 Go Premium', 
            onPress: () => onNavigate('Premium')
          },
        ]
      );
      return;
    }

    // Show remaining photos for free users
    if (!limits.isPremium && limits.limit !== Infinity) {
      const remaining = limits.limit - limits.current;
      if (remaining <= 3 && remaining > 0) {
        Alert.alert(
          '📸 Almost at Limit',
          `You have ${remaining} photo${remaining === 1 ? '' : 's'} left on the free plan.`,
          [{ text: 'OK' }]
        );
      }
    }

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow photo access to add moments.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      setUploading(true);
      try {
        const caption = await promptForCaption();
        const newMoment = await uploadMoment(
          user.id, 
          profile.partner_id,
          result.assets[0].uri,
          caption
        );
        if (newMoment) {
          setMoments(prev => [newMoment, ...prev]);
          await checkPremiumAndLimits();
        }
      } catch (error) {
        console.error('Upload error:', error);
        Alert.alert('Error', 'Failed to upload photo. Please try again.');
      } finally {
        setUploading(false);
      }
    }
  };

  const promptForCaption = () => {
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
      Alert.alert('Cannot Delete', "You can only delete your own photos.");
      return;
    }

    Alert.alert(
      'Delete Moment',
      'Are you sure you want to delete this photo?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteMoment(moment.id, moment.image_url);
              setMoments(prev => prev.filter(m => m.id !== moment.id));
              setSelectedMoment(null);
              await checkPremiumAndLimits();
            } catch (error) {
              Alert.alert('Error', 'Failed to delete photo.');
            }
          },
        },
      ]
    );
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
        onPress={() => onNavigate('Premium')}
      >
        <View style={styles.limitInfo}>
          <Text style={styles.limitText}>
            📸 {used}/{total} photos used
          </Text>
          <Text style={styles.limitUpgrade}>Upgrade for unlimited →</Text>
        </View>
        <View style={styles.limitBarContainer}>
          <View style={[styles.limitBar, { width: `${Math.min(percentage, 100)}%` }]} />
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <LinearGradient colors={['#667eea', '#764ba2']} style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#fff" />
        </View>
      </LinearGradient>
    );
  }

  if (!profile?.partner_id) {
    return (
      <LinearGradient colors={['#667eea', '#764ba2']} style={styles.container}>
        <View style={styles.noPartnerContainer}>
          <Text style={styles.noPartnerIcon}>🔗</Text>
          <Text style={styles.noPartnerText}>Connect with your partner first!</Text>
          <TouchableOpacity style={styles.backButton} onPress={onBack}>
            <Text style={styles.backButtonText}>← Back</Text>
          </TouchableOpacity>
        </View>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient colors={['#667eea', '#764ba2']} style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}>
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

      {/* Premium/Limit Banner */}
      {isPremium ? (
        <View style={styles.premiumBadge}>
          <Text style={styles.premiumBadgeText}>💎 Premium - Unlimited Photos</Text>
        </View>
      ) : (
        renderLimitBanner()
      )}

      {moments.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>📷</Text>
          <Text style={styles.emptyText}>No moments yet</Text>
          <Text style={styles.emptySubtext}>
            Tap + to add your first photo together!
          </Text>
        </View>
      ) : (
        <FlatList
          data={moments}
          renderItem={renderMoment}
          keyExtractor={(item) => item.id}
          numColumns={3}
          contentContainerStyle={styles.grid}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#fff"
            />
          }
        />
      )}

      {/* Full Image Modal */}
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
    </LinearGradient>
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
    paddingTop: 60,
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

  // Premium/Limit Banners
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

  // Grid
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

  // Empty State
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
  },

  // No Partner
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

  // Modal
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
