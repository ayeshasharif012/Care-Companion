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
  ScrollView,
  StatusBar,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import API from "../../src/api/api";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { IOT_CONTROLLER_URL } from "../../config";

export default function RegisterScreen() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const router = useRouter();

  const normalizePK = (raw: string) => {
    if (!raw) return null;
    let digits = raw.replace(/\D/g, "");
    if (digits.startsWith("00")) digits = digits.slice(2);
    if (digits.startsWith("92")) digits = digits.slice(2);
    if (digits.startsWith("0")) digits = digits.slice(1);
    if (digits.length === 10 && digits.startsWith("3")) return `+92${digits}`;
    return null;
  };

  const handleRegister = async () => {
    setSuccessMessage("");
    setErrorMessage("");

    if (!name || !email || !mobile || !password || !confirmPassword) {
      setErrorMessage("Please fill all fields");
      return;
    }

    if (password.length < 6) {
      setErrorMessage("Password must be at least 6 characters");
      return;
    }

    if (confirmPassword.length < 6) {
      setErrorMessage("Confirm password must be at least 6 characters");
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage("Passwords do not match");
      return;
    }

    const normalizedMobile = normalizePK(mobile);
    if (!normalizedMobile) {
      setErrorMessage("Invalid mobile format (e.g. 03XXXXXXXXX)");
      return;
    }

    setLoading(true);
    try {
      const { data } = await API.post("/users/register", {
        name,
        email,
        password,
        mobile: normalizedMobile,
      });

      await AsyncStorage.multiSet([
        ["token", data.token],
        ["userId", data.user._id],
        ["userName", data.user.name],
        ["userEmail", data.user.email],
      ]);

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

      setSuccessMessage("Registration Successful!");

      setTimeout(() => {
        setLoading(false);
        router.push("./CompanionProfileScreen");
      }, 1200);
    } catch (err: any) {
      setLoading(false);
      setErrorMessage(err?.response?.data?.message || "Registration failed");
    }
  };

  return (
    <LinearGradient colors={["#1B1464", "#2E3192", "#1B1464"]} style={styles.background}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.flex}
        >
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            bounces={false}
          >
            <View style={styles.headerWrap}>
              <Text style={styles.title}>Create Account</Text>
              <Text style={styles.subtitle}>Start your journey as a Caregiver</Text>
            </View>

            {successMessage || errorMessage ? (
              <View style={[styles.statusBox, errorMessage ? styles.errorBg : styles.successBg]}>
                <Ionicons
                  name={errorMessage ? "alert-circle" : "checkmark-circle"}
                  size={16}
                  color={errorMessage ? "#FF8A80" : "#81C784"}
                />
                <Text
                  style={[
                    styles.statusText,
                    { color: errorMessage ? "#FF8A80" : "#81C784" },
                  ]}
                >
                  {errorMessage || successMessage}
                </Text>
              </View>
            ) : null}

            <View style={styles.glassCard}>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Full Name</Text>
                <View style={styles.inputBox}>
                  <Ionicons name="person-outline" size={16} color="rgba(255,255,255,0.5)" />
                  <TextInput
                    style={styles.textInput}
                    placeholder="Full Name"
                    placeholderTextColor="rgba(255, 255, 255, 0.4)"
                    value={name}
                    onChangeText={setName}
                  />
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Email</Text>
                <View style={styles.inputBox}>
                  <Ionicons name="mail-outline" size={16} color="rgba(255,255,255,0.5)" />
                  <TextInput
                    style={styles.textInput}
                    placeholder="Email"
                    placeholderTextColor="rgba(255, 255, 255, 0.4)"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    value={email}
                    onChangeText={setEmail}
                  />
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Mobile</Text>
                <View style={styles.inputBox}>
                  <Ionicons name="call-outline" size={16} color="rgba(255,255,255,0.5)" />
                  <TextInput
                    style={styles.textInput}
                    placeholder="03XXXXXXXXX"
                    placeholderTextColor="rgba(255, 255, 255, 0.4)"
                    keyboardType="phone-pad"
                    value={mobile}
                    onChangeText={setMobile}
                  />
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Password</Text>
                <View style={styles.inputBox}>
                  <Ionicons name="lock-closed-outline" size={16} color="rgba(255,255,255,0.5)" />
                  <TextInput
                    style={styles.textInput}
                    placeholder="Password"
                    placeholderTextColor="rgba(255, 255, 255, 0.4)"
                    secureTextEntry={!showPassword}
                    value={password}
                    onChangeText={setPassword}
                  />
                  <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
                    <Ionicons
                      name={showPassword ? "eye-off" : "eye"}
                      size={16}
                      color="rgba(255,255,255,0.5)"
                    />
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Confirm Password</Text>
                <View style={styles.inputBox}>
                  <Ionicons
                    name="shield-checkmark-outline"
                    size={16}
                    color="rgba(255,255,255,0.5)"
                  />
                  <TextInput
                    style={styles.textInput}
                    placeholder="Confirm Password"
                    placeholderTextColor="rgba(255, 255, 255, 0.4)"
                    secureTextEntry={true}
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                  />
                </View>
              </View>

              <TouchableOpacity
                style={[styles.primaryButton, loading && styles.buttonDisabled]}
                onPress={handleRegister}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#1B1464" />
                ) : (
                  <Text style={styles.buttonText}>Create Account</Text>
                )}
              </TouchableOpacity>
            </View>

            <TouchableOpacity onPress={() => router.push("./login")} style={styles.footer}>
              <Text style={styles.footerBase}>
                Already have an account? <Text style={styles.footerBold}>Log In</Text>
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  background: { flex: 1 },
  safeArea: {
    flex: 1,
    paddingTop: Platform.OS === "android" ? StatusBar.currentHeight || 0 : 0,
  },
  flex: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 25,
    paddingTop: 10,
    flexGrow: 1,
    justifyContent: "center",
  },
  headerWrap: { marginBottom: 15 },
  title: { fontSize: 26, fontWeight: "800", color: "white" },
  subtitle: { fontSize: 13, color: "rgba(255,255,255,0.6)", marginTop: 2 },
  glassCard: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 20,
    padding: 15,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  inputGroup: { marginBottom: 10 },
  inputLabel: {
    color: "white",
    fontSize: 11,
    fontWeight: "600",
    marginBottom: 4,
    marginLeft: 4,
  },
  inputBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.2)",
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 46,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  textInput: { flex: 1, color: "white", fontSize: 14, marginLeft: 8 },
  primaryButton: {
    backgroundColor: "white",
    height: 48,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 12,
  },
  buttonDisabled: { opacity: 0.8 },
  buttonText: { color: "#1B1464", fontSize: 16, fontWeight: "800" },
  statusBox: {
    flexDirection: "row",
    alignItems: "center",
    padding: 8,
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 1,
  },
  errorBg: {
    backgroundColor: "rgba(255, 82, 82, 0.1)",
    borderColor: "rgba(255, 82, 82, 0.3)",
  },
  successBg: {
    backgroundColor: "rgba(129, 199, 132, 0.1)",
    borderColor: "rgba(129, 199, 132, 0.3)",
  },
  statusText: { fontSize: 12, fontWeight: "600", marginLeft: 8 },
  footer: { marginTop: 15, marginBottom: 10, alignItems: "center" },
  footerBase: { color: "rgba(255,255,255,0.5)", fontSize: 14 },
  footerBold: { color: "white", fontWeight: "bold" },
});