import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { TranslationProvider } from '../src/TranslationContext'; 
import { LogBox } from 'react-native';
// notificationUtils ka path check kar lena agar folder structure different ho
import { setupNotificationResponseListener } from '../services/NotificationService'; 

// 🛠️ EXPO GO ERROR FIX
LogBox.ignoreLogs(['expo-notifications: Android Push notifications']);

export default function RootLayout() {
  
  useEffect(() => {
    // ✅ 1. Listener ko setup kiya
    const subscription = setupNotificationResponseListener();

    // ✅ 2. Cleanup function: Jab app reload ho ya memory se clear ho, 
    // purana listener remove kar do taake duplicate notifications na aain.
    return () => {
      if (subscription) {
        subscription.remove();
      }
    };
  }, []);

  return (
    <TranslationProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="auth/login" />
        <Stack.Screen name="trigger" /> 
        <Stack.Screen name="(tabs)" options={{ gestureEnabled: false }} />
      </Stack>
    </TranslationProvider>
  );
}