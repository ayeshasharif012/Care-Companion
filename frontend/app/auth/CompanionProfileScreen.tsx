import React, { useState, useEffect } from "react";
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
  Alert,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import API from "../../src/api/api";
import { IOT_CONTROLLER_URL } from "../../config";
import { Picker } from "@react-native-picker/picker";
import { Ionicons } from "@expo/vector-icons";

export default function CompanionProfileScreen() {
  const router = useRouter();

  // Form State
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("Male");
  const [language, setLanguage] = useState("English");
  const [medicalNotes, setMedicalNotes] = useState("");

  // UI State
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  // Session Check
  useEffect(() => {
    const checkAuth = async () => {
      const token = await AsyncStorage.getItem("token");
      if (!token) {
        Alert.alert("Session Expired", "Please login again to continue.");
        router.replace("./login");
      }
    };
    checkAuth();
  }, []);

  const handleSubmit = async () => {
    setErrorMessage("");
    setSuccessMessage("");

    // Basic Validation
    if (!name.trim() || !language) {
      setErrorMessage("Companion name and language are required.");
      return;
    }

    setLoading(true);
    try {
      const token = await AsyncStorage.getItem("token");
      const normalizedLanguage =
        String(language).toLowerCase().includes("urdu") ? "urdu" : "english";

      const payload = {
        name: name.trim(),
        age: age ? parseInt(age) : undefined,
        gender,
        language: normalizedLanguage,
        medicalNotes: medicalNotes.trim(),
      };

      const response = await API.post("/companion", payload, {
        headers: { 
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
      });

      if (response.status === 201) {
        setSuccessMessage("Companion profile saved successfully!");
        
        // ✅ FIX: Fire-and-forget IoT sync with 3s timeout (non-blocking)
        AsyncStorage.getItem("userId").then((userId) => {
          if (userId) {
            Promise.race([
              fetch(`${IOT_CONTROLLER_URL}/set-user`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId }),
              }),
              new Promise((_, reject) => 
                setTimeout(() => reject(new Error('timeout')), 1000)
              ),
            ])
            .then(() => console.log("✅ IoT synced"))
            .catch((err) => console.log("⏭️ IoT skipped:", err?.message));
          }
        });
        
        setTimeout(() => {
          setLoading(false);
          router.replace("/(tabs)/dashboard");
        }, 1500);
      }
    } catch (err: any) {
      setLoading(false);
      const msg = err?.response?.data?.message || "Failed to save companion info";
      setErrorMessage(msg);
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
            {/* Header Section */}
            <View style={styles.headerWrap}>
              <Text style={styles.title}>Companion Details</Text>
              <Text style={styles.subtitle}>Who are you caring for?</Text>
            </View>

            {/* Status Feedback */}
            {(successMessage || errorMessage) ? (
              <View style={[styles.statusBox, errorMessage ? styles.errorBg : styles.successBg]}>
                <Ionicons 
                  name={errorMessage ? "alert-circle" : "checkmark-circle"} 
                  size={16} 
                  color={errorMessage ? "#FF8A80" : "#81C784"} 
                />
                <Text style={[styles.statusText, { color: errorMessage ? "#FF8A80" : "#81C784" }]}>
                  {errorMessage || successMessage}
                </Text>
              </View>
            ) : null}

            {/* Profile Form Card */}
            <View style={styles.glassCard}>
              
              {/* Full Name */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Full Name</Text>
                <View style={styles.inputBox}>
                  <Ionicons name="person-outline" size={16} color="rgba(255,255,255,0.5)" />
                  <TextInput
                    style={styles.textInput}
                    placeholder="Full Name (Required)"
                    placeholderTextColor="rgba(255,255,255,0.5)"
                    value={name}
                    onChangeText={setName}
                  />
                </View>
              </View>

              {/* Age */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Age</Text>
                <View style={styles.inputBox}>
                  <Ionicons name="calendar-outline" size={16} color="rgba(255,255,255,0.5)" />
                  <TextInput
                    style={styles.textInput}
                    placeholder="Age"
                    placeholderTextColor="rgba(255,255,255,0.5)"
                    keyboardType="numeric"
                    value={age}
                    onChangeText={setAge}
                  />
                </View>
              </View>

              {/* Gender Selection */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Gender</Text>
                <View style={styles.pickerContainer}>
                  <Picker
                    selectedValue={gender}
                    style={styles.picker}
                    dropdownIconColor="#FFF"
                    onValueChange={(value) => setGender(value)}
                  >
                    <Picker.Item label="Male" value="Male" />
                    <Picker.Item label="Female" value="Female" />
                    <Picker.Item label="Other" value="Other" />
                  </Picker>
                </View>
              </View>

              {/* Language Selection */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Preferred Language</Text>
                <View style={styles.pickerContainer}>
                  <Picker
                    selectedValue={language}
                    style={styles.picker}
                    dropdownIconColor="#FFF"
                    onValueChange={(value) => setLanguage(value)}
                  >
                    <Picker.Item label="English" value="English" />
                    <Picker.Item label="Urdu" value="Urdu" />
                  </Picker>
                </View>
              </View>

              {/* Medical Information */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Medical Notes</Text>
                <View style={[styles.inputBox, { height: 80, alignItems: 'flex-start', paddingTop: 10 }]}>
                  <TextInput
                    style={[styles.textInput, { textAlignVertical: 'top' }]}
                    placeholder="Chronic illnesses, allergies, etc."
                    placeholderTextColor="rgba(255,255,255,0.5)"
                    value={medicalNotes}
                    onChangeText={setMedicalNotes}
                    multiline
                  />
                </View>
              </View>

              <TouchableOpacity 
                style={[styles.primaryButton, loading && styles.buttonDisabled]} 
                onPress={handleSubmit} 
                disabled={loading}
              >
                {loading ? <ActivityIndicator color="#1B1464" /> : <Text style={styles.buttonText}>Finish Setup</Text>}
              </TouchableOpacity>
            </View>
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
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 0) : 0 
  },
  flex: { flex: 1 },
  scrollContent: { 
    paddingHorizontal: 20, 
    paddingBottom: 30, 
    paddingTop: 15,
    flexGrow: 1,
  },
  headerWrap: { marginBottom: 15 }, 
  title: { fontSize: 28, fontWeight: "800", color: "white" },
  subtitle: { fontSize: 14, color: "rgba(255,255,255,0.6)", marginTop: 2 },
  glassCard: { 
    backgroundColor: "rgba(255,255,255,0.06)", 
    borderRadius: 20, 
    padding: 15, 
    borderWidth: 1, 
    borderColor: "rgba(255,255,255,0.12)",
  },
  inputGroup: { marginBottom: 12 },
  inputLabel: { color: 'white', fontSize: 12, fontWeight: '600', marginBottom: 4, marginLeft: 4 },
  inputBox: { 
    flexDirection: "row", 
    alignItems: "center", 
    backgroundColor: "rgba(0,0,0,0.2)", 
    borderRadius: 12, 
    paddingHorizontal: 12, 
    height: 48, 
    borderWidth: 1, 
    borderColor: 'rgba(255,255,255,0.1)'
  },
  pickerContainer: {
    backgroundColor: "rgba(0,0,0,0.2)", 
    borderRadius: 12, 
    borderWidth: 1, 
    borderColor: 'rgba(255,255,255,0.1)',
    height: 48,
    justifyContent: 'center',
    overflow: 'hidden'
  },
  picker: { color: "#FFFFFF", width: "100%" },
  textInput: { flex: 1, color: "white", fontSize: 14, marginLeft: 8 },
  primaryButton: { 
    backgroundColor: "white", 
    height: 50, 
    borderRadius: 12, 
    justifyContent: "center", 
    alignItems: "center",
    marginTop: 10,
  },
  buttonDisabled: { opacity: 0.8 },
  buttonText: { color: "#1B1464", fontSize: 16, fontWeight: "800" },
  statusBox: { 
    flexDirection: 'row', alignItems: 'center', 
    padding: 10, borderRadius: 10, marginBottom: 15, borderWidth: 1 
  },
  errorBg: { backgroundColor: 'rgba(255, 82, 82, 0.1)', borderColor: 'rgba(255, 82, 82, 0.3)' },
  successBg: { backgroundColor: 'rgba(129, 199, 132, 0.1)', borderColor: 'rgba(129, 199, 132, 0.3)' },
  statusText: { fontSize: 12, fontWeight: '600', marginLeft: 8 },
});