import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
  Image,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { API_URL, IOT_CONTROLLER_URL } from "../../config";
import { Ionicons } from "@expo/vector-icons";
import API from "../../src/api/api";
import AsyncStorage from "@react-native-async-storage/async-storage";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const router = useRouter();

  const handleLogin = async () => {
    setErrorMessage("");
    setSuccessMessage("");

    if (!email.trim() || !password.trim()) {
      setErrorMessage("Please fill all fields");
      return;
    }

    setLoading(true);

    try {
      const { data } = await API.post("/users/login", {
        email: email.trim().toLowerCase(),
        password: password.trim(),
      });

      console.log("LOGIN RESPONSE TOKEN:", data?.token);
      console.log("LOGGED IN USER ID:", data?.user?._id);

      // ✅ OPTIMIZATION: Single write, trust multiSet (removes redundant re-read)
      await AsyncStorage.multiSet([
        ["token", data.token],
        ["userId", data.user._id],
        ["userName", data.user.name],
        ["user", JSON.stringify(data.user)],
      ]);

      try {
        const { data: comp } = await API.get("/companion/me");
        if (comp?.language) {
          await AsyncStorage.setItem("companionLanguage", comp.language.toLowerCase().includes("urdu") ? "urdu" : "english");
        }
      } catch {
        /* companion optional at login */
      }
      console.log("✅ Auth data saved");

      // ✅ FIX: Fire-and-forget IoT sync with 1s timeout (non-blocking, fast fail)
      Promise.race([
        fetch(`${IOT_CONTROLLER_URL}/set-user`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: data.user._id }),
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('timeout')), 1000)
        ),
      ])
      .then(() => console.log("✅ IoT synced"))
      .catch((err) => console.log("⏭️ IoT skipped:", err?.message));

      setSuccessMessage("Login Successful! Redirecting...");

      setTimeout(() => {
        setLoading(false);
        router.replace("/(tabs)/dashboard");
      }, 1200);
    } catch (err: any) {
      const isNetwork =
        err?.message === "Network Error" || err?.code === "ECONNABORTED";
      console.log("LOGIN ERROR:", err?.response?.data || err?.message);
      console.log("LOGIN TARGET:", API_URL);

      setLoading(false);
      setErrorMessage(
        isNetwork
          ? `Cannot reach server at ${API_URL}. Is Node running on port 5000?`
          : err?.response?.data?.message || "Invalid email or password"
      );
    }
  };

  return (
    <LinearGradient
      colors={["#1B1464", "#2E3192", "#1B1464"]}
      style={styles.background}
    >
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.flex}
        >
          <View style={styles.container}>
            <View style={styles.headerWrap}>
              <View style={styles.logoCircle}>
                <Image
                  source={require('../../assets/images/logo.png')}
                  style={styles.logoImageSmall}
                  resizeMode="contain"
                />
              </View>
              <Text style={styles.title}>Welcome Back</Text>
              <Text style={styles.subtitle}>
                Sign in to continue your care journey
              </Text>
            </View>

            {successMessage ? (
              <View style={styles.successBox}>
                <Ionicons
                  name="checkmark-circle"
                  size={18}
                  color="#81C784"
                />
                <Text style={styles.successText}>{successMessage}</Text>
              </View>
            ) : null}

            {errorMessage ? (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={18} color="#FF8A80" />
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            ) : null}

            <View style={styles.glassCard}>
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Email Address</Text>
                <View style={styles.inputBox}>
                  <Ionicons
                    name="mail-outline"
                    size={20}
                    color="rgba(255,255,255,0.5)"
                  />
                  <TextInput
                    style={styles.textInput}
                    placeholder="name@example.com"
                    placeholderTextColor="rgba(255,255,255,0.3)"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="email"
                    textContentType="emailAddress"
                    value={email}
                    onChangeText={setEmail}
                  />
                </View>
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Password</Text>
                <View style={styles.inputBox}>
                  <Ionicons
                    name="lock-closed-outline"
                    size={20}
                    color="rgba(255,255,255,0.5)"
                  />
                  <TextInput
                    style={styles.textInput}
                    placeholder="••••••••"
                    placeholderTextColor="rgba(255,255,255,0.3)"
                    secureTextEntry={!showPassword}
                    value={password}
                    onChangeText={setPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="password"
                    textContentType="password"
                  />
                  <TouchableOpacity
                    onPress={() => setShowPassword(!showPassword)}
                  >
                    <Ionicons
                      name={showPassword ? "eye-off-outline" : "eye-outline"}
                      size={20}
                      color="rgba(255,255,255,0.5)"
                    />
                  </TouchableOpacity>
                </View>
              </View>

              <TouchableOpacity
                style={[styles.primaryButton, loading && styles.buttonDisabled]}
                onPress={handleLogin}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#1B1464" />
                ) : (
                  <>
                    <Text style={styles.buttonText}>Sign In</Text>
                    <Ionicons
                      name="log-in-outline"
                      size={22}
                      color="#1B1464"
                      style={{ marginLeft: 8 }}
                    />
                  </>
                )}
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              onPress={() => router.push("./forgot_password")}
              style={styles.forgotBtn}
            >
              <Text style={styles.forgotText}>Forgot Password?</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => router.push("./register")}
              style={styles.footer}
            >
              <Text style={styles.footerBase}>
                Don't have an account?{" "}
                <Text style={styles.footerBold}>Register</Text>
              </Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  background: { flex: 1 },
  safeArea: { flex: 1 },
  flex: { flex: 1 },
  container: { flex: 1, paddingHorizontal: 25, justifyContent: "center" },

  headerWrap: {
    marginBottom: 30,
    alignItems: "center",
  },

  logoCircle: {
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: "white",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
    overflow: "hidden",
  },
  logoImageSmall: {
    width: 150,
    height: 150,
  },

  title: {
    fontSize: 32,
    fontWeight: "800",
    color: "white",
  },

  subtitle: {
    fontSize: 16,
    color: "rgba(255,255,255,0.6)",
    marginTop: 8,
    textAlign: "center",
  },

  glassCard: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 30,
    padding: 24,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },

  inputContainer: {
    marginBottom: 20,
  },

  inputLabel: {
    color: "white",
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 10,
    marginLeft: 4,
  },

  inputBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.2)",
    borderRadius: 16,
    paddingHorizontal: 16,
    height: 60,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    overflow: "hidden",
  },

  textInput: {
    flex: 1,
    color: "white",
    fontSize: 16,
    marginLeft: 12,
    paddingVertical: 0,
    includeFontPadding: false,
    textAlignVertical: "center",
  },

  primaryButton: {
    backgroundColor: "white",
    height: 60,
    borderRadius: 18,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginTop: 10,
    elevation: 5,
  },

  buttonDisabled: {
    opacity: 0.8,
  },

  buttonText: {
    color: "#1B1464",
    fontSize: 18,
    fontWeight: "800",
  },

  successBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(129, 199, 132, 0.1)",
    padding: 12,
    borderRadius: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "rgba(129, 199, 132, 0.3)",
  },

  successText: {
    color: "#81C784",
    fontSize: 14,
    fontWeight: "600",
    marginLeft: 8,
  },

  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 82, 82, 0.1)",
    padding: 12,
    borderRadius: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "rgba(255, 82, 82, 0.3)",
  },

  errorText: {
    color: "#FF8A80",
    fontSize: 14,
    fontWeight: "600",
    marginLeft: 8,
  },

  forgotBtn: {
    marginTop: 20,
    alignSelf: "center",
  },

  forgotText: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 15,
    fontWeight: "600",
    textDecorationLine: "underline",
  },

  footer: {
    marginTop: 30,
    alignItems: "center",
  },

  footerBase: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 15,
  },

  footerBold: {
    color: "white",
    fontWeight: "bold",
  },
});