import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, Linking } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../config/supabase';
import { partnerService } from '../services/partnerService';
import { Card, Heading, Subheading, Input, Button, colors } from '../components/ui';

export const SettingsScreen = ({ onNavigate }) => {
  const { user, partnership, signOut } = useAuth();
  const [name, setName] = useState(user?.user_metadata?.name || '');
  const [loading, setLoading] = useState(false);
  const [linkCode, setLinkCode] = useState(null);
  const [loadingCode, setLoadingCode] = useState(false);

  // Load link code for all users
  useEffect(() => {
    if (user?.id) {
      loadLinkCode();
    }
  }, [user]);

  const loadLinkCode = async () => {
    setLoadingCode(true);
    try {
      const code = await partnerService.getActiveCode(user.id);
      setLinkCode(code);
    } catch (err) {
      console.error('Error loading link code:', err);
    } finally {
      setLoadingCode(false);
    }
  };

  const regenerateCode = () => {
    Alert.alert(
      '🔄 Generate New Code?',
      'This will invalidate your current code. If you already shared it with your partner, they will need the new code instead.',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Generate New', 
          onPress: async () => {
            setLoadingCode(true);
            try {
              const newCode = await partnerService.generateCode(user.id);
              setLinkCode(newCode);
              Alert.alert('Success ✅', 'New code generated! Share it with your partner.');
            } catch (err) {
              console.error('Error generating code:', err);
              Alert.alert('Error', 'Failed to generate new code');
            } finally {
              setLoadingCode(false);
            }
          }
        }
      ]
    );
  };

  const copyCodeToClipboard = async () => {
    if (linkCode?.code) {
      await Clipboard.setStringAsync(linkCode.code);
      Alert.alert('Copied! 📋', 'Your link code has been copied to clipboard');
    }
  };

  const handleUpdateName = async () => {
    if (!name.trim()) {
      Alert.alert('Error', 'Name cannot be empty');
      return;
    }

    setLoading(true);
    try {
      // Update auth metadata
      const { error: authError } = await supabase.auth.updateUser({
        data: { name: name.trim() }
      });
      
      if (authError) throw authError;

      // Update profiles table
      const { error: profileError } = await supabase
        .from('profiles')
        .update({ name: name.trim(), updated_at: new Date().toISOString() })
        .eq('id', user.id);

      if (profileError) throw profileError;

      Alert.alert('Success', 'Your name has been updated!');
    } catch (err) {
      console.error('Update name error:', err);
      Alert.alert('Error', err.message || 'Failed to update name');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Logout', 
          style: 'destructive',
          onPress: async () => {
            try {
              await signOut();
            } catch (err) {
              Alert.alert('Error', 'Failed to logout');
            }
          }
        },
      ]
    );
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      '⚠️ Delete Account',
      'This will permanently delete your account, all your data, moments, and partnership. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Forever',
          style: 'destructive',
          onPress: () => confirmDeleteAccount()
        }
      ]
    );
  };

  const confirmDeleteAccount = () => {
    Alert.alert(
      'Final Confirmation',
      'Are you ABSOLUTELY sure? All your data will be lost forever.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Yes, Delete My Account',
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              // Delete user data via database function
              const { error } = await supabase.rpc('delete_user_account');
              
              if (error) throw error;
              
              await signOut();
              Alert.alert('Account Deleted', 'Your account has been permanently deleted.');
            } catch (err) {
              console.error('Delete account error:', err);
              Alert.alert('Error', 'Failed to delete account. Please contact support.');
            } finally {
              setLoading(false);
            }
          }
        }
      ]
    );
  };

  const openPrivacyPolicy = () => {
    Linking.openURL('https://mitchell1972.github.io/lovelink-web/privacy.html');
  };

  const openTermsOfService = () => {
    Linking.openURL('https://mitchell1972.github.io/lovelink-web/terms.html');
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Card>
        <Heading>Settings</Heading>
        <Subheading>Manage your account</Subheading>

        {/* Profile Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>👤 Profile</Text>
          <Text style={styles.label}>Email</Text>
          <Text style={styles.emailText}>{user?.email}</Text>
          
          <Text style={styles.label}>Name</Text>
          <Input
            value={name}
            onChangeText={setName}
            placeholder="Your name"
          />
          <Button 
            title="Update Name" 
            onPress={handleUpdateName} 
            loading={loading}
            size="small"
          />
        </View>

        {/* Link Code Section - For all users */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🔗 Your Partner Code</Text>
          <Text style={styles.label}>Share this code with your partner to connect</Text>
          <View style={styles.codeContainer}>
            <Text style={styles.codeText}>
              {loadingCode ? 'Loading...' : linkCode?.code || 'N/A'}
            </Text>
            <Button 
              title="📋 Copy" 
              size="small" 
              onPress={copyCodeToClipboard}
              disabled={loadingCode || !linkCode?.code}
            />
          </View>
          {linkCode?.expires_at && (
            <Text style={styles.expiryText}>
              Expires: {new Date(linkCode.expires_at).toLocaleDateString()}
            </Text>
          )}
          <Button 
            title="🔄 Generate New Code" 
            variant="outline" 
            size="small"
            onPress={regenerateCode}
            loading={loadingCode}
            style={styles.regenerateBtn}
          />
          <Text style={styles.noteText}>
            ⚠️ Generating a new code will invalidate your current code.
          </Text>
        </View>

        {/* Partnership Section */}
        {partnership && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>💕 Partnership</Text>
            <Text style={styles.infoText}>
              Connected with: <Text style={styles.bold}>{partnership.partner?.name}</Text>
            </Text>
            <Text style={styles.infoText}>
              Since: {new Date(partnership.created_at).toLocaleDateString()}
            </Text>
          </View>
        )}

        {/* Legal Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>📋 Legal</Text>
          <Button 
            title="Privacy Policy" 
            variant="outline" 
            size="small"
            onPress={openPrivacyPolicy}
            style={styles.legalBtn}
          />
          <Button 
            title="Terms of Service" 
            variant="outline" 
            size="small"
            onPress={openTermsOfService}
            style={styles.legalBtn}
          />
        </View>

        {/* Account Actions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>⚙️ Account</Text>
          <Button 
            title="🚪 Logout" 
            variant="secondary" 
            onPress={handleLogout}
            style={styles.actionBtn}
          />
          <Button 
            title="🗑️ Delete Account" 
            variant="danger" 
            onPress={handleDeleteAccount}
            style={styles.actionBtn}
          />
        </View>

        <View style={styles.version}>
          <Text style={styles.versionText}>LoveLink v1.0.2</Text>
        </View>

        <Button 
          title="← Back" 
          variant="secondary" 
          onPress={() => onNavigate('home')} 
          style={styles.backBtn}
        />
      </Card>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    paddingVertical: 10,
  },
  section: {
    marginBottom: 25,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
    marginBottom: 12,
  },
  label: {
    fontSize: 14,
    color: '#666',
    marginBottom: 5,
  },
  emailText: {
    fontSize: 16,
    color: '#333',
    marginBottom: 15,
    backgroundColor: '#f5f5f5',
    padding: 12,
    borderRadius: 8,
  },
  infoText: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  bold: {
    fontWeight: '600',
    color: '#333',
  },
  legalBtn: {
    marginBottom: 8,
  },
  actionBtn: {
    marginBottom: 10,
  },
  version: {
    alignItems: 'center',
    marginVertical: 15,
  },
  versionText: {
    fontSize: 12,
    color: '#999',
  },
  backBtn: {
    marginTop: 10,
  },
  codeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F0F0FF',
    padding: 15,
    borderRadius: 12,
    marginVertical: 10,
  },
  codeText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.primary,
    letterSpacing: 2,
  },
  expiryText: {
    fontSize: 12,
    color: '#999',
    marginTop: 5,
  },
  regenerateBtn: {
    marginTop: 12,
  },
  noteText: {
    fontSize: 11,
    color: '#999',
    marginTop: 8,
    fontStyle: 'italic',
  },
});
