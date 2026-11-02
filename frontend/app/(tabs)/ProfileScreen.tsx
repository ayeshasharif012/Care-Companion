import React, { useCallback, useEffect, useState, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  Platform,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import Icon from "react-native-vector-icons/MaterialCommunityIcons";
import { LinearGradient } from "expo-linear-gradient";
import { Picker } from "@react-native-picker/picker";

import API from "../../src/api/api";
import { ModernAlert } from "../../components/ModernAlert";
import {
  updateCompanionLanguage,
  normalizeCompanionLang,
  CompanionLang,
} from "../../services/companionLanguageService";

const theme = {
  gradient: ["#1B1464", "#2E3192"] as const,
  background: "#0F0B38",
  glass: "rgba(255,255,255,0.06)",
  glassBorder: "rgba(255,255,255,0.12)",
  danger: "#FF5252",
  success: "#69F0AE",
  cyan: "#00E5FF",
};

export default function ProfileScreen() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [companion, setCompanion] = useState<any>(null);
  const [companionLang, setCompanionLang] = useState<CompanionLang>("english");
  const [pendingLang, setPendingLang] = useState<CompanionLang>("english");
  const [loading, setLoading] = useState(true);
  const [authLoading, setAuthLoading] = useState(true);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [savingLang, setSavingLang] = useState(false);
  const [langMsg, setLangMsg] = useState<string | null>(null);
  const [alertVisible, setAlertVisible] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        const token = await AsyncStorage.getItem("token");
        if (!token) {
          router.replace("/auth/login");
          return;
        }
        if (active) setAuthLoading(false);
      })();
      return () => {
        active = false;
      };
    }, [router])
  );

  const loadProfile = async () => {
    try {
      setLoading(true);
      const userRes = await API.get("/users/me");
      setUser(userRes.data);
      try {
        const companionRes = await API.get("/companion/me");
        setCompanion(companionRes.data);
        const lang = normalizeCompanionLang(companionRes.data?.language);
        setCompanionLang(lang);
        setPendingLang(lang);
      } catch {
        setCompanion(null);
      }
    } catch (err) {
      console.log("Profile load error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading) loadProfile();
  }, [authLoading]);

  const initials = useMemo(() => {
    const name = user?.name || "";
    if (!name) return "";
    return name
      .split(" ")
      .map((n: string) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }, [user?.name]);

  const langChanged = pendingLang !== companionLang;

  const handleSaveLanguage = async () => {
    if (!companion || !langChanged) return;
    setSavingLang(true);
    setLangMsg(null);
    try {
      const lang = await updateCompanionLanguage(pendingLang);
      setCompanionLang(lang);
      setCompanion((c: any) => (c ? { ...c, language: lang } : c));
      setLangMsg(
        lang === "urdu"
          ? "Companion ab Urdu mein baat karega — reminders, health tips, voice & stories."
          : "Companion will now use English for reminders, health tips, voice & stories."
      );
    } catch (err: any) {
      setLangMsg(err?.response?.data?.message || "Could not update language");
    } finally {
      setSavingLang(false);
    }
  };

  const handleLogout = async () => {
    try {
      setLogoutLoading(true);
      setAlertVisible(false);
      await AsyncStorage.clear();
      router.replace("/auth/login");
    } finally {
      setLogoutLoading(false);
    }
  };

  if (authLoading || loading) {
    return (
      <View style={styles.loaderWrap}>
        <ActivityIndicator size="large" color="#FFF" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      <ModernAlert
        visible={alertVisible}
        title="Logout Account"
        message="Are you sure you want to sign out?"
        type="danger"
        confirmText="Logout"
        onCancel={() => setAlertVisible(false)}
        onConfirm={handleLogout}
      />
      <LinearGradient colors={theme.gradient} style={styles.header}>
        <SafeAreaView>
          <View style={styles.headerContent}>
            <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
              <Icon name="chevron-left" size={30} color="#FFF" />
            </TouchableOpacity>
            <View style={styles.headerCenter}>
              <Text style={styles.headerTitle}>My Profile</Text>
              <Text style={styles.headerSub}>Care Companion</Text>
            </View>
            <View style={{ width: 40 }} />
          </View>
        </SafeAreaView>
      </LinearGradient>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.glassCard}>
          <LinearGradient colors={["#2E3192", "#1B1464"]} style={styles.avatar}>
            <Text style={styles.avatarText}>{initials || "U"}</Text>
          </LinearGradient>
          <View style={styles.avatarInfo}>
            <Text style={styles.avatarName}>{user?.name || "User"}</Text>
            <Text style={styles.avatarEmail} numberOfLines={1}>{user?.email}</Text>
          </View>
        </View>
        <Text style={styles.sectionTitle}>Account Details</Text>
        <View style={styles.glassCardContainer}>
          <InfoRow icon="account-outline" label="Name" value={user?.name} />
          <Divider />
          <InfoRow icon="email-outline" label="Email" value={user?.email} />
          {user?.mobile && (
            <>
              <Divider />
              <InfoRow icon="phone-outline" label="Phone" value={user.mobile} />
            </>
          )}
        </View>
        <Text style={[styles.sectionTitle, { marginTop: 25 }]}>Companion Profile</Text>
        <View style={styles.glassCardContainer}>
          {companion ? (
            <>
              <InfoRow icon="heart-outline" label="Name" value={companion.name} />
              <Divider />
              <InfoRow icon="calendar-outline" label="Age" value={companion.age ? `${companion.age} years` : "—"} />
              <Divider />
              <InfoRow icon="human-male-female" label="Gender" value={companion.gender} />
              <Divider />
              <View style={styles.langBlock}>
                <View style={styles.langHeader}>
                  <Icon name="translate" size={20} color={theme.cyan} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.langTitle}>Companion Language</Text>
                    <Text style={styles.langHint}>
                      Reminders, health tips, voice chat & storytelling on the Pi use this language.
                    </Text>
                  </View>
                </View>
                <View style={styles.pickerWrap}>
                  <Picker
                    selectedValue={pendingLang}
                    style={styles.picker}
                    dropdownIconColor="#FFF"
                    onValueChange={(v) => setPendingLang(normalizeCompanionLang(v))}
                  >
                    <Picker.Item label="English" value="english" />
                    <Picker.Item label="Urdu (اردو)" value="urdu" />
                  </Picker>
                </View>
                <View style={styles.langCurrentRow}>
                  <Text style={styles.langCurrentLabel}>Active:</Text>
                  <View style={styles.langBadge}>
                    <Text style={styles.langBadgeText}>{companionLang === "urdu" ? "اردو" : "English"}</Text>
                  </View>
                </View>
                {langMsg ? <Text style={styles.langMsg}>{langMsg}</Text> : null}
                <TouchableOpacity
                  style={[styles.saveLangBtn, !langChanged && styles.saveLangBtnDisabled]}
                  onPress={handleSaveLanguage}
                  disabled={!langChanged || savingLang}
                >
                  {savingLang ? (
                    <ActivityIndicator color="#1B1464" />
                  ) : (
                    <>
                      <Icon name="content-save-check" size={18} color="#1B1464" />
                      <Text style={styles.saveLangText}>Save Language</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <Text style={styles.noDataText}>No companion profile found.</Text>
          )}
        </View>
        <TouchableOpacity style={styles.logoutBtn} onPress={() => setAlertVisible(true)} disabled={logoutLoading}>
          {logoutLoading ? (
            <ActivityIndicator color={theme.danger} />
          ) : (
            <>
              <Icon name="logout" size={20} color={theme.danger} />
              <Text style={styles.logoutBtnText}>Logout</Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const InfoRow = ({ icon, label, value }: any) => (
  <View style={styles.row}>
    <View style={styles.rowLeft}>
      <Icon name={icon} size={20} color="rgba(255,255,255,0.6)" />
      <Text style={styles.label}>{label}</Text>
    </View>
    <Text style={styles.value} numberOfLines={1}>{value || "—"}</Text>
  </View>
);

const Divider = () => <View style={styles.divider} />;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  header: {
    paddingTop: Platform.OS === "android" ? StatusBar.currentHeight || 0 : 0,
    paddingBottom: 25,
    borderBottomLeftRadius: 35,
    borderBottomRightRadius: 35,
  },
  headerContent: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, marginTop: 15 },
  headerCenter: { flex: 1, alignItems: "center" },
  headerTitle: { color: "#FFF", fontSize: 22, fontWeight: "800" },
  headerSub: { color: "rgba(255,255,255,0.5)", fontSize: 12, marginTop: 2 },
  backBtn: { width: 40, height: 40, justifyContent: "center" },
  scrollContent: { padding: 20 },
  glassCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.glass,
    padding: 20,
    borderRadius: 24,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: theme.glassBorder,
  },
  avatar: { width: 60, height: 60, borderRadius: 30, justifyContent: "center", alignItems: "center", marginRight: 15 },
  avatarText: { color: "#FFF", fontSize: 20, fontWeight: "bold" },
  avatarInfo: { flex: 1 },
  avatarName: { fontSize: 20, fontWeight: "800", color: "#FFF" },
  avatarEmail: { fontSize: 13, color: "rgba(255,255,255,0.5)" },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "rgba(255,255,255,0.7)",
    marginBottom: 10,
    marginLeft: 5,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  glassCardContainer: {
    backgroundColor: theme.glass,
    borderRadius: 22,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: theme.glassBorder,
  },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 18, alignItems: "center" },
  rowLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  label: { color: "rgba(255,255,255,0.5)", fontSize: 14, fontWeight: "600" },
  value: { fontSize: 14, fontWeight: "700", color: "#FFF", flex: 1, textAlign: "right" },
  divider: { height: 1, backgroundColor: "rgba(255,255,255,0.08)" },
  langBlock: { paddingVertical: 16 },
  langHeader: { flexDirection: "row", gap: 12, marginBottom: 12, alignItems: "flex-start" },
  langTitle: { color: "#FFF", fontSize: 15, fontWeight: "700" },
  langHint: { color: "rgba(255,255,255,0.45)", fontSize: 11, marginTop: 4, lineHeight: 16 },
  pickerWrap: {
    backgroundColor: "rgba(0,0,0,0.25)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    overflow: "hidden",
  },
  picker: { color: "#FFF", width: "100%" },
  langCurrentRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 },
  langCurrentLabel: { color: "rgba(255,255,255,0.5)", fontSize: 12 },
  langBadge: { backgroundColor: "rgba(0,229,255,0.15)", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  langBadgeText: { color: theme.cyan, fontWeight: "700", fontSize: 12 },
  langMsg: { color: theme.success, fontSize: 12, marginTop: 10, lineHeight: 18 },
  saveLangBtn: {
    marginTop: 14,
    backgroundColor: "#FFF",
    borderRadius: 14,
    paddingVertical: 12,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
  },
  saveLangBtnDisabled: { opacity: 0.45 },
  saveLangText: { color: "#1B1464", fontWeight: "800", fontSize: 14 },
  logoutBtn: {
    marginTop: 35,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 10,
    padding: 18,
    borderRadius: 20,
    backgroundColor: "rgba(255, 82, 82, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(255, 82, 82, 0.3)",
    marginBottom: 40,
  },
  logoutBtnText: { color: theme.danger, fontWeight: "800", fontSize: 16 },
  loaderWrap: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: theme.background },
  noDataText: { textAlign: "center", color: "rgba(255,255,255,0.4)", padding: 25, fontSize: 13 },
});
