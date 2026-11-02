import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Platform,
  BackHandler,
  StatusBar,
  SafeAreaView,
  Modal,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import Icon from "react-native-vector-icons/MaterialCommunityIcons";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useTranslation } from "../../src/TranslationContext";
import API from "../../src/api/api";
import { fetchCompanionLanguage, normalizeCompanionLang } from "../../services/companionLanguageService";
import { checkIotHealth, getIotDeviceLabel } from "../../services/emotionService";
import { connectSocket, getSocket } from "../../services/socketService";

const theme = {
  gradient: ["#1B1464", "#2E3192"] as const,
  background: "#0F0B38",
  glass: "rgba(255,255,255,0.08)",
  glassBorder: "rgba(255,255,255,0.15)",
  white: "#FFFFFF",
  success: "#69F0AE",
  accent: "#7C4DFF",
  cyan: "#00E5FF",
  amber: "#F59E0B",
};

const ModernAlert = ({ visible, title, message, onConfirm, onCancel, isUrdu }: any) => (
  <Modal visible={visible} transparent animationType="fade">
    <View style={styles.overlay}>
      <View style={styles.alertBox}>
        <View style={styles.alertIconBg}>
          <Icon name="logout-variant" size={35} color={theme.danger} />
        </View>
        <Text style={[styles.alertTitle, { textAlign: isUrdu ? "right" : "center" }]}>{title}</Text>
        <Text style={[styles.alertMessage, { textAlign: isUrdu ? "right" : "center" }]}>{message}</Text>
        <View style={[styles.alertBtnRow, { flexDirection: isUrdu ? "row-reverse" : "row" }]}>
          <TouchableOpacity style={styles.alertCancelBtn} onPress={onCancel}>
            <Text style={styles.alertCancelText}>{isUrdu ? "نہیں" : "Cancel"}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.alertConfirmBtn} onPress={onConfirm}>
            <LinearGradient colors={["#DC2626", "#991B1B"]} style={styles.alertBtnGradient}>
              <Text style={styles.alertConfirmText}>{isUrdu ? "ہاں، لاگ آؤٹ" : "Logout"}</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  </Modal>
);

function getInitials(name: string, email?: string) {
  const cleaned = (name || "").trim();

  if (cleaned) {
    const parts = cleaned.split(" ").filter(Boolean);
    const first = parts[0]?.[0] || "";
    const second = parts[1]?.[0] || "";
    const initials = (first + second).toUpperCase();
    if (initials) return initials;
  }

  const emailFirst = (email || "").trim()?.[0];
  if (emailFirst) return emailFirst.toUpperCase();

  return "U";
}

export default function DashboardScreen() {
  const { t, language, setLanguage } = useTranslation();
  const router = useRouter();
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [companionName, setCompanionName] = useState("");
  const [companionLang, setCompanionLang] = useState<"english" | "urdu">("english");
  const [stats, setStats] = useState({ emergencies: 0, emotions: 0, reminders: 0, tips: 0 });
  const [liveOk, setLiveOk] = useState(false);
  const [deviceLabel, setDeviceLabel] = useState("Companion");
  const [authLoading, setAuthLoading] = useState(true);
  const [logoutVisible, setLogoutVisible] = useState(false);

  const isUrdu = language === "ur";
  const align = isUrdu ? "right" : "left";

  useFocusEffect(
    useCallback(() => {
      let active = true;

      (async () => {
        const token = await AsyncStorage.getItem("token");
        if (!token && active) {
          router.replace("/auth/login");
        } else if (active) {
          setAuthLoading(false);
        }
      })();

      return () => {
        active = false;
      };
    }, [router])
  );

  useFocusEffect(
    useCallback(() => {
      const onBackPress = () => {
        setLogoutVisible(true);
        return true;
      };
      const backHandler = BackHandler.addEventListener("hardwareBackPress", onBackPress);
      return () => backHandler.remove();
    }, [])
  );

  useEffect(() => {
    const loadUser = async () => {
      const storedName = await AsyncStorage.getItem("userName");
      const storedEmail = await AsyncStorage.getItem("userEmail");
      if (storedName) setUserName(storedName);
      if (storedEmail) setUserEmail(storedEmail);

      try {
        const { data: comp } = await API.get("/companion/me");
        setCompanionName(comp?.name || "");
        setCompanionLang(normalizeCompanionLang(comp?.language));
      } catch {
        const lang = await fetchCompanionLanguage();
        setCompanionLang(lang);
      }

      try {
        const { data } = await API.get("/stats/weekly?days=7");
        if (data?.summary) {
          setStats({
            emergencies: data.summary.emergencies?.totalWeek ?? 0,
            emotions: data.summary.emotions?.total ?? 0,
            reminders: data.summary.reminders?.totalWeek ?? 0,
            tips: data.summary.healthTips?.active ?? 0,
          });
        }
      } catch {
        /* stats optional on dashboard */
      }
    };

    if (!authLoading) loadUser();
  }, [authLoading]);

  // Companion LIVE = Raspberry Pi / IoT :5002 health (not Socket.IO)
  useFocusEffect(
    useCallback(() => {
      let active = true;
      const ping = async () => {
        try {
          const iot = await checkIotHealth();
          if (!active) return;
          setLiveOk(!!iot.ok);
          if (iot.base) setDeviceLabel(getIotDeviceLabel(iot.base));
        } catch {
          if (active) setLiveOk(false);
        }
      };
      ping();
      const id = setInterval(ping, 8000);
      return () => {
        active = false;
        clearInterval(id);
      };
    }, [])
  );

  // Keep backend socket for realtime stats (separate from companion LIVE chip)
  useEffect(() => {
    const socket = getSocket();
    connectSocket();
    if (socket.connected) {
      /* backend socket ok — companion status uses IoT ping above */
    }
  }, []);

  const handleLogout = async () => {
    setLogoutVisible(false);
    await AsyncStorage.clear();
    router.replace("/auth/login");
  };

  const toggleLanguage = () => setLanguage(isUrdu ? "en" : "ur");
  const initials = getInitials(userName, userEmail);

  const MenuCard = ({ title, desc, icon, iconColor, onPress, wide }: any) => (
    <TouchableOpacity
      style={[styles.menuCard, wide && styles.menuCardWide]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <LinearGradient
        colors={[`${iconColor}22`, "rgba(255,255,255,0.02)"]}
        style={styles.menuCardGrad}
      >
        <View style={[styles.iconBox, { backgroundColor: `${iconColor}18` }]}>
          <Icon name={icon} size={26} color={iconColor} />
        </View>
        <Text style={[styles.menuTitle, { textAlign: align }]}>{title}</Text>
        <Text style={[styles.menuDesc, { textAlign: align }]} numberOfLines={2}>
          {desc}
        </Text>
        <Icon
          name={isUrdu ? "chevron-left" : "chevron-right"}
          size={20}
          color="rgba(255,255,255,0.25)"
          style={styles.menuChevron}
        />
      </LinearGradient>
    </TouchableOpacity>
  );

  const hour = new Date().getHours();
  const greeting =
    hour < 12
      ? isUrdu
        ? "صبح بخیر"
        : "Good morning"
      : hour < 17
      ? isUrdu
        ? "دوپہر بخیر"
        : "Good afternoon"
      : isUrdu
      ? "شام بخیر"
      : "Good evening";

  if (authLoading) {
    return (
      <View style={styles.loaderWrap}>
        <ActivityIndicator size="large" color="#7C4DFF" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      <ModernAlert
        visible={logoutVisible}
        isUrdu={isUrdu}
        title={isUrdu ? "لاگ آؤٹ" : "Confirm Logout"}
        message={
          isUrdu
            ? "کیا آپ واقعی لاگ آؤٹ کر کے باہر نکلنا چاہتے ہیں؟"
            : "Are you sure you want to logout and exit the app?"
        }
        onConfirm={handleLogout}
        onCancel={() => setLogoutVisible(false)}
      />

      <LinearGradient colors={theme.gradient} style={styles.header}>
        <SafeAreaView>
          <View style={[styles.headerContent, { flexDirection: isUrdu ? "row-reverse" : "row" }]}>
            <View style={[styles.userInfo, { alignItems: isUrdu ? "flex-end" : "flex-start" }]}>
              <Text style={styles.greetingText}>{greeting}</Text>
              <Text style={styles.welcomeText} numberOfLines={1}>
                {userName || t("welcome")}
              </Text>
              <Text style={styles.subtitle}>{t("dashboardSubtitle")}</Text>
            </View>

            <View style={[styles.headerActions, { flexDirection: isUrdu ? "row-reverse" : "row" }]}>
              <TouchableOpacity onPress={toggleLanguage} style={styles.langBtn}>
                <Text style={styles.langBtnText}>{isUrdu ? "English" : "اردو"}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => router.push("/ProfileScreen")} style={styles.avatar}>
                <Text style={styles.avatarText}>{initials}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContainer}>
        {companionName ? (
          <LinearGradient colors={["rgba(124,77,255,0.25)", "rgba(15,11,56,0.9)"]} style={styles.heroCard}>
            <View style={[styles.heroRow, { flexDirection: isUrdu ? "row-reverse" : "row" }]}>
              <View style={styles.heroIcon}>
                <Icon name="account-heart" size={28} color={theme.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.heroLabel, { textAlign: align }]}>
                  {isUrdu ? "آپ کا ساتھی" : "Care Companion"}
                </Text>
                <Text style={[styles.heroName, { textAlign: align }]}>{companionName}</Text>
                <View style={[styles.heroMeta, { flexDirection: isUrdu ? "row-reverse" : "row" }]}>
                  <View style={styles.langChip}>
                    <Icon name="translate" size={12} color={theme.cyan} />
                    <Text style={styles.langChipText}>
                      {companionLang === "urdu" ? "اردو" : "English"}
                    </Text>
                  </View>
                  <View style={[styles.liveChip, liveOk && styles.liveChipOn]}>
                    <View style={[styles.liveDot, { backgroundColor: liveOk ? theme.success : theme.danger }]} />
                    <Text style={styles.liveChipText}>
                      {liveOk ? `LIVE · ${deviceLabel}` : "OFFLINE"}
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          </LinearGradient>
        ) : null}

        <View style={[styles.statsRow, { flexDirection: isUrdu ? "row-reverse" : "row" }]}>
          {[
            { n: stats.emergencies, l: isUrdu ? "ایمرجنسی" : "SOS", c: theme.danger },
            { n: stats.emotions, l: isUrdu ? "جذبات" : "Mood", c: theme.cyan },
            { n: stats.reminders, l: isUrdu ? "یاددہانی" : "Reminders", c: theme.accent },
            { n: stats.tips, l: isUrdu ? "مشورے" : "Tips", c: theme.amber },
          ].map((s) => (
            <View key={s.l} style={styles.statBox}>
              <Text style={[styles.statNum, { color: s.c }]}>{s.n}</Text>
              <Text style={styles.statLbl}>{s.l}</Text>
            </View>
          ))}
        </View>

        <Text style={[styles.sectionTitle, { textAlign: align }]}>
          {isUrdu ? "فوری رسائی" : "Quick Actions"}
        </Text>

        <View style={[styles.grid, { flexDirection: isUrdu ? "row-reverse" : "row" }]}>
          <MenuCard
            title={t("reminders")}
            desc={t("remindersDesc")}
            icon="bell-ring-outline"
            iconColor="#7C4DFF"
            onPress={() => router.push("/reminder")}
          />
          <MenuCard
            title={t("emergency")}
            desc={t("emergencyDesc")}
            icon="alert-octagon-outline"
            iconColor="#FF5252"
            onPress={() => router.push("/emergency")}
          />
          <MenuCard
            title={t("emotionDetection")}
            desc={t("emotionDesc")}
            icon="face-recognition"
            iconColor="#00E5FF"
            onPress={() => router.push("/emotion_detection")}
          />
          <MenuCard
            title={t("weeklyStats")}
            desc={t("weeklyStatsDesc")}
            icon="chart-timeline-variant"
            iconColor="#69F0AE"
            onPress={() => router.push("./weekly-stats")}
          />
          
          {/* 🔥 Health Tips route added below */}
          <MenuCard
            title={isUrdu ? "صحت کے مشورے" : "Health Tips"}
            desc={isUrdu ? "صحت کے مشورے اور آڈیو پیغامات دیکھیں" : "View health tips and voice messages"}
            icon="cards-heart-outline"
            iconColor="#F59E0B"
            onPress={() => router.push("./HealthTipsScreen")}
          />
        </View>

        <View style={[styles.statusBanner, { flexDirection: isUrdu ? "row-reverse" : "row" }]}>
          <View style={styles.statusIconBg}>
            <Icon name="shield-check" size={18} color="#69F0AE" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.statusText, { textAlign: align }]}>
              {isUrdu
                ? "نظام آپ کے ساتھی کی حقیقی وقت میں نگرانی کر رہا ہے۔"
                : "Real-time monitoring active for your care companion."}
            </Text>
            <TouchableOpacity onPress={() => router.push("./weekly-stats")}>
              <Text style={styles.statusLink}>
                {isUrdu ? "ہفتہ وار رپورٹ دیکھیں ←" : "View weekly report →"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0F0B38" },
  header: {
    paddingTop: Platform.OS === "android" ? StatusBar.currentHeight || 0 : 0,
    paddingBottom: 25,
    borderBottomLeftRadius: 35,
    borderBottomRightRadius: 35,
  },
  headerContent: {
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    marginTop: 10,
  },
  userInfo: { flex: 1 },
  greetingText: { fontSize: 12, color: "rgba(255,255,255,0.45)", fontWeight: "600" },
  welcomeText: { fontSize: 22, fontWeight: "800", color: "#FFF", marginTop: 2 },
  subtitle: { fontSize: 12, color: "rgba(255,255,255,0.5)", marginTop: 2 },
  headerActions: { alignItems: "center", gap: 10 },
  langBtn: {
    backgroundColor: "rgba(255,255,255,0.1)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
  },
  langBtnText: { color: "#FFF", fontSize: 10, fontWeight: "700" },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(255,255,255,0.12)",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  avatarText: { color: "#FFF", fontWeight: "800", fontSize: 12 },
  scrollContainer: { padding: 20, paddingBottom: 30 },
  heroCard: {
    borderRadius: 22,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "rgba(124,77,255,0.35)",
  },
  heroRow: { alignItems: "center", gap: 14 },
  heroIcon: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: "rgba(124,77,255,0.2)",
    justifyContent: "center",
    alignItems: "center",
  },
  heroLabel: { fontSize: 11, color: "rgba(255,255,255,0.5)", fontWeight: "600", letterSpacing: 0.5 },
  heroName: { fontSize: 20, fontWeight: "800", color: "#FFF", marginTop: 2 },
  heroMeta: { marginTop: 10, gap: 8, alignItems: "center" },
  langChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(0,229,255,0.12)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  langChipText: { color: theme.cyan, fontSize: 11, fontWeight: "700" },
  liveChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: "rgba(255,82,82,0.12)",
  },
  liveChipOn: { backgroundColor: "rgba(105,240,174,0.12)" },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  liveChipText: { color: "rgba(255,255,255,0.7)", fontSize: 10, fontWeight: "800" },
  statsRow: { justifyContent: "space-between", marginBottom: 18, gap: 8 },
  statBox: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  statNum: { fontSize: 18, fontWeight: "800" },
  statLbl: { fontSize: 9, color: "rgba(255,255,255,0.45)", marginTop: 2, fontWeight: "600" },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: "#FFF", marginBottom: 15, opacity: 0.8 },
  grid: { flexWrap: "wrap", justifyContent: "space-between" },
  menuCard: {
    width: "48%",
    borderRadius: 22,
    marginBottom: 15,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  menuCardWide: { width: "100%" },
  menuCardGrad: { padding: 16, minHeight: 130 },
  menuChevron: { position: "absolute", right: 12, top: 12 },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 12,
  },
  menuTitle: { fontSize: 14, fontWeight: "700", color: "#FFF" },
  menuDesc: { fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 4, lineHeight: 14 },
  statusBanner: {
    backgroundColor: "rgba(105, 240, 174, 0.03)",
    padding: 14,
    borderRadius: 20,
    marginTop: 10,
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: "rgba(105, 240, 174, 0.15)",
  },
  statusIconBg: { backgroundColor: "rgba(105, 240, 174, 0.08)", padding: 6, borderRadius: 8 },
  statusText: { fontSize: 11, color: "rgba(255,255,255,0.6)", fontWeight: "600" },
  statusLink: { fontSize: 11, color: theme.cyan, fontWeight: "700", marginTop: 6 },
  loaderWrap: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#0F0B38" },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.85)",
    justifyContent: "center",
    alignItems: "center",
    padding: 25,
  },
  alertBox: {
    width: "100%",
    backgroundColor: "#1A1648",
    borderRadius: 30,
    padding: 25,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  alertIconBg: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: "rgba(255, 82, 82, 0.1)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },
  alertTitle: { color: "#FFF", fontSize: 20, fontWeight: "800", marginBottom: 8 },
  alertMessage: { color: "rgba(255,255,255,0.5)", fontSize: 14, lineHeight: 20, marginBottom: 25 },
  alertBtnRow: { width: "100%", gap: 12 },
  alertCancelBtn: { flex: 1, paddingVertical: 14, alignItems: "center" },
  alertCancelText: { color: "rgba(255,255,255,0.4)", fontWeight: "700", fontSize: 14 },
  alertConfirmBtn: { flex: 1.5, borderRadius: 15, overflow: "hidden" },
  alertBtnGradient: { paddingVertical: 14, alignItems: "center" },
  alertConfirmText: { color: "#FFF", fontWeight: "800", fontSize: 14 },
});