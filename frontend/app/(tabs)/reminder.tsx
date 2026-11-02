import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
  StatusBar,
  SafeAreaView,
  RefreshControl,
  Modal,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import API from "../../src/api/api";
import DateTimePicker from "@react-native-community/datetimepicker";
import Icon from "react-native-vector-icons/MaterialCommunityIcons";
import { useRouter } from "expo-router";
import { AxiosError } from "axios";

interface Reminder {
  _id: string;
  title: string;
  description?: string;
  date: string;
  language?: "english" | "urdu";
  status: "pending" | "completed";
}



const theme = {
  gradient: ["#1B1464", "#2E3192"] as const,
  background: "#0F0B38",
  glass: "rgba(255,255,255,0.06)",
  glassBorder: "rgba(255,255,255,0.12)",
  success: "#69F0AE",
  danger: "#FF5252",
  accent: "#7C4DFF",
};

const ModernAlert = ({
  visible,
  title,
  message,
  type,
  onConfirm,
  onCancel,
  confirmText,
}: any) => {
  const isDanger = type === "danger";
  const isWarning = type === "warning";

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.alertBox}>
          <View
            style={[
              styles.alertIconBg,
              {
                backgroundColor: isDanger
                  ? "rgba(255, 82, 82, 0.1)"
                  : "rgba(124, 77, 255, 0.1)",
              },
            ]}
          >
            <Icon
              name={
                isDanger
                  ? "trash-can-outline"
                  : isWarning
                  ? "clock-alert-outline"
                  : "check-circle-outline"
              }
              size={35}
              color={isDanger ? theme.danger : theme.accent}
            />
          </View>
          <Text style={styles.alertTitle}>{title}</Text>
          <Text style={styles.alertMessage}>{message}</Text>
          <View style={styles.alertBtnRow}>
            {onCancel && (
              <TouchableOpacity style={styles.alertCancelBtn} onPress={onCancel}>
                <Text style={styles.alertCancelText}>Cancel</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.alertConfirmBtn} onPress={onConfirm}>
              <LinearGradient
                colors={
                  isDanger ? ["#DC2626", "#991B1B"] : ["#1B1464", "#2E3192"]
                }
                style={styles.alertBtnGradient}
              >
                <Text style={styles.alertConfirmText}>
                  {confirmText || "OK"}
                </Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

export default function ReminderScreen() {
  const router = useRouter();

  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [completedNotification, setCompletedNotification] = useState<string | null>(null);
  const [companionLanguage, setCompanionLanguage] = useState<"english" | "urdu">("english");

  const prevRemindersRef = useRef<Reminder[]>([]);

  useEffect(() => {
    const loadCompanionLanguage = async () => {
      try {
        const { data } = await API.get("/companion");
        const companion = Array.isArray(data) ? data[0] : data;
        const lang = String(companion?.language || "english").toLowerCase().trim();
        setCompanionLanguage(lang.includes("urdu") ? "urdu" : "english");
      } catch {
        setCompanionLanguage("english");
      }
    };
    loadCompanionLanguage();
  }, []);

  const [alertConfig, setAlertConfig] = useState({
    visible: false,
    title: "",
    message: "",
    type: "info",
    onConfirm: () => {},
    onCancel: null as any,
    confirmText: "",
  });

  const fetchReminders = useCallback(async (isRefreshing = false, silent = false) => {
    if (!silent) {
      if (isRefreshing) setRefreshing(true);
      else setLoading(true);
    }

    try {
      const { data } = await API.get("/reminders");
      const sortedReminders = data.sort((a: any, b: any) =>
        a.status === b.status
          ? new Date(a.date).getTime() - new Date(b.date).getTime()
          : a.status === "pending"
          ? -1
          : 1
      );

      // Check for newly completed items (from backend)
      if (prevRemindersRef.current.length > 0) {
        const newlyCompleted = sortedReminders.filter(
          (newRem: Reminder) =>
            newRem.status === "completed" &&
            prevRemindersRef.current.find((oldRem) => oldRem._id === newRem._id)?.status === "pending"
        );

        if (newlyCompleted.length > 0) {
          const completedTitles = newlyCompleted.map((r: Reminder) => r.title).join(", ");
          setCompletedNotification(`✅ Task Finished: ${completedTitles}`);
          setTimeout(() => setCompletedNotification(null), 5000);
        }
      }

      prevRemindersRef.current = sortedReminders;
      setReminders(sortedReminders);
    } catch (err) {
      if (!silent) {
        setAlertConfig({
          visible: true,
          title: "Connection Error",
          message: "Unable to connect to server.",
          type: "danger",
          onConfirm: () => setAlertConfig((p) => ({ ...p, visible: false })),
          onCancel: null,
          confirmText: "OK",
        });
      }
    } finally {
      if (!silent) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchReminders();
    const pollInterval = setInterval(() => {
      fetchReminders(false, true);
    }, 15000); // Check every 15 seconds
    return () => clearInterval(pollInterval);
  }, [fetchReminders]);

  const handleEditReminder = (item: Reminder) => {
    setEditingId(item._id);
    setTitle(item.title || "");
    setDescription(item.description || "");
    setSelectedDate(new Date(item.date));
  };

  const handleSaveReminder = async () => {
    if (!title.trim()) {
      setAlertConfig({
        visible: true,
        title: "Missing Title",
        message: "Please name your reminder first.",
        type: "warning",
        onConfirm: () => setAlertConfig((p) => ({ ...p, visible: false })),
        onCancel: null,
        confirmText: "Understood",
      });
      return;
    }

    const reminderData = {
      title,
      description,
      date: selectedDate.toISOString(),
      status: "pending",
      language: companionLanguage,
    };

    try {
      setLoading(true);
      if (editingId) {
        await API.put(`/reminders/${editingId}`, reminderData);
      } else {
        await API.post("/reminders", reminderData);
      }
      resetForm();
      fetchReminders();
    } catch (err) {
      const error = err as AxiosError<any>;
      setAlertConfig({
        visible: true,
        title: "Save Failed",
        message: error.response?.data?.message || "Failed to save reminder",
        type: "danger",
        onConfirm: () => setAlertConfig((p) => ({ ...p, visible: false })),
        onCancel: null,
        confirmText: "OK",
      });
    } finally {
      setLoading(false);
    }
  };

  const toggleStatus = async (item: Reminder) => {
    try {
      const newStatus = item.status === "pending" ? "completed" : "pending";
      await API.put(`/reminders/${item._id}`, { status: newStatus });
      fetchReminders(false, true); // Silent update
    } catch (err) {
      console.error("Failed to toggle status", err);
    }
  };

  const confirmDelete = (id: string) => {
    setAlertConfig({
      visible: true,
      title: "Remove Reminder?",
      message: "Are you sure you want to delete this task?",
      type: "danger",
      confirmText: "Delete",
      onCancel: () => setAlertConfig((p) => ({ ...p, visible: false })),
      onConfirm: async () => {
        try {
          await API.delete(`/reminders/${id}`);
          setReminders((prev) => prev.filter((r) => r._id !== id));
          if (editingId === id) resetForm();
        } catch (err) {
          console.error("Delete Error:", err);
        }
        setAlertConfig((p) => ({ ...p, visible: false }));
      },
    });
  };

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setEditingId(null);
    setSelectedDate(new Date());
  };

  const renderItem = ({ item }: { item: Reminder }) => {
    // UPDATED LOGIC: Mark as completed if status is 'completed' OR time has passed
    const isPast = new Date(item.date) < new Date();
    const isCompleted = item.status === "completed" || isPast;

    return (
      <View style={[styles.card, isCompleted && styles.completedCard]}>
        <View style={styles.cardHeader}>
          <TouchableOpacity 
            style={[
              styles.iconBox,
              {
                backgroundColor: isCompleted
                  ? "rgba(105, 240, 174, 0.1)"
                  : "rgba(124, 77, 255, 0.15)",
              },
            ]}
            onPress={() => toggleStatus(item)} // User can manually toggle
          >
            <Icon
              name={isCompleted ? "check-decagram" : "bell-ring"}
              size={22}
              color={isCompleted ? theme.success : theme.accent}
            />
          </TouchableOpacity>

          <View style={styles.headerMain}>
            <Text style={[styles.reminderTitle, isCompleted && styles.completedText]}>
              {item.title}
            </Text>
            <View style={styles.timeRow}>
              <Icon name="clock-outline" size={12} color={isPast && !isCompleted ? theme.danger : "rgba(255,255,255,0.4)"} />
              <Text style={[styles.timeText, isPast && !isCompleted && { color: theme.danger }]}>
                {new Date(item.date).toLocaleString([], {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })} {isPast && !isCompleted ? "(Overdue)" : ""}
              </Text>
            </View>
          </View>

          <View style={styles.actionBtns}>
            {!isCompleted && (
              <TouchableOpacity onPress={() => handleEditReminder(item)} style={styles.editBtn}>
                <Icon name="pencil-outline" size={20} color={theme.success} />
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => confirmDelete(item._id)} style={styles.deleteBtn}>
              <Icon name="trash-can-outline" size={20} color={theme.danger} />
            </TouchableOpacity>
          </View>
        </View>
        {item.description ? (
          <View style={styles.msgBox}>
            <Text style={styles.msgText}>{item.description}</Text>
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      <ModernAlert
        visible={alertConfig.visible}
        title={alertConfig.title}
        message={alertConfig.message}
        type={alertConfig.type}
        confirmText={alertConfig.confirmText}
        onConfirm={alertConfig.onConfirm}
        onCancel={alertConfig.onCancel}
      />

      <LinearGradient colors={theme.gradient} style={styles.header}>
        <SafeAreaView>
          <View style={styles.headerContent}>
            <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
              <Icon name="chevron-left" size={28} color="#FFF" />
            </TouchableOpacity>
            <View style={styles.titleWrap}>
              <Text style={styles.headerTitle}>Companion</Text>
              <Text style={styles.headerSub}>DAILY CARE REMINDERS</Text>
            </View>
            <View style={{ width: 45 }} />
          </View>
        </SafeAreaView>
      </LinearGradient>

      {completedNotification && (
        <View style={styles.completedNotification}>
          <Icon name="check-circle" size={20} color={theme.success} />
          <Text style={styles.completedNotificationText}>{completedNotification}</Text>
          <TouchableOpacity onPress={() => setCompletedNotification(null)}>
            <Icon name="close" size={16} color="rgba(255,255,255,0.7)" />
          </TouchableOpacity>
        </View>
      )}

      <FlatList
        data={reminders}
        keyExtractor={(item) => item._id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContainer}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => fetchReminders(true)}
            tintColor={theme.success}
          />
        }
        ListEmptyComponent={
          loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={theme.success} />
              <Text style={styles.loadingText}>Loading reminders...</Text>
            </View>
          ) : (
            <View style={styles.emptyContainer}>
              <Icon name="bell-off-outline" size={48} color="rgba(255,255,255,0.3)" />
              <Text style={styles.emptyText}>No reminders yet</Text>
              <Text style={styles.emptySubtext}>Create your first reminder above</Text>
            </View>
          )
        }
        ListHeaderComponent={
          <>
            {/* Reminder Form */}
            <View style={styles.formCard}>
              <Text style={styles.formLabel}>
                {editingId ? "Modify Schedule" : "New Reminder"}
              </Text>
              <Text style={styles.langHint}>
                Speaks in companion language:{" "}
                {companionLanguage === "urdu" ? "Urdu" : "English"}
              </Text>

              <TextInput
                style={styles.input}
                placeholder="What to remind?"
                placeholderTextColor="rgba(255,255,255,0.3)"
                value={title}
                onChangeText={setTitle}
                maxLength={35}
              />

              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="Short note..."
                placeholderTextColor="rgba(255,255,255,0.3)"
                value={description}
                onChangeText={setDescription}
                multiline
              />

              <View style={styles.row}>
                <TouchableOpacity style={styles.pickerBtn} onPress={() => setShowDatePicker(true)}>
                <Icon name="calendar" size={18} color={theme.success} />
                <Text style={styles.pickerText}>{selectedDate.toLocaleDateString()}</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.pickerBtn} onPress={() => setShowTimePicker(true)}>
                <Icon name="clock-outline" size={18} color={theme.success} />
                <Text style={styles.pickerText}>
                  {selectedDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.saveBtn} onPress={handleSaveReminder} disabled={loading}>
              <LinearGradient colors={["#FFF", "#E2E8F0"]} style={styles.saveBtnGradient}>
                {loading ? <ActivityIndicator color="#1B1464" /> : <Text style={styles.saveBtnText}>{editingId ? "UPDATE" : "SET REMINDER"}</Text>}
              </LinearGradient>
            </TouchableOpacity>

            {editingId && (
              <TouchableOpacity style={styles.cancelEditBtn} onPress={resetForm}>
                <Text style={styles.cancelEditText}>CANCEL EDIT</Text>
              </TouchableOpacity>
            )}
            </View>
          </>
        }
      />

      {(showDatePicker || showTimePicker) && (
        <DateTimePicker
          value={selectedDate}
          mode={showDatePicker ? "date" : "time"}
          onChange={(e, d) => {
            setShowDatePicker(false);
            setShowTimePicker(false);
            if (d) setSelectedDate(d);
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  completedNotification: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(105, 240, 174, 0.1)",
    borderLeftWidth: 4,
    borderLeftColor: theme.success,
    padding: 12,
    marginHorizontal: 16,
    marginTop: 10,
    borderRadius: 8,
  },
  completedNotificationText: {
    flex: 1,
    color: theme.success,
    fontSize: 14,
    fontWeight: "600",
    marginLeft: 8,
  },
  header: {
    paddingTop: Platform.OS === "android" ? StatusBar.currentHeight || 10 : 0,
    paddingBottom: 25,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
  },
  headerContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    marginTop: 10,
  },
  backBtn: {
    width: 45,
    height: 45,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 15,
    justifyContent: "center",
    alignItems: "center",
  },
  titleWrap: { alignItems: "center" },
  headerTitle: { color: "#FFF", fontSize: 20, fontWeight: "800" },
  headerSub: {
    color: theme.success,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1,
    marginTop: 2,
  },
  listContainer: { padding: 16, paddingBottom: 100 },
  formCard: {
    backgroundColor: theme.glass,
    borderRadius: 24,
    padding: 20,
    marginBottom: 25,
    borderWidth: 1,
    borderColor: theme.glassBorder,
  },
  formLabel: {
    color: "#FFF",
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 6,
    opacity: 0.5,
  },
  langHint: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
    marginBottom: 14,
  },
  input: {
    backgroundColor: "rgba(0,0,0,0.2)",
    borderRadius: 12,
    padding: 14,
    color: "#FFF",
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
    fontSize: 14,
  },
  textArea: { height: 50, textAlignVertical: "top" },
  row: { flexDirection: "row", gap: 10, marginBottom: 15 },
  pickerBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(255,255,255,0.05)",
    padding: 12,
    borderRadius: 12,
  },
  pickerText: { color: "#FFF", fontSize: 12, fontWeight: "600" },
  saveBtn: { borderRadius: 12, overflow: "hidden", marginTop: 5 },
  saveBtnGradient: { padding: 14, alignItems: "center" },
  saveBtnText: { color: "#1B1464", fontWeight: "900", fontSize: 13 },
  cancelEditBtn: {
    marginTop: 10,
    alignItems: "center",
    paddingVertical: 10,
  },
  cancelEditText: {
    color: "rgba(255,255,255,0.6)",
    fontWeight: "800",
    fontSize: 12,
  },
  card: {
    backgroundColor: theme.glass,
    borderRadius: 24,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: theme.glassBorder,
  },
  completedCard: { opacity: 0.5 },
  cardHeader: { flexDirection: "row", alignItems: "center" },
  iconBox: {
    width: 45,
    height: 45,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
  },
  headerMain: { flex: 1, marginLeft: 12 },
  reminderTitle: { fontSize: 16, fontWeight: "800", color: "#FFF" },
  completedText: {
    textDecorationLine: "line-through",
    color: "rgba(255,255,255,0.4)",
  },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
  },
  timeText: {
    fontSize: 11,
    color: "rgba(255,255,255,0.4)",
    fontWeight: "600",
  },
  actionBtns: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: 8,
  },
  editBtn: { padding: 5, marginRight: 4 },
  deleteBtn: { padding: 5 },
  msgBox: {
    backgroundColor: "rgba(255,255,255,0.03)",
    padding: 10,
    borderRadius: 12,
    marginTop: 12,
  },
  msgText: {
    fontSize: 12,
    color: "rgba(255,255,255,0.5)",
    lineHeight: 16,
  },

  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.85)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  alertBox: {
    width: "100%",
    backgroundColor: "#1A1648",
    borderRadius: 25,
    padding: 25,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  alertIconBg: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 15,
  },
  alertTitle: { color: "#FFF", fontSize: 18, fontWeight: "800", marginBottom: 5 },
  alertMessage: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 13,
    textAlign: "center",
    marginBottom: 20,
  },
  alertBtnRow: { flexDirection: "row", gap: 10 },
  alertCancelBtn: { flex: 1, padding: 12, alignItems: "center" },
  alertCancelText: { color: "rgba(255,255,255,0.4)", fontWeight: "700" },
  alertConfirmBtn: { flex: 1.5, borderRadius: 12, overflow: "hidden" },
  alertBtnGradient: { padding: 12, alignItems: "center" },
  alertConfirmText: { color: "#FFF", fontWeight: "800" },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 50,
  },
  loadingText: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 14,
    marginTop: 10,
    fontWeight: "600",
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 50,
  },
  emptyText: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 16,
    fontWeight: "700",
    marginTop: 10,
  },
  emptySubtext: {
    color: "rgba(255,255,255,0.3)",
    fontSize: 12,
    marginTop: 5,
  },
});