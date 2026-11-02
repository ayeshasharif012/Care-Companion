import { Expo } from "expo-server-sdk";

const expo = new Expo();

export const sendPushNotification = async (pushToken, title, body, customData = {}) => {
  if (!pushToken || !Expo.isExpoPushToken(pushToken)) {
    return;
  }

  const messages = [
    {
      to: pushToken,
      sound: "default",
      title,
      body,
      priority: "high",
      data: { type: "emergency", screen: "emergency", ...customData },
    },
  ];

  try {
    const chunks = expo.chunkPushNotifications(messages);

    for (const chunk of chunks) {
      await expo.sendPushNotificationsAsync(chunk);
    }
  } catch (error) {
    console.error("❌ Notification Error:", error);
  }
};