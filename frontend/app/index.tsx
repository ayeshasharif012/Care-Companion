import React, { useEffect } from 'react';
import { 
  View, 
  Text, 
  TouchableOpacity, 
  StyleSheet, 
  Platform, 
  Dimensions,
  Image 
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { MaterialCommunityIcons, Ionicons } from "@expo/vector-icons";

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function LandingScreen() {
  const router = useRouter();

  useEffect(() => {
    if (Platform.OS !== 'web') {
      registerNotifications();
    }
  }, []);

  const registerNotifications = async () => {
    try {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status === 'granted') {
        const token = await Notifications.getExpoPushTokenAsync({
          projectId: "d755f737-35c8-40ca-b5b2-caf2df1ec372"
        });
        console.log("Caregiver Token:", token.data);
      }
    } catch (error) {
      console.log("Notification setup error:", error);
    }
  };

  return (
    <LinearGradient
      colors={['#1B1464', '#2E3192', '#1B1464']}
      style={styles.container}
    >
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.content}>
          
          <View style={styles.heroSection}>
            <View style={styles.logoCircle}>
              <Image
                source={require('../assets/images/logo.png')}
                style={styles.logoImage}
                resizeMode="contain"
              />
            </View>
          </View>

          {/* Text Section */}
          <View style={styles.textSection}>
            <Text style={styles.appTitle}>Care Companion</Text>
            <View style={styles.divider} />
            <Text style={styles.tagline}>
              AI-Enhanced Monitoring & Secure Care for Your Loved Ones.
            </Text>
          </View>

          {/* Buttons Section */}
          <View style={styles.buttonContainer}>
            <TouchableOpacity
              activeOpacity={0.9}
              style={styles.loginButton}
              onPress={() => router.push("/auth/login")}
            >
              <Text style={styles.loginButtonText}>Get Started</Text>
              <Ionicons name="chevron-forward" size={20} color="#1B1464" />
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.7}
              style={styles.registerButton}
              onPress={() => router.push("/auth/register")}
            >
              <Text style={styles.registerButtonText}>Become a Caregiver</Text>
            </TouchableOpacity>
          </View>

          {/* Version / Security Footer */}
          <View style={styles.footer}>
            <Ionicons name="shield-checkmark" size={14} color="rgba(255,255,255,0.4)" />
            <Text style={styles.footerText}>Secure AI Monitoring • v1.0</Text>
          </View>

        </View>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  content: { flex: 1, padding: 30, justifyContent: 'space-between' },
  
  heroSection: { 
    height: SCREEN_HEIGHT * 0.4, 
    justifyContent: 'center', 
    alignItems: 'center' 
  },
  logoCircle: {
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  logoImage: {
    width: 150,
    height: 150,
  },

  textSection: { alignItems: 'center' },
  appTitle: { 
    fontSize: 38, 
    fontWeight: '900', 
    color: '#FFFFFF', 
    letterSpacing: -1,
    textAlign: 'center' 
  },
  divider: {
    width: 50,
    height: 4,
    backgroundColor: '#4FC3F7',
    borderRadius: 2,
    marginVertical: 15,
  },
  tagline: { 
    fontSize: 17, 
    color: 'rgba(255, 255, 255, 0.7)', 
    textAlign: 'center',
    lineHeight: 24,
    paddingHorizontal: 10
  },

  buttonContainer: { width: '100%', marginBottom: 20 },
  loginButton: { 
    backgroundColor: '#FFFFFF', 
    padding: 20, 
    borderRadius: 20, 
    flexDirection: 'row',
    justifyContent: 'center', 
    alignItems: 'center', 
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 15,
    elevation: 10 
  },
  loginButtonText: { 
    color: '#1B1464', 
    fontWeight: '800', 
    fontSize: 18,
    marginRight: 5
  },
  registerButton: { 
    padding: 18, 
    borderRadius: 20, 
    alignItems: 'center', 
    borderWidth: 1.5, 
    borderColor: 'rgba(255, 255, 255, 0.3)',
    backgroundColor: 'rgba(255, 255, 255, 0.05)'
  },
  registerButtonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 16 },

  footer: { 
    flexDirection: 'row', 
    justifyContent: 'center', 
    alignItems: 'center', 
    opacity: 0.5 
  },
  footerText: { 
    color: '#FFFFFF', 
    fontSize: 12, 
    marginLeft: 5,
    letterSpacing: 1
  },
});