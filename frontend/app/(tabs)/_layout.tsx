import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar, View } from "react-native";

export default function InternalLayout() {
  return (
    <SafeAreaProvider>
      <View style={{ flex: 1, backgroundColor: "#0A0826" }}>
        {/* StatusBar setting taake battery icons ke piche screen na jaye */}
        <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
        
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="dashboard" />
          <Stack.Screen name="emergency" />
          <Stack.Screen name="reminder" />
          <Stack.Screen name="ProfileScreen" />
          <Stack.Screen name="emotion_detection" />
          <Stack.Screen name="weekly-stats" />
        </Stack>
      </View>
    </SafeAreaProvider>
  );
}