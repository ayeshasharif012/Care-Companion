import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Platform,
  StatusBar,
  SafeAreaView,
  RefreshControl,
  Modal,
  Dimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Picker } from "@react-native-picker/picker";
import Icon from "react-native-vector-icons/MaterialCommunityIcons";
import { LinearGradient } from "expo-linear-gradient";
import AsyncStorage from "@react-native-async-storage/async-storage";
import API from "../../src/api/api";
import {
  fetchCompanionLanguage as loadCompanionLanguage,
  normalizeCompanionLang,
} from "../../services/companionLanguageService";

interface HealthTip {
  _id: string;
  language: "english" | "urdu";
  category: string;
  tipText: string;
  audioUrl?: string;
  active: boolean;
  createdAt: string;
}

interface SuggestedTip {
  category: string;
  text: string;
}

const theme = {
  gradient: ["#1B1464", "#2E3192"] as const,
  background: "#0F0B38",
  glass: "rgba(255,255,255,0.06)",
  glassBorder: "rgba(255,255,255,0.12)",
  success: "#69F0AE",
  danger: "#FF5252",
  accent: "#7C4DFF",
  warning: "#F59E0B",
  textPrimary: "#FFFFFF",
  textSecondary: "rgba(255,255,255,0.6)",
};

const categories = [
  { label: "Hydration", value: "hydration" },
  { label: "Posture", value: "posture" },
  { label: "Exercise", value: "exercise" },
  { label: "Nutrition", value: "nutrition" },
  { label: "Wellness", value: "wellness" },
];

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

export default function HealthTipsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [companionLanguage, setCompanionLanguage] = useState<"english" | "urdu">("english");
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [tips, setTips] = useState<HealthTip[]>([]);
  const [suggestedTips, setSuggestedTips] = useState<SuggestedTip[]>([]);
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [customTipText, setCustomTipText] = useState("");
  const [isMixed, setIsMixed] = useState(false);
  const [selectedCustomCategory, setSelectedCustomCategory] = useState(categories[0].value);

  const [alertConfig, setAlertConfig] = useState({
    visible: false,
    title: "",
    message: "",
    type: "info",
    onConfirm: () => {},
    onCancel: null as (() => void) | null,
    confirmText: "",
  });

  useEffect(() => {
    if (Platform.OS === 'web') {
      const style = document.createElement('style');
      style.textContent = `
        select {
          background-color: #1A1648 !important;
          color: white !important;
          border: 1px solid rgba(255,255,255,0.12) !important;
          border-radius: 12px !important;
          padding: 12px !important;
        }
        select option {
          background-color: #2E3192 !important;
          color: white !important;
        }
      `;
      document.head.appendChild(style);
    }
  }, []);

  useEffect(() => {
    initializeScreen();
  }, []);

  const initializeScreen = async () => {
    await fetchCompanionLanguage();
  };

  const fetchCompanionLanguage = async () => {
    try {
      setLoading(true);
      const currentLang = await loadCompanionLanguage();
      setCompanionLanguage(currentLang);
      await fetchSuggestedTips(currentLang);
      await fetchTips(false, currentLang);
    } catch {
      setCompanionLanguage("english");
      await fetchSuggestedTips("english");
      await fetchTips(false, "english");
    } finally {
      setLoading(false);
    }
  };

  const fetchSuggestedTips = async (lang: string) => {
    try {
      const { data } = await API.get(`/health-tips/suggested/list?language=${lang}`);
      setSuggestedTips(data);
    } catch (err) {
      setSuggestedTips([]);
    }
  };

  const fetchTips = async (isRefreshing = false, lang?: string) => {
    if (isRefreshing) setRefreshing(true);
    else setLoading(true);
    try {
      const token = await AsyncStorage.getItem("token");
      if (!token) {
        throw new Error("Please log in again");
      }

      const language = lang || companionLanguage;
      const { data } = await API.get(`/health-tips?language=${language}`);
      const list = Array.isArray(data) ? data : [];
      setTips(list.filter((tip: HealthTip) => tip.language === language));
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ||
        err?.message ||
        "Could not load saved health tips";
      if (err?.response?.status === 401) {
        setAlertConfig({
          visible: true,
          title: "Session expired",
          message: "Please logout and login again.",
          type: "warning",
          onConfirm: () => setAlertConfig((p) => ({ ...p, visible: false })),
          onCancel: null,
          confirmText: "OK",
        });
      } else {
        setAlertConfig({
          visible: true,
          title: "Error",
          message: msg,
          type: "warning",
          onConfirm: () => setAlertConfig((p) => ({ ...p, visible: false })),
          onCancel: null,
          confirmText: "OK",
        });
      }
      setTips([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    const containsUrdu = /[\u0600-\u06FF]/.test(customTipText);
    const containsEnglish = /[a-zA-Z]/.test(customTipText);
    setIsMixed(containsUrdu && containsEnglish);
  }, [customTipText]);

  const handleAddSuggestedTip = async (suggestedTip: SuggestedTip) => {
    if (loading) return; 
    setLoading(true);
    try {
      const token = await AsyncStorage.getItem("token");
      const response = await API.post(
        "/health-tips",
        {
          language: companionLanguage, 
          category: suggestedTip.category,
          tipText: suggestedTip.text,
        },
        { 
          headers: { Authorization: `Bearer ${token}` },
          timeout: 120000 
        }
      );

      if (response.data && response.data._id) {
        setTips((prevTips) => [response.data, ...prevTips]);
      } else {
        await fetchTips();
      }

      setAlertConfig({
        visible: true,
        title: "Success",
        message: "Tip added successfully to your saved list!",
        type: "success",
        onConfirm: () => setAlertConfig((p) => ({ ...p, visible: false })),
        onCancel: null,
        confirmText: "Great",
      });
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || err.message || "Failed execution loop runtime link mapping";
      setAlertConfig({
        visible: true,
        title: "Error",
        message: errorMessage,
        type: "danger",
        onConfirm: () => setAlertConfig((p) => ({ ...p, visible: false })),
        onCancel: null,
        confirmText: "OK",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveCustomTip = async () => {
    if (!customTipText.trim()) {
      setAlertConfig({
        visible: true,
        title: "Missing Text",
        message: "Please enter a tip.",
        type: "warning",
        onConfirm: () => setAlertConfig((p) => ({ ...p, visible: false })),
        onCancel: null,
        confirmText: "OK",
      });
      return;
    }
    setLoading(true);
    try {
      const token = await AsyncStorage.getItem("token");
      const response = await API.post(
        "/health-tips",
        {
          language: companionLanguage, 
          category: selectedCustomCategory,
          tipText: customTipText,
        },
        { 
          headers: { Authorization: `Bearer ${token}` },
          timeout: 120000 
        }
      );

      if (response.data && response.data._id) {
        setTips((prevTips) => [response.data, ...prevTips]);
      } else {
        await fetchTips();
      }

      setAlertConfig({
        visible: true,
        title: "Success",
        message: "Custom tip added successfully!",
        type: "success",
        onConfirm: () => {
          setAlertConfig((p) => ({ ...p, visible: false }));
          setShowCustomModal(false);
          setCustomTipText("");
        },
        onCancel: null,
        confirmText: "Great",
      });
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || err.message || "Execution thread block interrupted";
      setAlertConfig({
        visible: true,
        title: "Error",
        message: errorMessage,
        type: "danger",
        onConfirm: () => setAlertConfig((p) => ({ ...p, visible: false })),
        onCancel: null,
        confirmText: "OK",
      });
    } finally {
      setLoading(false);
    }
  };

  const performDelete = async (id: string) => {
    try {
      const token = await AsyncStorage.getItem("token");
      await API.delete(`/health-tips/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setTips((prev) => prev.filter((tip) => tip._id !== id));
      setAlertConfig({
        visible: true,
        title: "Deleted",
        message: "Tip removed successfully.",
        type: "success",
        onConfirm: () => setAlertConfig((p) => ({ ...p, visible: false })),
        onCancel: null,
        confirmText: "OK",
      });
    } catch (err: any) {
      const msg = err.response?.data?.message || "Could not delete database entity target sync link mapping index node";
      setAlertConfig({
        visible: true,
        title: "Error",
        message: msg,
        type: "danger",
        onConfirm: () => setAlertConfig((p) => ({ ...p, visible: false })),
        onCancel: null,
        confirmText: "OK",
      });
    }
  };

  const handleDelete = (id: string) => {
    setAlertConfig({
      visible: true,
      title: "Delete Tip",
      message: "Are you sure you want to delete this tip?",
      type: "danger",
      confirmText: "Delete",
      onCancel: () => setAlertConfig((p) => ({ ...p, visible: false })),
      onConfirm: () => {
        setAlertConfig((p) => ({ ...p, visible: false }));
        performDelete(id);
      },
    });
  };

  const getCategoryLabel = (value: string) => {
    return categories.find((c) => c.value === value)?.label || value;
  };

  const isAlreadyAdded = (suggestedTip: SuggestedTip) => {
    return tips.some(
      (tip) =>
        tip.language === companionLanguage &&
        tip.category === suggestedTip.category &&
        tip.tipText.trim().toLowerCase() === suggestedTip.text.trim().toLowerCase()
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

      <Modal visible={showCustomModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>➕ Add Custom Health Tip</Text>
              <TouchableOpacity
                onPress={() => {
                  setShowCustomModal(false);
                  setCustomTipText("");
                  setSelectedCustomCategory(categories[0].value);
                }}
              >
                <Icon name="close" size={24} color="#FFF" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScrollContent}>
              <View style={styles.pickerRow}>
                <Text style={styles.label}>Category</Text>
                <View style={styles.pickerContainer}>
                  <Picker
                    selectedValue={selectedCustomCategory}
                    onValueChange={setSelectedCustomCategory}
                    style={styles.picker}
                    dropdownIconColor={theme.success}
                  >
                    {categories.map((cat) => (
                      <Picker.Item key={cat.value} label={cat.label} value={cat.value} />
                    ))}
                  </Picker>
                </View>
              </View>

              <View style={styles.languageInfo}>
                <Icon name="information-outline" size={16} color={theme.accent} />
                <Text style={styles.languageInfoText}>
                  This tip will be saved in {companionLanguage === 'urdu' ? 'Urdu' : 'English'}
                </Text>
              </View>

              <TextInput
                style={[
                  styles.textInput,
                  companionLanguage === "urdu" && { textAlign: "right" }
                ]}
                placeholder={
                  companionLanguage === "urdu"
                    ? "...اردو میں لکھیں"
                    : "Enter your custom tip in English..."
                }
                placeholderTextColor="rgba(255,255,255,0.3)"
                value={customTipText}
                onChangeText={setCustomTipText}
                multiline
              />

              {isMixed && (
                <View style={styles.warningBox}>
                  <Icon name="alert-circle-outline" size={16} color={theme.warning} />
                  <Text style={styles.warning}>
                    Avoid mixing languages in the same tip for best results.
                  </Text>
                </View>
              )}

              <TouchableOpacity
                style={styles.saveBtn}
                onPress={handleSaveCustomTip}
                disabled={loading}
              >
                <LinearGradient colors={["#FFF", "#E2E8F0"]} style={styles.saveBtnGradient}>
                  {loading ? (
                    <ActivityIndicator color="#1B1464" />
                  ) : (
                    <Text style={styles.saveBtnText}>SAVE CUSTOM TIP</Text>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <LinearGradient colors={theme.gradient} style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <View style={styles.headerContent}>
          <TouchableOpacity 
            style={styles.backBtn} 
            onPress={() => router.back()}
          >
            <Icon name="chevron-left" size={28} color="#FFF" />
          </TouchableOpacity>

          <View style={styles.titleWrap}>
            <Text style={styles.headerTitle}>Health Tips</Text>
            <Text style={styles.headerSub}>ADD WELLNESS MESSAGES</Text>
          </View>

          <View style={{ width: 40 }} />
        </View>
      </LinearGradient>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => fetchTips(true, companionLanguage)}
            tintColor={theme.success}
          />
        }
      >
        <View style={styles.suggestedSection}>
          <Text style={styles.sectionTitle}>💡 Suggested Tips</Text>
          {loading && suggestedTips.length === 0 ? (
            <ActivityIndicator size="large" color={theme.accent} />
          ) : suggestedTips.length === 0 ? (
            <View style={styles.emptyCard}>
              <Icon name="lightbulb-outline" size={40} color="rgba(255,255,255,0.2)" />
              <Text style={styles.emptyText}>No suggestions available</Text>
            </View>
          ) : (
            suggestedTips.map((tip, index) => {
              const alreadyAdded = isAlreadyAdded(tip);
              return (
                <TouchableOpacity
                  key={index}
                  style={[styles.suggestedCard, alreadyAdded && styles.suggestedCardAdded]}
                  onPress={() => !alreadyAdded && handleAddSuggestedTip(tip)}
                  disabled={alreadyAdded || loading}
                >
                  <View style={styles.suggestedCardContent}>
                    <View style={styles.suggestedBadges}>
                      <View style={[styles.badge, styles.badgeCategory]}>
                        <Text style={styles.badgeText}>{getCategoryLabel(tip.category)}</Text>
                      </View>
                      {alreadyAdded && (
                        <View style={styles.badgeAdded}>
                          <Icon name="check" size={12} color={theme.success} />
                          <Text style={styles.badgeAddedText}> Added</Text>
                        </View>
                      )}
                    </View>
                    <Text 
                      style={[
                        styles.suggestedTipText, 
                        alreadyAdded && styles.suggestedTipTextAdded,
                        companionLanguage === "urdu" && { textAlign: "right" }
                      ]}
                    >
                      {tip.text}
                    </Text>
                  </View>
                  {!alreadyAdded && (
                    <TouchableOpacity
                      style={styles.addBtn}
                      onPress={() => handleAddSuggestedTip(tip)}
                      disabled={loading}
                    >
                      <Icon name="plus-circle-outline" size={24} color={theme.success} />
                    </TouchableOpacity>
                  )}
                </TouchableOpacity>
              );
            })
          )}

          <TouchableOpacity
            style={styles.customTipBtn}
            onPress={() => setShowCustomModal(true)}
          >
            <LinearGradient colors={["#7C4DFF", "#5D2E8C"]} style={styles.customTipBtnGradient}>
              <Icon name="pencil-plus-outline" size={20} color="#FFF" />
              <Text style={styles.customTipBtnText}>Add Custom Tip</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>

        <View style={styles.listSection}>
          <Text style={styles.sectionTitle}>📋 Your Tips</Text>
          {tips.length === 0 ? (
            <View style={styles.emptyCard}>
              <Icon name="lightbulb-outline" size={40} color="rgba(255,255,255,0.2)" />
              <Text style={styles.emptyText}>No tips added yet!</Text>
            </View>
          ) : (
            tips.map((tip) => (
              <View key={tip._id} style={styles.tipCard}>
                <View style={styles.tipHeader}>
                  <View style={styles.tipBadges}>
                    <View
                      style={[
                        styles.badge,
                        tip.language === "urdu" ? styles.badgeUrdu : styles.badgeEnglish,
                      ]}
                    >
                      <Text style={styles.badgeText}>{tip.language.toUpperCase()}</Text>
                    </View>
                    <View style={[styles.badge, styles.badgeCategory]}>
                      <Text style={styles.badgeText}>{getCategoryLabel(tip.category)}</Text>
                    </View>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <Text style={styles.tipDate}>
                      {new Date(tip.createdAt).toLocaleDateString()}
                    </Text>
                    <TouchableOpacity onPress={() => handleDelete(tip._id)} style={{ marginLeft: 10 }}>
                      <Icon name="trash-can-outline" size={20} color={theme.danger} />
                    </TouchableOpacity>
                  </View>
                </View>
                <Text 
                  style={[
                    styles.tipText,
                    tip.language === "urdu" && { textAlign: "right" }
                  ]}
                >
                  {tip.tipText}
                </Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", justifyContent: "center", alignItems: "center", padding: 20 },
  alertBox: { backgroundColor: "#1A1648", borderRadius: 20, width: "90%", maxWidth: 400, padding: 24, alignItems: "center", borderWidth: 1, borderColor: theme.glassBorder },
  alertIconBg: { width: 70, height: 70, borderRadius: 35, justifyContent: "center", alignItems: "center", marginBottom: 16 },
  alertTitle: { fontSize: 20, fontWeight: "700", color: theme.textPrimary, marginBottom: 8, textAlign: "center" },
  alertMessage: { fontSize: 14, color: theme.textSecondary, textAlign: "center", marginBottom: 24, lineHeight: 20 },
  alertBtnRow: { flexDirection: "row", width: "100%" },
  alertCancelBtn: { flex: 1, height: 48, justifyContent: "center", alignItems: "center", marginRight: 12, borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)" },
  alertCancelText: { color: theme.textPrimary, fontSize: 14, fontWeight: "600" },
  alertConfirmBtn: { flex: 1, height: 48, borderRadius: 12, overflow: "hidden" },
  alertBtnGradient: { width: "100%", height: "100%", justifyContent: "center", alignItems: "center" },
  alertConfirmText: { color: "#FFF", fontSize: 14, fontWeight: "600" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", justifyContent: "flex-end" },
  modalContent: { backgroundColor: "#120E3D", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: "85%", borderWidth: 1, borderColor: theme.glassBorder },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  modalTitle: { fontSize: 18, fontWeight: "700", color: theme.textPrimary },
  modalScrollContent: { marginBottom: 20 },
  pickerRow: { marginBottom: 16 },
  label: { fontSize: 14, color: theme.textSecondary, marginBottom: 8, fontWeight: "600" },
  pickerContainer: { backgroundColor: "#1A1648", borderRadius: 12, borderWidth: 1, borderColor: theme.glassBorder, overflow: "hidden" },
  picker: { color: "#FFF", width: "100%", height: Platform.OS === 'ios' ? 150 : 50 },
  languageInfo: { flexDirection: "row", alignItems: "center", backgroundColor: "rgba(124,77,255,0.1)", padding: 10, borderRadius: 8, marginBottom: 16 },
  languageInfoText: { color: "#FFF", fontSize: 12, marginLeft: 8 },
  textInput: { backgroundColor: "#1A1648", color: "#FFF", borderRadius: 12, borderWidth: 1, borderColor: theme.glassBorder, padding: 14, height: 100, textAlignVertical: "top", fontSize: 14, marginBottom: 16 },
  warningBox: { flexDirection: "row", alignItems: "center", backgroundColor: "rgba(245,158,11,0.1)", padding: 10, borderRadius: 8, marginBottom: 16 },
  warning: { color: theme.warning, fontSize: 12, marginLeft: 8, flex: 1 },
  saveBtn: { borderRadius: 12, overflow: "hidden", marginTop: 10 },
  saveBtnGradient: { height: 50, justifyContent: "center", alignItems: "center" },
  saveBtnText: { color: "#1B1464", fontSize: 14, fontWeight: "700", letterSpacing: 1 },
  header: { paddingBottom: 20, borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  headerContent: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16 },
  backBtn: { width: 45, height: 45, justifyContent: "center", alignItems: "center" },
  titleWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 28, fontWeight: "800", color: "#FFF", textAlign: "center" },
  headerSub: { fontSize: 11, color: theme.success, fontWeight: "700", letterSpacing: 1.5, marginTop: 4, textAlign: "center" },
  scrollContent: { padding: 20 },
  suggestedSection: { marginBottom: 24 },
  sectionTitle: { fontSize: 18, fontWeight: "700", color: "#FFF", marginBottom: 14 },
  suggestedCard: { flexDirection: "row", backgroundColor: theme.glass, borderRadius: 16, padding: 16, alignItems: "center", marginBottom: 12, borderWidth: 1, borderColor: theme.glassBorder },
  suggestedCardAdded: { borderColor: "rgba(105, 240, 174, 0.3)", backgroundColor: "rgba(105, 240, 174, 0.02)" },
  suggestedCardContent: { flex: 1, paddingRight: 10 },
  suggestedBadges: { flexDirection: "row", marginBottom: 8 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, marginRight: 6 },
  badgeCategory: { backgroundColor: "rgba(255,255,255,0.1)" },
  badgeText: { color: "#FFF", fontSize: 10, fontWeight: "600" },
  badgeAdded: { flexDirection: "row", alignItems: "center", backgroundColor: "rgba(105,240,174,0.15)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  badgeAddedText: { color: theme.success, fontSize: 10, fontWeight: "600" },
  suggestedTipText: { color: "#FFF", fontSize: 14, lineHeight: 20 },
  suggestedTipTextAdded: { color: "rgba(255,255,255,0.4)" },
  addBtn: { width: 36, height: 36, justifyContent: "center", alignItems: "center" },
  customTipBtn: { marginTop: 8, borderRadius: 12, overflow: "hidden" },
  customTipBtnGradient: { height: 48, flexDirection: "row", justifyContent: "center", alignItems: "center" },
  customTipBtnText: { color: "#FFF", fontSize: 14, fontWeight: "600", marginLeft: 8 },
  listSection: { marginTop: 10 },
  emptyCard: { backgroundColor: theme.glass, borderRadius: 16, borderStyle: "dashed", borderWidth: 1, borderColor: "rgba(255,255,255,0.2)", padding: 30, alignItems: "center", justifyContent: "center" },
  emptyText: { color: theme.textSecondary, fontSize: 14, marginTop: 8, textAlign: "center" },
  tipCard: { backgroundColor: "#1A1648", borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: theme.glassBorder },
  tipHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  tipBadges: { flexDirection: "row" },
  badgeUrdu: { backgroundColor: "#059669" },
  badgeEnglish: { backgroundColor: "#2563EB" },
  tipDate: { color: "rgba(255,255,255,0.3)", fontSize: 11 },
  tipText: { color: "#FFF", fontSize: 15, lineHeight: 22, textAlign: "center" },
});