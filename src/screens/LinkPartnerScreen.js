import React, { useState, useEffect } from 'react';
import { View, Text, Alert, Keyboard, StyleSheet } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useAuth } from '../contexts/AuthContext';
import { partnerService } from '../services/partnerService';
import { Card, Heading, Subheading, Input, Button, colors } from '../components/ui';

export const LinkPartnerScreen = () => {
  const { user, refreshPartnership, signOut } = useAuth();
  const [partnerCode, setPartnerCode] = useState('');
  const [myCode, setMyCode] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingCode, setLoadingCode] = useState(true);

  // Load or generate user's code on mount
  useEffect(() => {
    loadMyCode();
  }, []);

  const loadMyCode = async () => {
    try {
      setLoadingCode(true);
      const code = await partnerService.getActiveCode(user.id);
      setMyCode(code);
    } catch (err) {
      console.error('Error loading code:', err);
      Alert.alert('Error', 'Failed to generate partner code');
    } finally {
      setLoadingCode(false);
    }
  };

  const copyCodeToClipboard = async () => {
    if (myCode?.code) {
      await Clipboard.setStringAsync(myCode.code);
      Alert.alert('Copied!', 'Your link code has been copied to clipboard');
    }
  };

  const regenerateCode = async () => {
    try {
      setLoadingCode(true);
      const code = await partnerService.generateCode(user.id);
      setMyCode(code);
      Alert.alert('Success', 'New code generated!');
    } catch (err) {
      Alert.alert('Error', 'Failed to generate new code');
    } finally {
      setLoadingCode(false);
    }
  };

  const handleLinkPartner = async () => {
    if (!partnerCode.trim()) {
      Alert.alert('Error', "Please enter your partner's code");
      return;
    }

    Keyboard.dismiss();
    setLoading(true);

    try {
      const result = await partnerService.linkWithPartner(partnerCode.trim());

      if (result.success) {
        Alert.alert(
          result.already_linked ? 'Already Connected 💕' : 'Connected! 💕',
          result.already_linked
            ? 'You are already linked with this partner.'
            : 'You and your partner are now linked!'
        );
        await refreshPartnership();
      } else {
        Alert.alert('Error', result.error || 'Failed to link with partner');
      }
    } catch (err) {
      Alert.alert('Error', err.message || 'Failed to link with partner');
    } finally {
      setLoading(false);
    }
  };

  const formatCodeInput = (val) => {
    // Remove any non-alphanumeric except hyphen
    let cleaned = val.toUpperCase().replace(/[^A-Z0-9-]/g, '');
    // Auto-add hyphen after 4 characters
    if (cleaned.length === 5 && !cleaned.includes('-')) {
      cleaned = cleaned.slice(0, 4) + '-' + cleaned.slice(4);
    }
    setPartnerCode(cleaned);
  };

  return (
    <Card>
      <Heading>Link With Your Partner</Heading>
      <Subheading>
        Share your code with your partner and enter theirs to connect.
      </Subheading>

      {/* My Code Section */}
      <View style={styles.codeSection}>
        <Text style={styles.label}>Your Code:</Text>
        <View style={styles.codeRow}>
          <Text style={styles.codeText}>
            {loadingCode ? 'Loading...' : myCode?.code || 'N/A'}
          </Text>
          <Button
            title="📋 Copy"
            size="small"
            onPress={copyCodeToClipboard}
            disabled={loadingCode}
          />
        </View>
        <Button
          title="🔄 Generate New Code"
          variant="outline"
          size="small"
          onPress={regenerateCode}
          loading={loadingCode}
          style={styles.regenerateBtn}
        />
        {myCode?.expires_at && (
          <Text style={styles.expiryText}>
            Expires: {new Date(myCode.expires_at).toLocaleDateString()}
          </Text>
        )}
      </View>

      {/* Partner Code Input */}
      <View style={styles.inputSection}>
        <Text style={styles.label}>Enter Partner's Code:</Text>
        <Input
          placeholder="XXXX-XXXX"
          value={partnerCode}
          onChangeText={formatCodeInput}
          autoCapitalize="characters"
          maxLength={9}
        />
        <Button
          title="🔗 Link Partner"
          onPress={handleLinkPartner}
          loading={loading}
        />
      </View>

      {/* Logout */}
      <Button
        title="🚪 Logout"
        variant="danger"
        onPress={() => {
          Alert.alert('Logout', 'Are you sure?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Logout', style: 'destructive', onPress: signOut },
          ]);
        }}
        style={styles.logoutBtn}
      />
    </Card>
  );
};

const styles = StyleSheet.create({
  codeSection: {
    backgroundColor: '#F0F0FF',
    borderRadius: 12,
    padding: 15,
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textLight,
    marginBottom: 8,
  },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  codeText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.primary,
    letterSpacing: 2,
  },
  regenerateBtn: {
    marginTop: 10,
  },
  expiryText: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 8,
  },
  inputSection: {
    marginBottom: 10,
  },
  logoutBtn: {
    marginTop: 20,
  },
});
