import React from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { Card, Heading, Subheading, Button, colors } from '../components/ui';

export const HomeScreen = ({ onNavigate }) => {
  const { profile, partnership, signOut } = useAuth();

  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure you want to logout?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Logout', style: 'destructive', onPress: signOut },
    ]);
  };

  return (
    <Card>
      <Heading>Hello, {profile?.name || 'there'}!</Heading>
      <Subheading>
        {partnership?.partner
          ? `Connected with ${partnership.partner.name} 💕`
          : 'What would you like to do today?'}
      </Subheading>

      <View style={styles.buttonGrid}>
        <Button
          title="🎯 Session"
          onPress={() => onNavigate('session')}
          style={styles.gridButton}
        />
        <Button
          title="🖼️ Moments"
          onPress={() => onNavigate('moments')}
          style={styles.gridButton}
        />
        <Button
          title="💓 Pulse"
          onPress={() => onNavigate('pulse')}
          style={styles.gridButton}
        />
        <Button
          title="📅 Plan"
          onPress={() => onNavigate('plan')}
          style={styles.gridButton}
        />
        <Button
          title="⭐ Upgrades"
          onPress={() => onNavigate('premium')}
          style={styles.gridButton}
        />
      </View>

      <Button
        title="🚪 Logout"
        variant="danger"
        onPress={handleLogout}
        style={styles.logoutButton}
      />
    </Card>
  );
};

const styles = StyleSheet.create({
  buttonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  gridButton: {
    width: '48%',
    marginBottom: 10,
  },
  logoutButton: {
    marginTop: 20,
  },
});
