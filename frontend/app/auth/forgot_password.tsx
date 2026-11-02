import React, { useState, useRef, useEffect } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, SafeAreaView, KeyboardAvoidingView,
  Platform, Dimensions, Animated,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import API from "../../src/api/api";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

export default function ForgotPasswordScreen() {
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const router = useRouter();
  const otpInputRef = useRef<TextInput>(null);

  useEffect(() => {
    fadeAnim.setValue(0);
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();

    if (step === 2) {
      setTimeout(() => otpInputRef.current?.focus(), 400);
    }
  }, [step]);

  const handleSendOTP = async () => {
    setError(""); setLoading(true);
    try {
      await API.post("/users/forgot-password", { email });
      setStep(2);
    } catch (err: any) {
      setError(err?.response?.data?.message || "User not found or network error");
    } finally { setLoading(false); }
  };

  const handleVerifyOTP = async () => {
    if (otp.length < 6) return setError("Please enter the full 6-digit code");
    setError(""); setLoading(true);
    try {
      await API.post("/users/verify-otp", { email, otp });
      setStep(3);
    } catch (err: any) {
      setError(err?.response?.data?.message || "Invalid verification code");
    } finally { setLoading(false); }
  };

  const handleResetPassword = async () => {
    if (password.length < 6) return setError("Password must be at least 6 characters");
    setError(""); setLoading(true);
    try {
      await API.post("/users/reset-password", { email, otp, password });
      setMessage("Password updated successfully!");
      setTimeout(() => router.push("/auth/login"), 2000);
    } catch (err: any) {
      setError(err?.response?.data?.message || "Failed to update password");
    } finally { setLoading(false); }
  };

  const renderOTPBoxes = () => (
    <View style={styles.otpRow}>
      {[0, 1, 2, 3, 4, 5].map((index) => (
        <View 
          key={index}
          style={[
            styles.otpBox, 
            otp.length === index && styles.otpBoxActive,
            otp[index] && styles.otpBoxFilled
          ]}
        >
          <Text style={styles.otpText}>{otp[index] || ""}</Text>
          {otp.length === index && <View style={styles.cursor} />}
        </View>
      ))}
    </View>
  );

  return (
    <LinearGradient colors={["#0F0B38", "#1B1464", "#2E3192"]} style={styles.background}>
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView 
          behavior={Platform.OS === "ios" ? "padding" : "height"} 
          style={styles.flex}
        >
          <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
            
            <View style={styles.headerWrap}>
              <View style={styles.iconCircle}>
                 <MaterialCommunityIcons 
                    name={step === 1 ? "lock-open-outline" : step === 2 ? "email-check-outline" : "form-textbox-password"} 
                    size={38} color="white" 
                 />
              </View>
              <Text style={styles.title}>
                {step === 1 ? "Reset Password" : step === 2 ? "Verify OTP" : "New Password"}
              </Text>
              <Text style={styles.subtitle}>
                {step === 1 ? "Enter your email to receive a recovery code." : 
                 step === 2 ? `We've sent a 6-digit code to\n${email}` : 
                 "Set a strong password for your account."}
              </Text>
            </View>

            <View style={styles.glassCard}>
              {error ? <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View> : null}
              {message ? <View style={styles.successBox}><Text style={styles.successText}>{message}</Text></View> : null}

              {step === 1 && (
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Email Address</Text>
                  <View style={styles.inputBox}>
                    <Ionicons name="mail-outline" size={20} color="rgba(255,255,255,0.4)" />
                    <TextInput
                      style={styles.textInput}
                      placeholder="name@example.com"
                      placeholderTextColor="rgba(255,255,255,0.2)"
                      value={email}
                      onChangeText={setEmail}
                      keyboardType="email-address"
                      autoCapitalize="none"
                    />
                  </View>
                </View>
              )}

              {step === 2 && (
                <View style={styles.otpSection}>
                  <TouchableOpacity activeOpacity={1} onPress={() => otpInputRef.current?.focus()}>
                    {renderOTPBoxes()}
                  </TouchableOpacity>
                  <TextInput
                    ref={otpInputRef}
                    style={styles.hiddenInput}
                    value={otp}
                    onChangeText={(v) => /^\d*$/.test(v) && v.length <= 6 && setOtp(v)}
                    keyboardType="number-pad"
                    maxLength={6}
                  />
                  <View style={styles.resendRow}>
                    <Text style={styles.resendText}>Didn't get the code?</Text>
                    <TouchableOpacity onPress={handleSendOTP}>
                        <Text style={styles.resendLink}> Resend</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {step === 3 && (
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>New Password</Text>
                  <View style={styles.inputBox}>
                    <Ionicons name="lock-closed-outline" size={20} color="rgba(255,255,255,0.4)" />
                    <TextInput
                      style={styles.textInput}
                      placeholder="Min. 6 characters"
                      placeholderTextColor="rgba(255,255,255,0.2)"
                      secureTextEntry
                      value={password}
                      onChangeText={setPassword}
                    />
                  </View>
                </View>
              )}

              <TouchableOpacity 
                style={[styles.primaryButton, loading && styles.buttonDisabled]} 
                onPress={step === 1 ? handleSendOTP : step === 2 ? handleVerifyOTP : handleResetPassword}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#1B1464" />
                ) : (
                  <>
                    <Text style={styles.buttonText}>
                        {step === 1 ? "Send Code" : step === 2 ? "Verify Code" : "Update Password"}
                    </Text>
                    <Ionicons name="arrow-forward" size={18} color="#1B1464" style={{marginLeft: 8}} />
                  </>
                )}
              </TouchableOpacity>
            </View>

            <TouchableOpacity onPress={() => router.push("/auth/login")} style={styles.loginFooter}>
              <Text style={styles.footerText}>Back to <Text style={styles.footerBold}>Sign In</Text></Text>
            </TouchableOpacity>
          </Animated.View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  background: { flex: 1 },
  safeArea: { flex: 1 },
  flex: { flex: 1 },
  container: { flex: 1, paddingHorizontal: 24, justifyContent: "center" },
  headerWrap: { marginBottom: 35, alignItems: 'center' },
  iconCircle: { width: 75, height: 75, borderRadius: 25, backgroundColor: 'rgba(255,255,255,0.05)', justifyContent: 'center', alignItems: 'center', marginBottom: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  title: { fontSize: 28, fontWeight: "800", color: "white", textAlign: 'center' },
  subtitle: { fontSize: 15, color: "rgba(255,255,255,0.5)", marginTop: 10, textAlign: 'center', lineHeight: 22, paddingHorizontal: 20 },
  glassCard: { 
    backgroundColor: "rgba(255,255,255,0.04)", 
    borderRadius: 30, 
    padding: 24, 
    borderWidth: 1, 
    borderColor: "rgba(255,255,255,0.08)",
  },
  inputGroup: { marginBottom: 20 },
  inputLabel: { color: 'rgba(255,255,255,0.7)', marginBottom: 10, fontSize: 13, fontWeight: '600', marginLeft: 4 },
  inputBox: { 
    flexDirection: "row", 
    alignItems: "center", 
    backgroundColor: "rgba(0,0,0,0.25)", 
    borderRadius: 16, 
    paddingHorizontal: 16, 
    height: 60, 
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)'
  },
  textInput: { flex: 1, color: "white", fontSize: 16, marginLeft: 12 },
  otpSection: { width: '100%', alignItems: 'center' },
  otpRow: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginBottom: 15 },
  otpBox: { 
    width: (SCREEN_WIDTH - 110) / 6, 
    height: 60, 
    borderRadius: 12, 
    backgroundColor: "rgba(0,0,0,0.3)", 
    borderWidth: 1, 
    borderColor: "rgba(255,255,255,0.1)",
    justifyContent: 'center', 
    alignItems: 'center',
  },
  otpBoxActive: { borderColor: '#4FC3F7', backgroundColor: "rgba(79, 195, 247, 0.05)", borderWidth: 2 },
  otpBoxFilled: { borderColor: "rgba(255,255,255,0.3)" },
  otpText: { color: 'white', fontSize: 22, fontWeight: '700' },
  cursor: { width: 2, height: 20, backgroundColor: '#4FC3F7', position: 'absolute' },
  hiddenInput: { position: 'absolute', opacity: 0 },
  resendRow: { flexDirection: 'row', marginTop: 20, marginBottom: 15 },
  resendText: { color: 'rgba(255,255,255,0.4)', fontSize: 13 },
  resendLink: { color: '#4FC3F7', fontWeight: '700' },
  primaryButton: { 
    backgroundColor: "white", 
    height: 58, 
    borderRadius: 16, 
    flexDirection: 'row',
    justifyContent: "center", 
    alignItems: "center",
    marginTop: 10,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "#1B1464", fontSize: 16, fontWeight: "800" },
  errorBox: { backgroundColor: 'rgba(255, 82, 82, 0.1)', padding: 12, borderRadius: 12, marginBottom: 20 },
  errorText: { color: '#FF8A80', textAlign: 'center', fontSize: 13 },
  successBox: { backgroundColor: 'rgba(76, 175, 80, 0.1)', padding: 12, borderRadius: 12, marginBottom: 20 },
  successText: { color: '#81C784', textAlign: 'center', fontSize: 13 },
  loginFooter: { marginTop: 30, alignItems: 'center' },
  footerText: { color: 'rgba(255,255,255,0.4)', fontSize: 14 },
  footerBold: { color: 'white', fontWeight: 'bold' }
});