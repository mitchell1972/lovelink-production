import React from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Image } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

export const colors = {
  primary: '#6C63FF',
  secondary: '#A8A4FF',
  background: '#F5F5F5',
  white: '#FFFFFF',
  text: '#333333',
  textLight: '#666666',
  textMuted: '#999999',
  border: '#E0E0E0',
  success: '#4CAF50',
  error: '#FF5252',
  danger: '#FF5252',
};

export const GradientBackground = ({ children }) => (
  <LinearGradient
    colors={[colors.primary, colors.secondary]}
    style={styles.gradient}
  >
    {children}
  </LinearGradient>
);

export const Header = ({ title = 'LoveLink' }) => (
  <View style={styles.header}>
    <Text style={styles.headerText}>{title}</Text>
  </View>
);

export const LoadingScreen = ({ message = 'Loading...' }) => (
  <GradientBackground>
    <View style={styles.loadingContainer}>
      <ActivityIndicator size="large" color={colors.white} />
      <Text style={styles.loadingText}>{message}</Text>
    </View>
  </GradientBackground>
);

export const Card = ({ children, style }) => (
  <View style={[styles.card, style]}>
    {children}
  </View>
);

export const Heading = ({ children, style }) => (
  <Text style={[styles.heading, style]}>{children}</Text>
);

export const Subheading = ({ children, style }) => (
  <Text style={[styles.subheading, style]}>{children}</Text>
);

export const Input = ({ style, ...props }) => (
  <TextInput
    style={[styles.input, style]}
    placeholderTextColor={colors.textMuted}
    {...props}
  />
);

export const Button = ({ 
  title, 
  onPress, 
  variant = 'primary', 
  size = 'normal',
  loading = false, 
  disabled = false,
  style 
}) => {
  const buttonStyles = [
    styles.button,
    variant === 'primary' && styles.buttonPrimary,
    variant === 'secondary' && styles.buttonSecondary,
    variant === 'outline' && styles.buttonOutline,
    variant === 'danger' && styles.buttonDanger,
    size === 'small' && styles.buttonSmall,
    disabled && styles.buttonDisabled,
    style,
  ];

  const textStyles = [
    styles.buttonText,
    variant === 'primary' && styles.buttonTextPrimary,
    variant === 'secondary' && styles.buttonTextSecondary,
    variant === 'outline' && styles.buttonTextOutline,
    variant === 'danger' && styles.buttonTextDanger,
    size === 'small' && styles.buttonTextSmall,
  ];

  return (
    <TouchableOpacity
      style={buttonStyles}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.7}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'outline' ? colors.primary : colors.white} />
      ) : (
        <Text style={textStyles}>{title}</Text>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  gradient: {
    flex: 1,
  },
  header: {
    paddingTop: 60,
    paddingBottom: 20,
    alignItems: 'center',
  },
  headerText: {
    fontSize: 28,
    fontWeight: 'bold',
    color: colors.white,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 15,
    fontSize: 16,
    color: colors.white,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: 20,
    padding: 25,
    marginHorizontal: 20,
    marginVertical: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  heading: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 5,
  },
  subheading: {
    fontSize: 14,
    color: colors.textLight,
    marginBottom: 20,
  },
  input: {
    backgroundColor: colors.background,
    borderRadius: 10,
    padding: 15,
    fontSize: 16,
    marginBottom: 15,
    color: colors.text,
  },
  button: {
    borderRadius: 10,
    padding: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 5,
  },
  buttonPrimary: {
    backgroundColor: colors.primary,
  },
  buttonSecondary: {
    backgroundColor: colors.secondary,
  },
  buttonOutline: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: colors.primary,
  },
  buttonDanger: {
    backgroundColor: colors.danger,
  },
  buttonSmall: {
    padding: 10,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  buttonTextPrimary: {
    color: colors.white,
  },
  buttonTextSecondary: {
    color: colors.white,
  },
  buttonTextOutline: {
    color: colors.primary,
  },
  buttonTextDanger: {
    color: colors.white,
  },
  buttonTextSmall: {
    fontSize: 14,
  },
});
