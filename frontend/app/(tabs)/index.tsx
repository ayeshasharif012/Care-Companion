import React from 'react';
import { 
  View, 
  Text, 
  TouchableOpacity, 
  StyleSheet, 
  SafeAreaView 
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';

export default function LandingScreen() {
  const router = useRouter();

  return (
    <LinearGradient
      colors={['#2E3192', '#1B1464']} 
      style={styles.container}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
    >
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.content}>
          
          <Text style={styles.appTitle}>
            Care Companion
          </Text>
          <Text style={styles.tagline}>
            AI-Enhanced Monitoring for Aged Care
          </Text>

          <View style={styles.buttonContainer}>
            {/* Login button */}
            <TouchableOpacity
              style={styles.loginButton}
              onPress={() => router.push("./auth/login")}
            >
              <Text style={styles.loginButtonText}>
                Log In
              </Text>
            </TouchableOpacity>

            {/* Registration button */}
            <TouchableOpacity
              style={styles.registerButton}
              onPress={() => router.push("../auth/register")}
            >
              <Text style={styles.registerButtonText}>
                Create New Account
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30,
  },
  appTitle: {
    fontSize: 48,
    fontWeight: '900',
    color: '#FFFFFF',
    marginBottom: 10,
    textShadowColor: 'rgba(0, 0, 0, 0.2)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  tagline: {
    fontSize: 18,
    color: 'rgba(255, 255, 255, 0.9)',
    marginBottom: 80,
    fontWeight: '600',
  },
  buttonContainer: {
    width: '100%',
    marginTop: 50,
  },
  loginButton: {
    backgroundColor: '#FFFFFF',
    padding: 18,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 8,
  },
  loginButtonText: {
    color: '#473F97',
    fontWeight: '800',
    fontSize: 18,
  },
  registerButton: {
    backgroundColor: 'transparent',
    padding: 18,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.6)',
  },
  registerButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 18,
  },
});