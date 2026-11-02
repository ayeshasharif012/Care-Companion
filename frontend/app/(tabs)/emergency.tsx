import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  StatusBar,
  Modal,
  ActivityIndicator,
  Alert,
  AppState,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "react-native-vector-icons/MaterialCommunityIcons";
import { Socket } from "socket.io-client";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter, useFocusEffect } from "expo-router";

import API from "../../src/api/api";
import {
  triggerLocalNotification,
  registerForPushNotificationsAsync,
} from "../../services/NotificationService";
import { connectSocket, getSocket } from "../../services/socketService";

const theme = {
  gradient: ["#1B1464", "#0F0B38"] as const,
  cardGrad: ["rgba(255,255,255,0.1)", "rgba(255,255,255,0.03)"] as const,
  background: "#0A0826",
  glass: "rgba(255,255,255,0.06)",
  glassBorder: "rgba(255,255,255,0.12)",
  success: "#00E676",
  danger: "#FF5252",
  textDim: "#94A3B8",
};

type EmergencyAlert = {
  _id: string;
  message: string;
  status: "active" | "resolved";
  createdAt?: string;
  companionId?: { name: string };
};

export default function EmergencyScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [alerts, setAlerts] = useState<EmergencyAlert[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);
  
  const socketRef = useRef<Socket | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const appStateRef = useRef(AppState.currentState);

  const fetchAlerts = useCallback(async (isRefreshing = false) => {
    if (isRefreshing) setRefreshing(true);
    else setLoading(true);

    try {
      const { data } = await API.get("/emergency");
      if (Array.isArray(data)) {
        console.log("Alerts fetched:", data.length);
        setAlerts(data);
      }
    } catch (err) {
      console.error("Fetch Emergency Error:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Initialize socket connection once on mount
  useEffect(() => {
    console.log("Initializing socket connection...");
    const socket = getSocket();
    socketRef.current = socket;

    // Setup connection listeners
    const handleConnect = () => {
      console.log("✅ Socket connected:", socket.id);
      setSocketConnected(true);
      socket.emit("emergency_monitor_active");
    };

    const handleDisconnect = () => {
      console.log("❌ Socket disconnected");
      setSocketConnected(false);
    };

    const handleConnectError = (error: any) => {
      console.log("⚠️ Socket connection error:", error);
      setSocketConnected(false);
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("connect_error", handleConnectError);

    connectSocket();

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("connect_error", handleConnectError);
    };
  }, []);

  // Set up socket event listeners
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    console.log("Setting up socket event listeners...");

    const handleNewEmergency = (emergency: EmergencyAlert) => {
      console.log("🚨 New emergency received via socket:", emergency);
      setAlerts((prev) => [emergency, ...prev]);
      triggerLocalNotification(
        "🚨 EMERGENCY ALERT!",
        `${emergency.companionId?.name || "Companion"} needs help: ${emergency.message}`
      );
    };

    const handleEmergencyResolved = (updatedAlert: EmergencyAlert) => {
      console.log("✅ Emergency resolved via socket:", updatedAlert);
      setAlerts((prev) =>
        prev.map((a) => (a._id === updatedAlert._id ? { ...a, status: "resolved" } : a))
      );
    };

    const handleEmergencyDeleted = ({ id }: { id: string }) => {
      console.log("🗑️ Emergency deleted via socket:", id);
      setAlerts((prev) => prev.filter((a) => a._id !== id));
    };

    socket.on("newEmergency", handleNewEmergency);
    socket.on("emergencyResolved", handleEmergencyResolved);
    socket.on("emergencyDeleted", handleEmergencyDeleted);

    return () => {
      socket.off("newEmergency", handleNewEmergency);
      socket.off("emergencyResolved", handleEmergencyResolved);
      socket.off("emergencyDeleted", handleEmergencyDeleted);
    };
  }, []);

  // App state listener
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      appStateRef.current = state;
      console.log("App state changed:", state);

      if (state === "active") {
        console.log("👀 App came to foreground");
        const socket = socketRef.current;
        if (socket && !socket.connected) {
          console.log("Reconnecting socket...");
          connectSocket();
        }
        fetchAlerts(true);
      }
    });

    return () => {
      subscription.remove();
    };
  }, [fetchAlerts]);

  // Fast polling fallback when screen is focused
  useFocusEffect(
    useCallback(() => {
      console.log("Emergency screen focused - starting real-time monitoring");
      registerForPushNotificationsAsync();
      
      // Initial fetch
      fetchAlerts();

      // Setup fast polling (3 seconds) as fallback
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }

      pollIntervalRef.current = setInterval(() => {
        const socket = socketRef.current;
        if (!socket || !socket.connected) {
          console.log("Socket not connected, polling server...");
          fetchAlerts();
        }
      }, 3000);

      return () => {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
      };
    }, [fetchAlerts])
  );

  const handleResolve = async (id: string) => {
    try {
      const response = await API.put(`/emergency/${id.trim()}/resolve`);
      if (response.data) {
        setAlerts((prev) =>
          prev.map((a) => (a._id === id ? { ...a, status: "resolved" } : a))
        );
      }
    } catch (err: any) {
      Alert.alert("Error", "Could not resolve alert. Please check connection.");
    }
  };

  const openDeleteModal = (id: string, status: "active" | "resolved") => {
    if (status === "active") return;
    setSelectedId(id);
    setModalVisible(true);
  };

  const handleDelete = async () => {
    if (!selectedId) return;

    try {
      await API.delete(`/emergency/${selectedId.trim()}`);
      setAlerts((prev) => prev.filter((a) => a._id !== selectedId));
      setModalVisible(false);
    } catch (err) {
      setModalVisible(false);
    }
  };

  const renderItem = ({ item }: { item: EmergencyAlert }) => {
    const isActive = item.status === "active";

    return (
      <View style={[styles.cardContainer, !isActive && { opacity: 0.7 }]}>
        <LinearGradient colors={theme.cardGrad} style={[styles.card, isActive && styles.activeGlow]}>
          <View style={styles.cardHeader}>
            <View
              style={[
                styles.statusIndicator,
                { backgroundColor: isActive ? theme.danger : theme.success },
              ]}
            />

            <View style={styles.headerMain}>
              <Text style={styles.companionName}>
                {item.companionId?.name || "Companion"}
              </Text>
              <Text style={styles.timeText}>
                {new Date(item.createdAt || "").toLocaleString()}
              </Text>
            </View>

            {!isActive && (
              <TouchableOpacity
                onPress={() => openDeleteModal(item._id, item.status)}
                style={styles.deleteIconBtn}
              >
                <Icon name="trash-can-outline" size={21} color={theme.danger} />
              </TouchableOpacity>
            )}
          </View>

          <Text style={styles.msgText}>{item.message}</Text>

          {isActive ? (
            <TouchableOpacity
              activeOpacity={0.8}
              style={styles.resolveBtn}
              onPress={() => handleResolve(item._id)}
            >
              <LinearGradient
                colors={["#00E676", "#00C853"]}
                style={styles.btnGrad}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
              >
                <Icon
                  name="shield-check"
                  size={18}
                  color="#0F0B38"
                  style={{ marginRight: 8 }}
                />
                <Text style={styles.btnText}>MARK AS RESOLVED</Text>
              </LinearGradient>
            </TouchableOpacity>
          ) : (
            <View style={styles.bottomRow}>
              <View style={styles.resolvedBadge}>
                <Icon name="check-decagram" size={16} color={theme.success} />
                <Text style={styles.resolvedText}>RESOLVED & SECURED</Text>
              </View>
            </View>
          )}
        </LinearGradient>
      </View>
    );
  };

  return (
    <View style={styles.mainContainer}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      <LinearGradient
        colors={theme.gradient}
        style={[styles.header, { paddingTop: insets.top + 10 }]}
      >
        <View style={styles.headerContent}>
          <TouchableOpacity 
            style={styles.backBtn} 
            onPress={() => router.push("/(tabs)/dashboard")}
          >
            <Icon name="chevron-left" size={28} color="#FFF" />
          </TouchableOpacity>

          <View style={styles.titleWrap}>
            <Text style={styles.headerTitle}>Emergency Center</Text>
            <View style={styles.liveIndicator}>
              <View style={[styles.pulseDot, socketConnected && styles.connectedDot]} />
              <Text style={styles.headerSub}>
                {socketConnected ? "LIVE MONITORING" : "CONNECTING..."}
              </Text>
            </View>
          </View>

          <TouchableOpacity style={styles.refreshBtn} onPress={() => fetchAlerts(true)}>
            <Icon name="reload" size={22} color={theme.success} />
          </TouchableOpacity>
        </View>
      </LinearGradient>

      <FlatList
        data={alerts}
        keyExtractor={(item) => item._id}
        renderItem={renderItem}
        contentContainerStyle={[styles.listContainer, { paddingBottom: insets.bottom + 20 }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => fetchAlerts(true)}
            tintColor={theme.success}
          />
        }
        ListEmptyComponent={
          !loading ? (
            <Text style={styles.emptyText}>No emergency logs found.</Text>
          ) : (
            <ActivityIndicator color={theme.success} style={{ marginTop: 40 }} />
          )
        }
      />

      <Modal visible={modalVisible} transparent animationType="slide">
        <View style={styles.overlay}>
          <View style={styles.modalContent}>
            <Icon name="trash-can-outline" size={40} color={theme.danger} />
            <Text style={styles.modalTitle}>Delete Record?</Text>
            <Text style={styles.modalSub}>This action cannot be undone.</Text>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setModalVisible(false)}>
                <Text style={styles.cancelTxt}>CANCEL</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmBtn} onPress={handleDelete}>
                <Text style={styles.confirmTxt}>DELETE</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  mainContainer: { flex: 1, backgroundColor: theme.background },
  header: {
    paddingBottom: 20,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
    elevation: 10,
  },
  headerContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
  },
  backBtn: {
    width: 45,
    height: 45,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 15,
    justifyContent: "center",
    alignItems: "center",
  },
  refreshBtn: {
    width: 45,
    height: 45,
    backgroundColor: "rgba(0,230,118,0.1)",
    borderRadius: 15,
    justifyContent: "center",
    alignItems: "center",
  },
  titleWrap: { alignItems: "center" },
  headerTitle: { color: "#FFF", fontSize: 20, fontWeight: "800", letterSpacing: 0.5 },
  liveIndicator: { flexDirection: "row", alignItems: "center", marginTop: 4 },
  pulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.success,
    marginRight: 6,
  },
  connectedDot: {
    backgroundColor: "#00E676",
    shadowColor: "#00E676",
    shadowOpacity: 0.8,
    shadowRadius: 4,
    elevation: 5,
  },
  headerSub: { color: theme.success, fontSize: 10, fontWeight: "bold", letterSpacing: 1 },
  listContainer: { padding: 20 },
  cardContainer: { marginBottom: 16 },
  card: {
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: theme.glassBorder,
    overflow: "hidden",
  },
  activeGlow: {
    borderColor: "rgba(255, 82, 82, 0.3)",
    backgroundColor: "rgba(255, 82, 82, 0.02)",
  },
  cardHeader: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  statusIndicator: { width: 8, height: 8, borderRadius: 4, marginRight: 10 },
  headerMain: { flex: 1 },
  companionName: { color: "#FFF", fontSize: 16, fontWeight: "bold" },
  timeText: { color: theme.textDim, fontSize: 11, marginTop: 2 },
  deleteIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: "rgba(255, 82, 82, 0.08)",
    justifyContent: "center",
    alignItems: "center",
  },
  msgText: { color: "#E2E8F0", fontSize: 14, lineHeight: 20, marginBottom: 18 },
  resolveBtn: { borderRadius: 14, overflow: "hidden", elevation: 5 },
  btnGrad: {
    paddingVertical: 14,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
  btnText: { color: "#0A0826", fontWeight: "900", fontSize: 12, letterSpacing: 1 },
  bottomRow: {
    flexDirection: "row",
    justifyContent: "flex-start",
    alignItems: "center",
  },
  resolvedBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0, 230, 118, 0.08)",
    padding: 10,
    borderRadius: 12,
    alignSelf: "flex-start",
  },
  resolvedText: { color: theme.success, fontSize: 11, fontWeight: "bold", marginLeft: 6 },
  emptyText: { color: theme.textDim, textAlign: "center", marginTop: 100, fontSize: 15 },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.85)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalContent: {
    backgroundColor: "#1A1648",
    borderRadius: 30,
    padding: 30,
    width: "100%",
    alignItems: "center",
    borderWidth: 1,
    borderColor: theme.glassBorder,
  },
  modalTitle: { color: "#FFF", fontSize: 22, fontWeight: "bold", marginTop: 15 },
  modalSub: { color: theme.textDim, fontSize: 14, marginTop: 8, textAlign: "center" },
  modalActions: { flexDirection: "row", marginTop: 30, gap: 15 },
  cancelBtn: {
    flex: 1,
    padding: 16,
    alignItems: "center",
    borderRadius: 15,
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  confirmBtn: {
    flex: 1,
    padding: 16,
    alignItems: "center",
    borderRadius: 15,
    backgroundColor: theme.danger,
  },
  cancelTxt: { color: "#FFF", fontWeight: "bold" },
  confirmTxt: { color: "#FFF", fontWeight: "bold" },
});