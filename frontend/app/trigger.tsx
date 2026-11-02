import React, { useState } from "react";
import {
  View,
  TouchableOpacity,
  Text,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Platform,
} from "react-native";
import axios from "axios";
import API from "../src/api/api";

export default function TriggerScreen() {
  const [loading, setLoading] = useState(false);

  const triggerAlert = async () => {
    try {
      setLoading(true);

      const response = await API.post("/emergency/trigger-demo", {});

      if (response.status === 200 || response.status === 201) {
        if (Platform.OS === "web") {
          alert("🚨 SOS SENT: Emergency alert sent to active caregiver.");
        } else {
          Alert.alert("🚨 SOS SENT", "Emergency alert sent to active caregiver.");
        }
      }
    } catch (err: unknown) {
      let serverMsg = "Check connection";

      if (axios.isAxiosError(err)) {
        serverMsg = err.response?.data?.message || "Check connection";
      }

      if (Platform.OS === "web") {
        alert(serverMsg);
      } else {
        Alert.alert("Failed", serverMsg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={[styles.btn, loading && { opacity: 0.6 }]}
        onPress={triggerAlert}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#FFF" size="large" />
        ) : (
          <View style={styles.innerBtn}>
            <Text style={styles.text}>SOS</Text>
          </View>
        )}
      </TouchableOpacity>

      <Text style={styles.subText}>TAP FOR IMMEDIATE HELP</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#0A0E21",
  },
  btn: {
    backgroundColor: "#E11D48",
    width: 200,
    height: 200,
    borderRadius: 100,
    justifyContent: "center",
    alignItems: "center",
    elevation: 15,
    shadowColor: "#E11D48",
    shadowOpacity: 0.5,
    shadowRadius: 20,
    borderWidth: 10,
    borderColor: "rgba(255,255,255,0.1)",
  },
  innerBtn: { alignItems: "center" },
  text: {
    color: "white",
    fontWeight: "900",
    fontSize: 45,
    letterSpacing: 2,
  },
  subText: {
    color: "#64748B",
    marginTop: 30,
    fontWeight: "bold",
    fontSize: 12,
    letterSpacing: 1.5,
  },
});