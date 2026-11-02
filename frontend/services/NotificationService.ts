import { Platform, LogBox } from 'react-native';
import Constants from 'expo-constants';
import API from '../src/api/api';
import { router } from 'expo-router';

LogBox.ignoreLogs([
  'expo-notifications: Android Push notifications',
  'expo-notifications functionality is not fully supported',
]);

/** Expo Go (SDK 53+) cannot use remote push — skip those APIs entirely. */
const isExpoGo = Constants.appOwnership === 'expo';

type NotificationsModule = typeof import('expo-notifications');
let Notifications: NotificationsModule | null = null;

async function getNotifications(): Promise<NotificationsModule | null> {
  if (isExpoGo) return null;
  if (!Notifications) {
    Notifications = await import('expo-notifications');
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
        shouldSetBadge: true,
      }),
    });
  }
  return Notifications;
}

async function syncPushToken(token: string) {
  if (!token) return;
  try {
    await API.post('/users/update-token', { pushToken: token });
    console.log('✅ Push token synced with backend');
  } catch (error: any) {
    console.log('❌ Failed to sync push token:', error?.message || error);
  }
}

export function setupNotificationResponseListener() {
  if (isExpoGo) {
    return { remove: () => {} };
  }

  let subscription: { remove: () => void } | null = null;
  void getNotifications().then((Notifications) => {
    if (!Notifications) return;
    subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;
      console.log('Notification tapped:', data);
      if (data && data.type === 'emergency') {
        router.push({
          pathname: '/(tabs)/emergency',
          params: { fromNotification: 'true' },
        });
      }
    });
  });

  return {
    remove: () => subscription?.remove(),
  };
}

export async function registerForPushNotificationsAsync() {
  if (isExpoGo || Platform.OS === 'web') {
    console.log('⏭️ Push tokens skipped (Expo Go / web)');
    return null;
  }

  const Notifications = await getNotifications();
  if (!Notifications) return null;

  const Device = await import('expo-device');
  if (!Device.isDevice) return null;

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') return null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('emergency-channel', {
      name: 'Emergency Alerts',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF0000',
    });
  }

  try {
    const projectId =
      Constants?.expoConfig?.extra?.eas?.projectId || Constants?.easConfig?.projectId;
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    console.log('📱 Generated Push Token:', token);
    syncPushToken(token);
    return token;
  } catch (e) {
    console.log('Token error:', e);
    return null;
  }
}

export async function triggerLocalNotification(title: string, body: string) {
  try {
    const Notifications = await getNotifications();
    if (!Notifications) {
      console.log('🔔 Local notification (Expo Go stub):', title, body);
      return;
    }
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `🚨 ${title}`,
        body: body,
        data: { type: 'emergency' },
        priority: Notifications.AndroidNotificationPriority.MAX,
      },
      trigger: null,
    });
  } catch (error) {
    console.log('Local notification failed:', error);
  }
}
