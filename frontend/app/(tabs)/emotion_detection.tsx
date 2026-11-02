import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  ActivityIndicator,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  StatusBar,
  Platform,
  Dimensions,
  TouchableOpacity,
  RefreshControl,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Icon from "react-native-vector-icons/MaterialCommunityIcons";
import { useRouter } from "expo-router";
import { useTranslation } from "../../src/TranslationContext";
import {
  getLatestEmotion,
  getEmotionHistory,
  triggerPiEmotionScan,
  startPiVoiceChat,
  playStoryOnPi,
  checkIotHealth,
  getIotDeviceLabel,
} from "../../services/emotionService";

const { width } = Dimensions.get("window");
const CIRCLE_SIZE = Math.min(width * 0.68, 280);
const INNER_SIZE = Math.min(width * 0.56, 230);

type EmotionData = {
  emotion: string;
  confidence: number;
  createdAt?: string;
} | null;

const theme = {
  gradient: ["#1B1464", "#2E3192"] as const,
  cardGrad: ["rgba(255,255,255,0.1)", "rgba(255,255,255,0.03)"] as const,
  background: "#0F0B38",
  glass: "rgba(255,255,255,0.06)",
  glassBorder: "rgba(255,255,255,0.12)",
  success: "#69F0AE",
  accent: "#7C4DFF",
  cyan: "#00E5FF",
  danger: "#FF5252",
  amber: "#F59E0B",
  textSecondary: "rgba(255,255,255,0.5)",
};

function emotionMeta(emotion: string) {
  const e = (emotion || "").toLowerCase();
  if (e.includes("happy"))
    return { icon: "emoticon-happy-outline", color: theme.success, label: "Happy", labelUr: "خوش" };
  if (e.includes("sad"))
    return { icon: "emoticon-sad-outline", color: "#4FC3F7", label: "Sad", labelUr: "اداس" };
  if (e.includes("angry"))
    return { icon: "emoticon-angry-outline", color: theme.danger, label: "Angry", labelUr: "غصہ" };
  if (e.includes("neutral"))
    return { icon: "emoticon-neutral-outline", color: theme.accent, label: "Neutral", labelUr: "نارمل" };
  return { icon: "face-recognition", color: "#FFF", label: "Ready", labelUr: "تیار" };
}

function formatTime(iso?: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function EmotionScreen() {
  const router = useRouter();
  const { language } = useTranslation();
  const isUrdu = language === "ur";

  const [emotionData, setEmotionData] = useState<EmotionData>(null);
  const [history, setHistory] = useState<EmotionData[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isChatting, setIsChatting] = useState(false);
  const [story, setStory] = useState("");
  const [storyLoading, setStoryLoading] = useState(false);
  const [playingStory, setPlayingStory] = useState(false);
  const [actionError, setActionError] = useState("");
  const [iotOnline, setIotOnline] = useState(false);
  const [deviceLabel, setDeviceLabel] = useState("Companion");
  const [statusHint, setStatusHint] = useState("");

  const t = {
    title: isUrdu ? "جذبات کی پہچان" : "Emotion Detection",
    sub: isUrdu ? "AI موڈ انسائٹس" : "AI MOOD INSIGHTS",
    scan: isUrdu ? "مائیک سے اسکین" : "Scan from mic",
    scanning: isUrdu ? "سن رہا ہے..." : "Listening...",
    chat: isUrdu ? "سپورٹو چیٹ" : "Supportive chat",
    chatting: isUrdu ? "بات چیت..." : "Talking...",
    story: isUrdu ? "کہانی سنائیں" : "Play calming story",
    playing: isUrdu ? "چل رہی ہے..." : "Playing...",
    confidence: isUrdu ? "اعتماد" : "Confidence",
    status: isUrdu ? "حالت" : "Status",
    recent: isUrdu ? "حالیہ اسکین" : "Recent scans",
    device: isUrdu ? "آلہ" : "Device",
    online: isUrdu ? "آن لائن" : "Online",
    offline: isUrdu ? "آف لائن" : "Offline",
    params: isUrdu ? "تفصیلات" : "Detection details",
    storyTitle: isUrdu ? "کہانی" : "Emotion storytelling",
    help: isUrdu
      ? "Pi یا laptop پر main.py چلائیں۔ مائیک companion device سے آواز لے گا۔"
      : "Run main.py on Pi or laptop. Mic captures from the companion device.",
    noHistory: isUrdu ? "ابھی کوئی اسکین نہیں" : "No scans yet",
  };

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [latest, hist, iot] = await Promise.all([
        getLatestEmotion(),
        getEmotionHistory(7),
        checkIotHealth(),
      ]);

      if (latest?.emotion) setEmotionData(latest);
      setHistory(Array.isArray(hist) ? hist.slice(0, 5) : []);
      setIotOnline(iot.ok);
      if (iot.base) setDeviceLabel(getIotDeviceLabel(iot.base));
      setStatusHint(
        iot.ok
          ? isUrdu
            ? `${getIotDeviceLabel(iot.base)} سے منسلک`
            : `Connected · ${getIotDeviceLabel(iot.base)}`
          : isUrdu
          ? "Companion IoT آف لائن"
          : "Companion IoT offline"
      );
    } catch (err) {
      console.error("Emotion load:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [isUrdu]);

  useEffect(() => {
    loadData();
    const poll = setInterval(() => loadData(true), 8000);
    return () => clearInterval(poll);
  }, [loadData]);

  const scanFromMic = async () => {
    setIsScanning(true);
    setActionError("");
    setStatusHint(isUrdu ? "مائیک سن رہا ہے..." : "Listening on companion mic...");
    try {
      const result = await triggerPiEmotionScan(4);
      if (result?.error || !result?.emotion) {
        setActionError(
          result?.error ||
            (isUrdu
              ? "اسکین ناکام — main.py (:5002) اور emotion (:5001) چلائیں"
              : "Scan failed — start main.py (:5002) and emotion service (:5001)")
        );
        return;
      }
      setEmotionData({
        emotion: result.emotion,
        confidence: result.confidence ?? 0.5,
        createdAt: new Date().toISOString(),
      });
      if (result.device) setDeviceLabel(result.device);
      setIotOnline(true);
      setStatusHint(
        isUrdu ? `${result.device || "Device"} سے اسکین مکمل` : `Scan complete · ${result.device || "Device"}`
      );
      await loadData(true);
    } finally {
      setIsScanning(false);
    }
  };

  const talkOnCompanion = async () => {
    setIsChatting(true);
    setActionError("");
    try {
      const data = await startPiVoiceChat(2);
      if (!data || data.status !== "success") {
        setActionError(data?.message || (isUrdu ? "چیٹ ناکام" : "Voice chat failed"));
        return;
      }
      if (data.emotion) {
        setEmotionData({
          emotion: data.emotion,
          confidence: data.turns?.[data.turns.length - 1]?.confidence ?? 0.7,
        });
      }
      if (data.bot_response) setStory(data.bot_response);
      await loadData(true);
    } finally {
      setIsChatting(false);
    }
  };

  const playStory = async () => {
    setPlayingStory(true);
    setStoryLoading(true);
    setActionError("");
    try {
      const data = await playStoryOnPi(emotionData?.emotion);
      if (!data?.story) {
        setActionError(isUrdu ? "کہانی نہیں چل سکی" : "Could not play story");
        return;
      }
      setStory(data.story);
    } finally {
      setStoryLoading(false);
      setPlayingStory(false);
    }
  };

  const info = emotionMeta(emotionData?.emotion || "");
  const busy = isScanning || isChatting || playingStory;
  const label = isUrdu ? info.labelUr : info.label;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      <LinearGradient colors={theme.gradient} style={styles.header}>
        <SafeAreaView>
          <View style={styles.headerRow}>
            <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
              <Icon name="chevron-left" size={28} color="#FFF" />
            </TouchableOpacity>
            <View style={styles.headerCenter}>
              <Text style={styles.headerTitle}>{t.title}</Text>
              <Text style={styles.headerSub}>{t.sub}</Text>
            </View>
            <TouchableOpacity style={styles.refreshBtn} onPress={() => loadData(true)}>
              <Icon name="reload" size={20} color={theme.success} />
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </LinearGradient>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              loadData(true);
            }}
            tintColor={theme.success}
          />
        }
      >
        <View style={[styles.deviceRow, { flexDirection: isUrdu ? "row-reverse" : "row" }]}>
          <View style={[styles.deviceChip, iotOnline ? styles.deviceOnline : styles.deviceOffline]}>
            <View style={[styles.liveDot, { backgroundColor: iotOnline ? theme.success : theme.danger }]} />
            <Text style={styles.deviceChipText}>{iotOnline ? t.online : t.offline}</Text>
          </View>
          <View style={styles.deviceChip}>
            <Icon name="lan-connect" size={14} color={theme.cyan} />
            <Text style={styles.deviceName}>{deviceLabel}</Text>
          </View>
        </View>

        <View style={styles.ringWrap}>
          <View style={[styles.outerRing, busy && { borderColor: theme.success }]}>
            <LinearGradient colors={theme.cardGrad} style={[styles.innerRing, { borderColor: info.color }]}>
              {loading && !emotionData ? (
                <ActivityIndicator size="large" color={theme.cyan} />
              ) : (
                <>
                  <Icon name={info.icon} size={INNER_SIZE * 0.32} color={info.color} />
                  <Text style={[styles.emotionName, { color: info.color }]}>
                    {(emotionData?.emotion || "READY").toUpperCase()}
                  </Text>
                  <Text style={styles.emotionPct}>
                    {emotionData
                      ? `${Math.round((emotionData.confidence || 0) * 100)}% ${t.confidence}`
                      : "—"}
                  </Text>
                </>
              )}
            </LinearGradient>
          </View>
          <Text style={styles.statusHint}>{statusHint}</Text>
        </View>

        {actionError ? (
          <View style={styles.errorBox}>
            <Icon name="alert-circle-outline" size={16} color="#FFB4AB" />
            <Text style={styles.errorText}>{actionError}</Text>
          </View>
        ) : null}

        <LinearGradient colors={theme.cardGrad} style={styles.card}>
          <Text style={styles.cardLabel}>{t.params}</Text>
          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statTitle}>{t.confidence}</Text>
              <Text style={styles.statValue}>
                {emotionData ? `${Math.round((emotionData.confidence || 0) * 100)}%` : "—"}
              </Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statBox}>
              <Text style={styles.statTitle}>{t.status}</Text>
              <Text style={[styles.statValue, { color: info.color, fontSize: 15 }]}>{label}</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statBox}>
              <Text style={styles.statTitle}>{t.device}</Text>
              <Text style={[styles.statValue, { fontSize: 13 }]}>{deviceLabel}</Text>
            </View>
          </View>
          {emotionData?.createdAt ? (
            <Text style={styles.timeText}>{formatTime(emotionData.createdAt)}</Text>
          ) : null}
        </LinearGradient>

        <TouchableOpacity style={styles.primaryBtn} onPress={scanFromMic} disabled={busy}>
          <Icon name="microphone" size={20} color="#1B1464" />
          <Text style={styles.primaryBtnText}>{isScanning ? t.scanning : t.scan}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.primaryBtn, styles.secondaryBtn]} onPress={talkOnCompanion} disabled={busy}>
          <Icon name="account-voice" size={20} color="#FFF" />
          <Text style={[styles.primaryBtnText, { color: "#FFF" }]}>{isChatting ? t.chatting : t.chat}</Text>
        </TouchableOpacity>

        <LinearGradient colors={theme.cardGrad} style={styles.card}>
          <Text style={styles.cardLabel}>{t.storyTitle}</Text>
          {storyLoading && !story ? (
            <ActivityIndicator color={theme.accent} />
          ) : (
            <Text style={styles.storyText}>
              {story ||
                (isUrdu
                  ? "اسکین یا چیٹ کے بعد کہانی سنیں — companion speaker سے۔"
                  : "Scan or chat first, then play a calming story on the companion speaker.")}
            </Text>
          )}
          <TouchableOpacity style={styles.storyBtn} onPress={playStory} disabled={busy}>
            <Icon name="volume-high" size={18} color="#FFF" />
            <Text style={styles.storyBtnText}>{playingStory ? t.playing : t.story}</Text>
          </TouchableOpacity>
        </LinearGradient>

        <Text style={[styles.sectionTitle, { textAlign: isUrdu ? "right" : "left" }]}>{t.recent}</Text>
        {history.length === 0 ? (
          <Text style={styles.emptyHist}>{t.noHistory}</Text>
        ) : (
          history.map((item, i) => {
            const m = emotionMeta(item?.emotion || "");
            return (
              <View key={`${item?.createdAt}-${i}`} style={styles.histRow}>
                <View style={[styles.histIcon, { backgroundColor: `${m.color}18` }]}>
                  <Icon name={m.icon} size={18} color={m.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.histEmotion}>{item?.emotion}</Text>
                  <Text style={styles.histTime}>{formatTime(item?.createdAt)}</Text>
                </View>
                <Text style={[styles.histConf, { color: m.color }]}>
                  {Math.round((item?.confidence || 0) * 100)}%
                </Text>
              </View>
            );
          })
        )}

        <Text style={styles.helpText}>{t.help}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  header: {
    paddingTop: Platform.OS === "android" ? StatusBar.currentHeight || 0 : 0,
    paddingBottom: 22,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    marginTop: 8,
  },
  backBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.08)",
    justifyContent: "center",
    alignItems: "center",
  },
  refreshBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.08)",
    justifyContent: "center",
    alignItems: "center",
  },
  headerCenter: { flex: 1, alignItems: "center" },
  headerTitle: { color: "#FFF", fontSize: 22, fontWeight: "800" },
  headerSub: { color: theme.cyan, fontSize: 10, fontWeight: "800", letterSpacing: 1.2, marginTop: 4 },
  scroll: { padding: 20, paddingBottom: 40 },
  deviceRow: { gap: 10, marginBottom: 16, flexWrap: "wrap" },
  deviceChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: theme.glass,
    borderWidth: 1,
    borderColor: theme.glassBorder,
  },
  deviceOnline: { borderColor: "rgba(105,240,174,0.35)" },
  deviceOffline: { borderColor: "rgba(255,82,82,0.35)" },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
  deviceChipText: { color: "#FFF", fontSize: 11, fontWeight: "700" },
  deviceName: { color: theme.cyan, fontSize: 11, fontWeight: "700" },
  ringWrap: { alignItems: "center", marginBottom: 16 },
  outerRing: {
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: CIRCLE_SIZE / 2,
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: theme.glassBorder,
    justifyContent: "center",
    alignItems: "center",
  },
  innerRing: {
    width: INNER_SIZE,
    height: INNER_SIZE,
    borderRadius: INNER_SIZE / 2,
    borderWidth: 3,
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
  emotionName: { fontSize: 18, fontWeight: "900", marginTop: 10, letterSpacing: 1 },
  emotionPct: { color: theme.textSecondary, fontSize: 12, marginTop: 4 },
  statusHint: { color: theme.textSecondary, fontSize: 11, marginTop: 12, fontWeight: "600" },
  errorBox: {
    flexDirection: "row",
    gap: 8,
    backgroundColor: "rgba(255,82,82,0.1)",
    borderLeftWidth: 3,
    borderLeftColor: theme.danger,
    padding: 12,
    borderRadius: 10,
    marginBottom: 14,
  },
  errorText: { color: "#FFB4AB", fontSize: 12, flex: 1, lineHeight: 18 },
  card: {
    borderRadius: 22,
    padding: 18,
    borderWidth: 1,
    borderColor: theme.glassBorder,
    marginBottom: 14,
  },
  cardLabel: {
    color: theme.textSecondary,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
    marginBottom: 12,
  },
  statsRow: { flexDirection: "row", alignItems: "center" },
  statBox: { flex: 1, alignItems: "center" },
  statTitle: { color: theme.textSecondary, fontSize: 10, marginBottom: 4 },
  statValue: { color: "#FFF", fontSize: 18, fontWeight: "800" },
  statDivider: { width: 1, height: 28, backgroundColor: theme.glassBorder },
  timeText: { color: theme.textSecondary, fontSize: 11, marginTop: 12, textAlign: "center" },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: theme.success,
    paddingVertical: 15,
    borderRadius: 16,
    marginBottom: 10,
  },
  secondaryBtn: { backgroundColor: theme.accent },
  primaryBtnText: { color: "#1B1464", fontWeight: "800", fontSize: 15 },
  storyText: { color: "#FFF", fontSize: 14, lineHeight: 22, opacity: 0.9 },
  storyBtn: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: theme.accent,
    paddingVertical: 12,
    borderRadius: 14,
  },
  storyBtnText: { color: "#FFF", fontWeight: "700", fontSize: 14 },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "rgba(255,255,255,0.75)",
    marginTop: 8,
    marginBottom: 10,
  },
  emptyHist: { color: theme.textSecondary, fontSize: 13, textAlign: "center", marginBottom: 12 },
  histRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  histIcon: { width: 36, height: 36, borderRadius: 12, justifyContent: "center", alignItems: "center" },
  histEmotion: { color: "#FFF", fontWeight: "700", fontSize: 14, textTransform: "capitalize" },
  histTime: { color: theme.textSecondary, fontSize: 11, marginTop: 2 },
  histConf: { fontWeight: "800", fontSize: 13 },
  helpText: {
    color: theme.textSecondary,
    fontSize: 11,
    textAlign: "center",
    marginTop: 16,
    lineHeight: 17,
  },
});
