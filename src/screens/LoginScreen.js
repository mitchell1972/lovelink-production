import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { authService } from '../services/authService';
import { Card, Heading, Subheading, Input, Button, colors } from '../components/ui';

export const LoginScreen = ({ onNavigate }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetMode, setResetMode] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    setLoading(true);
    try {
      await authService.signIn(email.trim(), password);
      // Auth state change will handle navigation
    } catch (err) {
      Alert.alert('Login Failed', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!email) {
      Alert.alert('Error', 'Please enter your email address');
      return;
    }

    setLoading(true);
    try {
      await authService.resetPassword(email.trim());
      Alert.alert(
        'Check Your Email 📧',
        'If an account exists with this email, you will receive a password reset link.',
        [{ text: 'OK', onPress: () => setResetMode(false) }]
      );
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setLoading(false);
    }
  };

  if (resetMode) {
    return (
      <Card>
        <Heading>Reset Password</Heading>
        <Subheading>Enter your email to receive a reset link</Subheading>

        <Input
          placeholder="Email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />

        <Button
          title="📧 Send Reset Link"
          onPress={handleResetPassword}
          loading={loading}
        />

        <Button
          title="← Back to Login"
          variant="secondary"
          onPress={() => setResetMode(false)}
          style={styles.backBtn}
        />
      </Card>
    );
  }

  return (
    <Card>
      <Heading>Welcome Back</Heading>
      <Subheading>Login to connect with your partner</Subheading>

      <Input
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
      />

      <Input
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />

      <Button
        title="Login"
        onPress={handleLogin}
        loading={loading}
      />

      <Button
        title="Forgot Password?"
        variant="outline"
        onPress={() => setResetMode(true)}
        style={styles.forgotBtn}
      />

      <View style={styles.footer}>
        <Text style={styles.footerText}>Don't have an account?</Text>
        <Button
          title="Sign Up"
          variant="secondary"
          onPress={() => onNavigate('signup')}
        />
      </View>
    </Card>
  );
};

const styles = StyleSheet.create({
  forgotBtn: {
    marginTop: 10,
  },
  backBtn: {
    marginTop: 10,
  },
  footer: {
    marginTop: 20,
    alignItems: 'center',
  },
  footerText: {
    color: colors.textLight,
    marginBottom: 10,
  },
});
