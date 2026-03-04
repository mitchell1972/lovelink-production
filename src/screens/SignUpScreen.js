import React, { useState } from 'react';
import { View, Alert, Keyboard, Platform, InputAccessoryView, StyleSheet } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { Card, Heading, Subheading, Input, Button } from '../components/ui';

export const SignUpScreen = ({ onSwitchToLogin }) => {
  const { signUp, loading } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const signUpInputAccessoryViewId = 'signup-input-accessory';

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
        returnKeyType="done"
        blurOnSubmit
        onSubmitEditing={Keyboard.dismiss}
        inputAccessoryViewID={Platform.OS === 'ios' ? signUpInputAccessoryViewId : undefined}
      />

      <Input
        placeholder="Email address"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        returnKeyType="done"
        blurOnSubmit
        onSubmitEditing={Keyboard.dismiss}
        inputAccessoryViewID={Platform.OS === 'ios' ? signUpInputAccessoryViewId : undefined}
      />

      <Input
        placeholder="Password (min 6 characters)"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        returnKeyType="done"
        blurOnSubmit
        onSubmitEditing={handleSignUp}
        inputAccessoryViewID={Platform.OS === 'ios' ? signUpInputAccessoryViewId : undefined}
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

      {Platform.OS === 'ios' && (
        <InputAccessoryView nativeID={signUpInputAccessoryViewId}>
          <View style={styles.inputAccessory}>
            <Button title="Done" size="small" onPress={Keyboard.dismiss} />
          </View>
        </InputAccessoryView>
      )}
    </Card>
  );
};

const styles = StyleSheet.create({
  inputAccessory: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
    backgroundColor: '#F5F5F5',
    alignItems: 'flex-end',
  },
});
