import React, { useState } from 'react';
import { View, Alert, Keyboard } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { Card, Heading, Subheading, Input, Button } from '../components/ui';

export const SignUpScreen = ({ onSwitchToLogin }) => {
  const { signUp, loading } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSignUp = async () => {
    if (!name.trim() || !email.trim() || !password.trim()) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    if (password.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters');
      return;
    }

    Keyboard.dismiss();
    const result = await signUp(email.trim(), password, name.trim());

    if (result.success) {
      Alert.alert(
        'Account Created!',
        'Please check your email to verify your account, then log in.'
      );
      onSwitchToLogin?.();
    } else {
      Alert.alert('Sign Up Failed', result.error);
    }
  };

  return (
    <Card>
      <Heading>Create Your Account</Heading>
      <Subheading>Enter your details to join LoveLink</Subheading>

      <Input
        placeholder="Your name"
        value={name}
        onChangeText={setName}
        autoCapitalize="words"
      />

      <Input
        placeholder="Email address"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
      />

      <Input
        placeholder="Password (min 6 characters)"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />

      <Button
        title="Sign Up"
        onPress={handleSignUp}
        loading={loading}
      />

      <Button
        title="Already have an account? Log in"
        variant="secondary"
        onPress={onSwitchToLogin}
      />
    </Card>
  );
};
