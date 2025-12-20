import React, { useState, useEffect } from 'react';
import { View, Text, Image, ScrollView, StyleSheet, Alert, TouchableOpacity } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../contexts/AuthContext';
import { momentsService } from '../services/momentsService';
import { Card, Heading, Subheading, Button, colors } from '../components/ui';

export const MomentsScreen = ({ onNavigate }) => {
  const { user, partnership } = useAuth();
  const [moments, setMoments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    console.log('[MOMENTS] Screen mounted');
    loadMoments();
    
    const subscription = momentsService.subscribeToMoments(
      partnership.id,
      (payload) => {
        console.log('[MOMENTS] Real-time update:', payload.eventType);
        loadMoments();
      }
    );

    return () => subscription?.unsubscribe();
  }, []);

  const loadMoments = async () => {
    console.log('[MOMENTS] loadMoments called');
    setLoading(true);
    try {
      const data = await momentsService.getMoments(partnership.id);
      console.log('[MOMENTS] Loaded:', data?.length || 0, 'moments');
      setMoments(data || []);
    } catch (err) {
      console.log('[MOMENTS] ERROR loading:', err);
    } finally {
      setLoading(false);
    }
  };

  const pickImage = async () => {
    Alert.alert(
      'Add Moment',
      'Choose a source',
      [
        { text: 'Camera', onPress: () => launchCamera() },
        { text: 'Photo Library', onPress: () => launchLibrary() },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  const launchCamera = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Camera access is required');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.7,
    });

    if (!result.canceled) {
      uploadImage(result.assets[0].uri);
    }
  };

  const launchLibrary = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Photo library access is required');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.7,
    });

    if (!result.canceled) {
      uploadImage(result.assets[0].uri);
    }
  };

  const uploadImage = async (uri) => {
    console.log('[MOMENTS] uploadImage called');
    setUploading(true);
    try {
      await momentsService.uploadMoment(partnership.id, user.id, uri);
      console.log('[MOMENTS] Upload successful');
      Alert.alert('Moment shared! 📸', 'Your partner can now see this photo.');
      loadMoments();
    } catch (err) {
      console.log('[MOMENTS] ERROR uploading:', err);
      Alert.alert('Error', err.message || 'Failed to upload photo');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = (moment) => {
    const isOwner = moment.user_id === user.id;
    
    Alert.alert(
      'Delete Moment',
      isOwner 
        ? 'Are you sure you want to delete this photo?'
        : 'This photo was shared by your partner. Are you sure you want to delete it?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            console.log('[MOMENTS] Deleting moment:', moment.id);
            try {
              await momentsService.deleteMoment(moment.id, moment.image_url);
              console.log('[MOMENTS] Deleted successfully');
              Alert.alert('Deleted', 'Photo has been removed.');
              loadMoments();
            } catch (err) {
              console.log('[MOMENTS] ERROR deleting:', err);
              Alert.alert('Error', 'Failed to delete photo');
            }
          },
        },
      ]
    );
  };

  return (
    <Card>
      <Heading>Moments</Heading>
      <Subheading>Share special moments with {partnership.partner.name}</Subheading>

      <Button title="📷 Add Moment" onPress={pickImage} loading={uploading} />

      <ScrollView style={styles.gallery} showsVerticalScrollIndicator={false}>
        {loading ? (
          <Text style={styles.loadingText}>Loading moments...</Text>
        ) : moments.length === 0 ? (
          <Text style={styles.emptyText}>No moments yet. Share your first photo! 📸</Text>
        ) : (
          <View style={styles.grid}>
            {moments.map((moment) => (
              <View key={moment.id} style={styles.momentContainer}>
                <Image source={{ uri: moment.image_url }} style={styles.momentImage} />
                <View style={styles.momentFooter}>
                  <Text style={styles.momentAuthor}>
                    {moment.user_id === user.id ? 'You' : partnership.partner.name}
                  </Text>
                  <TouchableOpacity onPress={() => handleDelete(moment)} style={styles.deleteBtn}>
                    <Text style={styles.deleteBtnText}>🗑️</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <Button title="🔄 Refresh" variant="outline" onPress={loadMoments} style={styles.refreshBtn} />
      <Button title="← Back" variant="secondary" onPress={() => onNavigate('home')} style={styles.backBtn} />
    </Card>
  );
};

const styles = StyleSheet.create({
  gallery: { maxHeight: 350, marginTop: 15 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  momentContainer: { width: '48%', marginBottom: 10 },
  momentImage: { width: '100%', height: 120, borderRadius: 10 },
  momentFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  momentAuthor: { fontSize: 12, color: '#999' },
  deleteBtn: { padding: 2 },
  deleteBtnText: { fontSize: 14 },
  loadingText: { textAlign: 'center', color: '#999', marginTop: 20 },
  emptyText: { textAlign: 'center', color: '#999', marginTop: 20, fontStyle: 'italic' },
  refreshBtn: { marginTop: 10 },
  backBtn: { marginTop: 10 },
});
