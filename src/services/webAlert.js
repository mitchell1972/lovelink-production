import { Alert, Platform } from 'react-native';

const isWebRuntime = Platform.OS === 'web' && typeof window !== 'undefined';

const formatMessage = (title, message = '') => {
  return message ? `${title}\n\n${message}` : title;
};

export const showAlert = (title, message = '') => {
  if (isWebRuntime && typeof window.alert === 'function') {
    window.alert(formatMessage(title, message));
    return;
  }

  Alert.alert(title, message);
};

export const showConfirm = ({
  title,
  message = '',
  onConfirm,
  onCancel,
  confirmText = 'OK',
  cancelText = 'Cancel',
  destructive = false,
}) => {
  if (isWebRuntime && typeof window.confirm === 'function') {
    const accepted = window.confirm(formatMessage(title, message));
    if (accepted) {
      onConfirm?.();
    } else {
      onCancel?.();
    }
    return;
  }

  Alert.alert(title, message, [
    { text: cancelText, style: 'cancel', onPress: onCancel },
    {
      text: confirmText,
      style: destructive ? 'destructive' : 'default',
      onPress: onConfirm,
    },
  ]);
};

export const showUpgradePrompt = ({
  title,
  message = '',
  onUpgrade,
  upgradeText = 'Go Premium',
  cancelText = 'Maybe Later',
}) => {
  if (isWebRuntime && typeof window.confirm === 'function') {
    const accepted = window.confirm(formatMessage(title, message));
    if (accepted) {
      onUpgrade?.();
    }
    return;
  }

  Alert.alert(title, message, [
    { text: cancelText, style: 'cancel' },
    { text: upgradeText, onPress: onUpgrade },
  ]);
};
