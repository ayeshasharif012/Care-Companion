import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  SafeAreaView,
  StatusBar,
  Platform,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Icon from "react-native-vector-icons/MaterialCommunityIcons";
import { useRouter, useFocusEffect } from "expo-router";
import { Socket } from "socket.io-client";
import API from "../../src/api/api";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useTranslation } from "../../src/TranslationContext";
import { connectSocket, getSocket } from "../../services/socketService";
import { triggerLocalNotification } from "../../services/NotificationService";

const WEEK_DAYS = 7;
const POLL_MS = 8000;

const theme = {
  gradient: ["#1B1464", "#2E3192"] as const,
  cardGrad: ["rgba(255,255,255,0.1)", "rgba(255,255,255,0.03)"] as const,
  background: "#0F0B38",
  glass: "rgba(255,255,255,0.06)",
  glassBorder: "rgba(255,255,255,0.12)",
  cardBg: "#1A1648",
  success: "#69F0AE",
  accent: "#7C4DFF",
  cyan: "#00E5FF",
  amber: "#F59E0B",
  danger: "#FF5252",
  textSecondary: "rgba(255,255,255,0.5)",
};

type EmotionEntry = { emotion: string; confidence: number; createdAt: string };
type EmergencyAlert = {
  _id: string;
  message: string;
  status: "active" | "resolved";
  createdAt?: string;
  resolvedAt?: string;
  companionId?: { name: string };
};
type ReminderItem = {
  _id: string;
  title: string;
  description?: string;
  status: "pending" | "completed";
  date: string;
  updatedAt?: string;
  createdAt?: string;
};
type HealthTipItem = {
  _id: string;
  category: string;
  tipText: string;
  language?: string;
  createdAt?: string;
};
type LiveEvent = {
  id: string;
  type: "emergency" | "emotion" | "reminder" | "tip";
  title: string;
  subtitle: string;
  time: string;
  color: string;
  icon: string;
};

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function weekStartDate() {
  const d = new Date();
  d.setDate(d.getDate() - (WEEK_DAYS - 1));
  return startOfDay(d);
}

function isInWeek(iso?: string) {
  if (!iso) return false;
  return new Date(iso) >= weekStartDate();
}

function dayKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function last7DayLabels(isUrdu: boolean) {
  const labels: string[] = [];
  for (let i = WEEK_DAYS - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    labels.push(
      d.toLocaleDateString(isUrdu ? "ur-PK" : "en-US", { weekday: "short" })
    );
  }
  return labels;
}

function last7DayKeys() {
  const keys: string[] = [];
  for (let i = WEEK_DAYS - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    keys.push(dayKey(d.toISOString()));
  }
  return keys;
}

function formatRange(isUrdu: boolean) {
  const end = new Date();
  const start = weekStartDate();
  const fmt = (d: Date) =>
    d.toLocaleDateString(isUrdu ? "ur-PK" : "en-US", {
      month: "short",
      day: "numeric",
    });
  return `${fmt(start)} – ${fmt(end)}`;
}

function formatDateTime(iso?: string, isUrdu = false) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(isUrdu ? "ur-PK" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRelative(iso?: string, isUrdu = false) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return isUrdu ? "ابھی" : "Just now";
  if (mins < 60) return isUrdu ? `${mins} منٹ پہلے` : `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return isUrdu ? `${hrs} گھنٹے پہلے` : `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return isUrdu ? `${days} دن پہلے` : `${days}d ago`;
}

function emotionColor(emotion: string) {
  const e = emotion?.toLowerCase() || "";
  if (e.includes("happy")) return theme.success;
  if (e.includes("sad")) return "#4FC3F7";
  if (e.includes("angry")) return theme.danger;
  return theme.accent;
}

function emotionIcon(emotion: string) {
  const e = emotion?.toLowerCase() || "";
  if (e.includes("happy")) return "emoticon-happy-outline";
  if (e.includes("sad")) return "emoticon-sad-outline";
  if (e.includes("angry")) return "emoticon-angry-outline";
  return "emoticon-neutral-outline";
}

function categoryColor(cat: string) {
  const c = cat?.toLowerCase() || "";
  if (c.includes("hydration")) return "#38BDF8";
  if (c.includes("exercise")) return theme.success;
  if (c.includes("nutrition")) return theme.amber;
  if (c.includes("posture")) return theme.accent;
  if (c.includes("wellness")) return "#F472B6";
  return theme.cyan;
}

function StatusRow({
  items,
}: {
  items: { label: string; count: number; color: string }[];
}) {
  return (
    <View style={styles.statusRow}>
      {items.map((item) => (
        <View
          key={item.label}
          style={[styles.statusChip, { borderColor: `${item.color}55`, backgroundColor: `${item.color}12` }]}
        >
          <Text style={[styles.statusChipCount, { color: item.color }]}>{item.count}</Text>
          <Text style={styles.statusChipLabel}>{item.label}</Text>
        </View>
      ))}
    </View>
  );
}

function StatPill({
  label,
  value,
  color,
  icon,
  sub,
}: {
  label: string;
  value: string | number;
  color: string;
  icon: string;
  sub?: string;
}) {
  return (
    <View style={styles.statPill}>
      <View style={[styles.statPillIcon, { backgroundColor: `${color}22` }]}>
        <Icon name={icon} size={18} color={color} />
      </View>
      <Text style={styles.statPillValue}>{value}</Text>
      <Text style={styles.statPillLabel}>{label}</Text>
      {sub ? <Text style={styles.statPillSub}>{sub}</Text> : null}
    </View>
  );
}

function SectionCard({
  title,
  icon,
  iconColor,
  children,
  badge,
  live,
}: {
  title: string;
  icon: string;
  iconColor: string;
  children: React.ReactNode;
  badge?: string;
  live?: boolean;
}) {
  return (
    <View style={styles.sectionCard}>
      <View style={styles.sectionHeader}>
        <View style={[styles.sectionIconBox, { backgroundColor: `${iconColor}18` }]}>
          <Icon name={icon} size={20} color={iconColor} />
        </View>
        <Text style={styles.sectionTitle}>{title}</Text>
        {live ? (
          <View style={styles.liveBadge}>
            <View style={styles.liveBadgeDot} />
            <Text style={styles.liveBadgeText}>LIVE</Text>
          </View>
        ) : null}
        {badge ? (
          <View style={styles.sectionBadge}>
            <Text style={styles.sectionBadgeText}>{badge}</Text>
          </View>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function MiniBarChart({
  labels,
  values,
  color,
  maxValue,
}: {
  labels: string[];
  values: number[];
  color: string;
  maxValue?: number;
}) {
  const max = maxValue ?? Math.max(...values, 1);
  return (
    <View style={styles.barChart}>
      {labels.map((label, i) => {
        const h = Math.max(6, (values[i] / max) * 72);
        return (
          <View key={`${label}-${i}`} style={styles.barCol}>
            <Text style={styles.barValue}>{values[i] > 0 ? values[i] : ""}</Text>
            <View style={[styles.bar, { height: h, backgroundColor: color }]} />
            <Text style={styles.barLabel}>{label}</Text>
          </View>
        );
      })}
    </View>
  );
}

export default function WeeklyStatsScreen() {
  const router = useRouter();
  const { language } = useTranslation();
  const isUrdu = language === "ur";

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [socketLive, setSocketLive] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [liveToast, setLiveToast] = useState<string | null>(null);

  const [emotions, setEmotions] = useState<EmotionEntry[]>([]);
  const [emergencies, setEmergencies] = useState<EmergencyAlert[]>([]);
  const [reminders, setReminders] = useState<ReminderItem[]>([]);
  const [healthTips, setHealthTips] = useState<HealthTipItem[]>([]);

  const socketRef = useRef<Socket | null>(null);
  const prevRemindersRef = useRef<ReminderItem[]>([]);
  const prevEmotionCountRef = useRef(0);

  const dayLabels = useMemo(() => last7DayLabels(isUrdu), [isUrdu]);
  const dayKeys = useMemo(() => last7DayKeys(), []);

  const showToast = (msg: string) => {
    setLiveToast(msg);
    setTimeout(() => setLiveToast(null), 4000);
  };

  const applyStatsPayload = useCallback(
    (data: {
      emergencies?: EmergencyAlert[];
      emotions?: EmotionEntry[];
      reminders?: ReminderItem[];
      healthTips?: HealthTipItem[];
    }, silent = false) => {
      if (data.emotions) {
        const list = data.emotions;
        if (silent && list.length > prevEmotionCountRef.current && prevEmotionCountRef.current > 0) {
          const latest = list[0];
          showToast(
            isUrdu ? `نیا جذبہ: ${latest.emotion}` : `New emotion: ${latest.emotion}`
          );
        }
        prevEmotionCountRef.current = list.length;
        setEmotions(list);
      }
      if (data.emergencies) setEmergencies(data.emergencies);
      if (data.reminders) {
        const sorted = [...data.reminders].sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
        );
        if (prevRemindersRef.current.length > 0) {
          const newlyDone = sorted.filter(
            (r) =>
              r.status === "completed" &&
              prevRemindersRef.current.find((p) => p._id === r._id)?.status === "pending"
          );
          if (newlyDone.length > 0) {
            showToast(
              isUrdu
                ? `✅ مکمل: ${newlyDone[0].title}`
                : `✅ Completed: ${newlyDone[0].title}`
            );
          }
        }
        prevRemindersRef.current = sorted;
        setReminders(sorted);
      }
      if (data.healthTips) setHealthTips(data.healthTips);
      setLastSync(new Date());
      setFetchError(null);
    },
    [isUrdu]
  );

  const fetchStats = useCallback(
    async (isManual = false, silent = false) => {
      if (isManual) setRefreshing(true);
      else if (!silent) setLoading(true);

      try {
        const userId = await AsyncStorage.getItem("userId");
        const token = await AsyncStorage.getItem("token");
        if (!userId || !token) {
          if (!silent) {
            setFetchError(isUrdu ? "براہ کرم لاگ ان کریں" : "Please log in first");
          }
          return;
        }

        const { data } = await API.get(`/stats/weekly?days=${WEEK_DAYS}`);
        if (!data?.success) {
          throw new Error(data?.message || "Failed to load stats");
        }

        applyStatsPayload(
          {
            emergencies: data.emergencies,
            emotions: data.emotions,
            reminders: data.reminders,
            healthTips: data.healthTips,
          },
          silent
        );
      } catch (err: any) {
        const msg =
          err?.response?.data?.message ||
          err?.message ||
          (isUrdu ? "ڈیٹا لوڈ نہیں ہو سکا" : "Could not load data");
        console.error("Weekly stats fetch error:", msg);
        if (!silent || isManual) {
          setFetchError(msg);
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [isUrdu, applyStatsPayload]
  );

  useFocusEffect(
    useCallback(() => {
      fetchStats(false, true);
      const interval = setInterval(() => fetchStats(false, true), POLL_MS);
      return () => clearInterval(interval);
    }, [fetchStats])
  );

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  useEffect(() => {
    const socket = getSocket();
    socketRef.current = socket;

    const onConnect = () => {
      setSocketLive(true);
      socket.emit("emergency_monitor_active");
      socket.emit("stats_monitor_active");
    };
    const onDisconnect = () => setSocketLive(false);

    const onNewEmergency = (alert: EmergencyAlert) => {
      setEmergencies((prev) => [alert, ...prev.filter((a) => a._id !== alert._id)]);
      showToast(
        isUrdu
          ? `🚨 ایمرجنسی: ${alert.companionId?.name || "Companion"}`
          : `🚨 Emergency: ${alert.companionId?.name || "Companion"}`
      );
      triggerLocalNotification(
        "🚨 EMERGENCY ALERT",
        `${alert.companionId?.name || "Companion"} — ${alert.message}`
      );
    };
    const onResolved = (alert: EmergencyAlert) => {
      setEmergencies((prev) =>
        prev.map((a) => (a._id === alert._id ? { ...a, status: "resolved" } : a))
      );
      showToast(isUrdu ? "✅ ایمرجنسی حل ہو گئی" : "✅ Emergency resolved");
    };
    const onDeleted = (payload: { id: string }) => {
      setEmergencies((prev) => prev.filter((a) => a._id !== payload.id));
    };

    const onNewEmotion = (payload: EmotionEntry & { userId?: string }) => {
      setEmotions((prev) => {
        const next = [
          {
            emotion: payload.emotion,
            confidence: payload.confidence ?? 0,
            createdAt: payload.createdAt || new Date().toISOString(),
          },
          ...prev,
        ];
        prevEmotionCountRef.current = next.length;
        return next;
      });
      showToast(
        isUrdu ? `نیا جذبہ: ${payload.emotion}` : `New emotion: ${payload.emotion}`
      );
      setLastSync(new Date());
    };

    const onReminderUpdated = (payload: { action?: string; reminder?: ReminderItem }) => {
      const rem = payload?.reminder;
      if (!rem?._id) {
        fetchStats(false, true);
        return;
      }
      setReminders((prev) => {
        const idx = prev.findIndex((r) => r._id === rem._id);
        const next =
          idx >= 0
            ? prev.map((r) => (r._id === rem._id ? { ...r, ...rem } : r))
            : [rem, ...prev];
        return [...next].sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
        );
      });
      if (payload.action === "completed") {
        showToast(isUrdu ? `✅ مکمل: ${rem.title}` : `✅ Completed: ${rem.title}`);
      }
      setLastSync(new Date());
    };

    const onHealthTipUpdated = (payload: { tip?: HealthTipItem }) => {
      const tip = payload?.tip;
      if (tip?._id) {
        setHealthTips((prev) => [tip, ...prev.filter((t) => t._id !== tip._id)]);
        showToast(isUrdu ? `💡 نیا صحت کا مشورہ` : `💡 New health tip added`);
      } else {
        fetchStats(false, true);
      }
      setLastSync(new Date());
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("newEmergency", onNewEmergency);
    socket.on("emergencyResolved", onResolved);
    socket.on("emergencyDeleted", onDeleted);
    socket.on("newEmotion", onNewEmotion);
    socket.on("reminderUpdated", onReminderUpdated);
    socket.on("healthTipUpdated", onHealthTipUpdated);
    connectSocket();

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("newEmergency", onNewEmergency);
      socket.off("emergencyResolved", onResolved);
      socket.off("emergencyDeleted", onDeleted);
      socket.off("newEmotion", onNewEmotion);
      socket.off("reminderUpdated", onReminderUpdated);
      socket.off("healthTipUpdated", onHealthTipUpdated);
    };
  }, [isUrdu, fetchStats]);

  const weekEmergencies = emergencies.filter((e) => isInWeek(e.createdAt));
  const activeEmergencies = emergencies.filter((e) => e.status === "active");
  const activeEmergency = activeEmergencies[0];
  const resolvedEmergencies = weekEmergencies.filter((e) => e.status === "resolved");
  const activeCount = activeEmergencies.length;
  const resolvedWeek = resolvedEmergencies.length;

  const emotionCounts = useMemo(() => {
    const counts = { happy: 0, sad: 0, angry: 0, neutral: 0 };
    emotions.forEach((e) => {
      const key = (e.emotion || "neutral").toLowerCase() as keyof typeof counts;
      if (key in counts) counts[key]++;
      else counts.neutral++;
    });
    return counts;
  }, [emotions]);

  const emotionsByDay = useMemo(() => {
    const map: Record<string, number> = {};
    dayKeys.forEach((k) => (map[k] = 0));
    emotions.forEach((e) => {
      const k = dayKey(e.createdAt);
      if (k in map) map[k]++;
    });
    return dayKeys.map((k) => map[k]);
  }, [emotions, dayKeys]);

  const weekReminders = reminders.filter((r) => isInWeek(r.date) || isInWeek(r.updatedAt));
  const pendingReminders = weekReminders.filter((r) => r.status === "pending");
  const completedReminders = weekReminders.filter((r) => r.status === "completed");
  const completedWeek = completedReminders.length;
  const pendingWeek = pendingReminders.length;
  const completionRate =
    weekReminders.length > 0
      ? Math.round((completedWeek / weekReminders.length) * 100)
      : 0;

  const remindersByDay = useMemo(() => {
    const completed: Record<string, number> = {};
    const total: Record<string, number> = {};
    dayKeys.forEach((k) => {
      completed[k] = 0;
      total[k] = 0;
    });
    weekReminders.forEach((r) => {
      const k = dayKey(r.date);
      if (k in total) {
        total[k]++;
        if (r.status === "completed") completed[k]++;
      }
    });
    return {
      completed: dayKeys.map((k) => completed[k]),
      total: dayKeys.map((k) => total[k]),
    };
  }, [weekReminders, dayKeys]);

  const weekTips = healthTips.filter((t) => isInWeek(t.createdAt));

  const emotionSummary = useMemo(() => {
    if (!emotions.length) return null;
    const dominant =
      (Object.entries(emotionCounts).sort((a, b) => b[1] - a[1])[0]?.[0] as string) ||
      "neutral";
    const avgConf =
      emotions.reduce((s, e) => s + (e.confidence || 0), 0) / emotions.length;
    return { dominant, total: emotions.length, avgConf };
  }, [emotions, emotionCounts]);

  const liveFeed: LiveEvent[] = useMemo(() => {
    const events: LiveEvent[] = [];
    emergencies.slice(0, 3).forEach((e) => {
      events.push({
        id: `em-${e._id}`,
        type: "emergency",
        title: e.companionId?.name || "Companion",
        subtitle: e.status === "active" ? (isUrdu ? "فعال الرٹ" : "Active alert") : e.message,
        time: e.createdAt || "",
        color: e.status === "active" ? theme.danger : theme.success,
        icon: "alert-octagon",
      });
    });
    emotions.slice(0, 3).forEach((e) => {
      events.push({
        id: `emo-${e.createdAt}`,
        type: "emotion",
        title: e.emotion,
        subtitle: `${Math.round((e.confidence || 0) * 100)}% ${isUrdu ? "اعتماد" : "confidence"}`,
        time: e.createdAt,
        color: emotionColor(e.emotion),
        icon: emotionIcon(e.emotion),
      });
    });
    reminders
      .filter((r) => r.status === "completed")
      .slice(0, 2)
      .forEach((r) => {
        events.push({
          id: `rem-${r._id}`,
          type: "reminder",
          title: r.title,
          subtitle: isUrdu ? "یاد دہانی مکمل" : "Reminder done",
          time: r.updatedAt || r.date,
          color: theme.accent,
          icon: "bell-check",
        });
      });
    weekTips.slice(0, 2).forEach((t) => {
      events.push({
        id: `tip-${t._id}`,
        type: "tip",
        title: t.category,
        subtitle: t.tipText.slice(0, 40) + (t.tipText.length > 40 ? "…" : ""),
        time: t.createdAt || "",
        color: theme.amber,
        icon: "heart-pulse",
      });
    });
    return events
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      .slice(0, 6);
  }, [emergencies, emotions, reminders, weekTips, isUrdu]);

  const t = {
    title: isUrdu ? "ہفتہ وار رپورٹ" : "Weekly Stats",
    sub: isUrdu ? "کیئر کمپینین تجزیہ" : "CARE COMPANION ANALYTICS",
    live: isUrdu ? "لائیو" : "LIVE",
    offline: isUrdu ? "آف لائن" : "OFFLINE",
    weekOf: isUrdu ? "ہفتہ" : "Week of",
    overview: isUrdu ? "خلاصہ" : "Overview",
    liveFeed: isUrdu ? "حالیہ سرگرمی" : "Recent Activity",
    synced: isUrdu ? "آخری اپڈیٹ" : "Last sync",
    emergencies: isUrdu ? "ایمرجنسی الرٹس" : "Emergency Alerts",
    activeNow: isUrdu ? "فعال الرٹ!" : "ACTIVE ALERT!",
    resolved: isUrdu ? "حل شدہ" : "Resolved",
    active: isUrdu ? "فعال" : "Active",
    noEmergencies: isUrdu ? "اس ہفتے کوئی ایمرجنسی نہیں" : "No emergencies this week",
    emotions: isUrdu ? "جذبات کی پہچان" : "Emotion Detection",
    scans: isUrdu ? "اسکین" : "scans",
    latestScan: isUrdu ? "تازہ ترین اسکین" : "Latest scan",
    confidence: isUrdu ? "اعتماد" : "Confidence",
    recentScans: isUrdu ? "حالیہ اسکین" : "Recent scans",
    noEmotions: isUrdu ? "اس ہفتے کوئی جذباتی ڈیٹا نہیں" : "No emotion data this week",
    weeklySummary: isUrdu ? "ہفتہ وار خلاصہ" : "Weekly summary",
    dominant: isUrdu ? "غالب جذبہ" : "Dominant",
    avgConfidence: isUrdu ? "اوسط اعتماد" : "Avg confidence",
    totalScans: isUrdu ? "کل اسکین" : "Total scans",
    healthTips: isUrdu ? "صحت کے مشورے" : "Health Tips",
    activated: isUrdu ? "فعال" : "Activated",
    tipsActive: isUrdu ? "فعال" : "Active",
    addedWeek: isUrdu ? "اس ہفتے شامل" : "Added this week",
    allTips: isUrdu ? "تمام فعال مشورے" : "All active tips",
    noTips: isUrdu ? "کوئی صحت کا مشورہ نہیں" : "No health tips yet",
    reminders: isUrdu ? "یاد دہانیاں" : "Reminders",
    completed: isUrdu ? "مکمل" : "Completed",
    pending: isUrdu ? "زیر التوا" : "Pending",
    overdue: isUrdu ? "تاخیر" : "Overdue",
    rate: isUrdu ? "تکمیل کی شرح" : "Completion rate",
    scheduled: isUrdu ? "شیڈول" : "Scheduled",
    noReminders: isUrdu ? "اس ہفتے کوئی یاد دہانی نہیں" : "No reminders this week",
    dailyScans: isUrdu ? "روزانہ اسکین" : "Daily scans",
    dailyReminders: isUrdu ? "روزانہ یاد دہانیاں" : "Daily reminders",
    dailyCompleted: isUrdu ? "روزانہ مکمل" : "Daily completed",
  };

  const renderReminderCard = (item: ReminderItem) => {
    const isDone = item.status === "completed";
    const isOverdue = !isDone && new Date(item.date) < new Date();
    return (
      <View
        key={item._id}
        style={[styles.reminderDetailCard, isDone && styles.reminderDoneCard]}
      >
        <View style={styles.reminderDetailHeader}>
          <View
            style={[
              styles.reminderIconBox,
              {
                backgroundColor: isDone
                  ? "rgba(105,240,174,0.12)"
                  : isOverdue
                  ? "rgba(255,82,82,0.12)"
                  : "rgba(124,77,255,0.12)",
              },
            ]}
          >
            <Icon
              name={isDone ? "check-decagram" : "bell-ring-outline"}
              size={20}
              color={isDone ? theme.success : isOverdue ? theme.danger : theme.accent}
            />
          </View>
          <View style={styles.reminderDetailBody}>
            <Text style={[styles.reminderDetailTitle, isDone && styles.reminderDoneText]}>
              {item.title}
            </Text>
            <View style={styles.reminderTimeRow}>
              <Icon name="calendar-clock" size={12} color={theme.textSecondary} />
              <Text
                style={[styles.reminderTimeText, isOverdue && { color: theme.danger }]}
              >
                {formatDateTime(item.date, isUrdu)}
                {isOverdue ? ` (${t.overdue})` : ""}
              </Text>
            </View>
          </View>
          <View
            style={[
              styles.statusBadge,
              {
                backgroundColor: isDone
                  ? "rgba(105,240,174,0.15)"
                  : "rgba(245,158,11,0.15)",
              },
            ]}
          >
            <Text
              style={[
                styles.statusBadgeText,
                { color: isDone ? theme.success : theme.amber },
              ]}
            >
              {isDone ? t.completed : t.pending}
            </Text>
          </View>
        </View>
        {item.description ? <Text style={styles.reminderDesc}>{item.description}</Text> : null}
        {isDone && item.updatedAt ? (
          <Text style={styles.reminderCompletedAt}>
            {isUrdu ? "مکمل:" : "Done:"} {formatDateTime(item.updatedAt, isUrdu)}
          </Text>
        ) : null}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      <LinearGradient colors={theme.gradient} style={styles.header}>
        <SafeAreaView>
          <View style={styles.headerContent}>
            <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
              <Icon name="chevron-left" size={28} color="#FFF" />
            </TouchableOpacity>
            <View style={styles.titleWrap}>
              <Text style={styles.headerTitle}>{t.title}</Text>
              <View style={styles.liveIndicator}>
                <View
                  style={[
                    styles.liveDot,
                    { backgroundColor: socketLive ? theme.success : theme.danger },
                  ]}
                />
                <Text style={styles.headerSub}>
                  {socketLive ? t.live : t.offline} • {t.sub}
                </Text>
              </View>
            </View>
            <TouchableOpacity style={styles.refreshBtn} onPress={() => fetchStats(true)}>
              <Icon name="reload" size={22} color={theme.success} />
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </LinearGradient>

      {liveToast ? (
        <View style={styles.toastBanner}>
          <Icon name="broadcast" size={16} color={theme.success} />
          <Text style={styles.toastText}>{liveToast}</Text>
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => fetchStats(true)}
            tintColor={theme.success}
          />
        }
      >
        <View style={styles.metaRow}>
          <View style={styles.weekChip}>
            <Icon name="calendar-week" size={14} color={theme.success} />
            <Text style={styles.weekChipText}>
              {t.weekOf} {formatRange(isUrdu)}
            </Text>
          </View>
          {lastSync ? (
            <Text style={styles.syncText}>
              {t.synced}: {formatRelative(lastSync.toISOString(), isUrdu)}
            </Text>
          ) : null}
        </View>

        {fetchError ? (
          <View style={styles.errorBanner}>
            <Icon name="alert-circle-outline" size={18} color={theme.danger} />
            <Text style={styles.errorBannerText}>{fetchError}</Text>
            <TouchableOpacity onPress={() => fetchStats(true)}>
              <Text style={styles.errorRetry}>{isUrdu ? "دوبارہ" : "Retry"}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.centerBox}>
            <ActivityIndicator size="large" color={theme.success} />
          </View>
        ) : (
          <>
            {activeEmergency ? (
              <LinearGradient colors={["#FF5252", "#C62828"]} style={styles.alertBanner}>
                <Icon name="alert-octagon" size={28} color="#FFF" />
                <View style={styles.alertBannerText}>
                  <Text style={styles.alertBannerTitle}>{t.activeNow}</Text>
                  <Text style={styles.alertBannerMsg}>
                    {activeEmergency.companionId?.name || "Companion"} — {activeEmergency.message}
                  </Text>
                  <Text style={styles.alertBannerTime}>
                    {formatDateTime(activeEmergency.createdAt, isUrdu)}
                  </Text>
                </View>
                <View style={styles.pulseDot} />
              </LinearGradient>
            ) : null}

            {liveFeed.length > 0 ? (
              <View style={styles.feedSection}>
                <Text style={styles.feedTitle}>{t.liveFeed}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {liveFeed.map((ev) => (
                    <View key={ev.id} style={[styles.feedCard, { borderColor: `${ev.color}44` }]}>
                      <View style={[styles.feedIcon, { backgroundColor: `${ev.color}22` }]}>
                        <Icon name={ev.icon} size={18} color={ev.color} />
                      </View>
                      <Text style={styles.feedCardTitle} numberOfLines={1}>
                        {ev.title}
                      </Text>
                      <Text style={styles.feedCardSub} numberOfLines={2}>
                        {ev.subtitle}
                      </Text>
                      <Text style={styles.feedCardTime}>{formatRelative(ev.time, isUrdu)}</Text>
                    </View>
                  ))}
                </ScrollView>
              </View>
            ) : null}

            <Text style={styles.overviewLabel}>{t.overview}</Text>
            <View style={styles.overviewRow}>
              <StatPill
                label={t.emergencies}
                value={weekEmergencies.length}
                color={theme.danger}
                icon="alert-octagon-outline"
                sub={activeCount > 0 ? `${activeCount} ${t.active}` : `${resolvedWeek} ${t.resolved}`}
              />
              <StatPill
                label={t.emotions}
                value={emotions.length}
                color={theme.cyan}
                icon="face-recognition"
                sub={emotions[0] ? formatRelative(emotions[0].createdAt, isUrdu) : undefined}
              />
              <StatPill
                label={t.reminders}
                value={`${completionRate}%`}
                color={theme.accent}
                icon="bell-check-outline"
                sub={`${completedWeek}/${weekReminders.length || 0}`}
              />
              <StatPill
                label={t.healthTips}
                value={healthTips.length}
                color={theme.amber}
                icon="heart-pulse"
                sub={`+${weekTips.length} ${t.addedWeek.toLowerCase()}`}
              />
            </View>

            {/* ── EMERGENCY ── */}
            <SectionCard
              title={t.emergencies}
              icon="alert-octagon-outline"
              iconColor={theme.danger}
              live={activeCount > 0}
              badge={`${activeCount + resolvedWeek}`}
            >
              <StatusRow
                items={[
                  { label: t.active, count: activeCount, color: theme.danger },
                  { label: t.resolved, count: resolvedWeek, color: theme.success },
                ]}
              />

              {activeCount === 0 && resolvedWeek === 0 ? (
                <View style={styles.emptyCard}>
                  <Icon name="shield-check-outline" size={40} color="rgba(255,255,255,0.2)" />
                  <Text style={styles.emptySection}>{t.noEmergencies}</Text>
                </View>
              ) : (
                <>
                  {activeEmergencies.length > 0 ? (
                    <>
                      <Text style={styles.subSectionTitle}>
                        {t.active} ({activeCount})
                      </Text>
                      {activeEmergencies.map((alert) => (
                        <LinearGradient
                          key={alert._id}
                          colors={theme.cardGrad}
                          style={[styles.detailCard, styles.activeCardGlow]}
                        >
                          <View style={styles.detailCardHeader}>
                            <View
                              style={[
                                styles.detailIconBox,
                                { backgroundColor: "rgba(255,82,82,0.15)" },
                              ]}
                            >
                              <Icon name="alert-octagon" size={22} color={theme.danger} />
                            </View>
                            <View style={styles.detailCardBody}>
                              <Text style={styles.detailCardTitle}>
                                {alert.companionId?.name || "Companion"}
                              </Text>
                              <Text style={styles.detailCardTime}>
                                {formatDateTime(alert.createdAt, isUrdu)}
                              </Text>
                            </View>
                            <View
                              style={[
                                styles.statusBadge,
                                { backgroundColor: "rgba(255,82,82,0.2)" },
                              ]}
                            >
                              <Text style={[styles.statusBadgeText, { color: theme.danger }]}>
                                {t.active}
                              </Text>
                            </View>
                          </View>
                          <Text style={styles.detailCardMsg}>{alert.message}</Text>
                          <View style={styles.livePulseRow}>
                            <View style={styles.livePulseDot} />
                            <Text style={styles.livePulseText}>
                              {isUrdu ? "حقیقی وقت میں نگرانی" : "Live — monitoring now"}
                            </Text>
                          </View>
                        </LinearGradient>
                      ))}
                    </>
                  ) : null}

                  {resolvedEmergencies.length > 0 ? (
                    <>
                      <Text style={[styles.subSectionTitle, { marginTop: 12 }]}>
                        {t.resolved} ({resolvedWeek})
                      </Text>
                      {resolvedEmergencies.map((alert) => (
                        <LinearGradient
                          key={alert._id}
                          colors={theme.cardGrad}
                          style={styles.detailCard}
                        >
                          <View style={styles.detailCardHeader}>
                            <View
                              style={[
                                styles.detailIconBox,
                                { backgroundColor: "rgba(105,240,174,0.12)" },
                              ]}
                            >
                              <Icon name="shield-check" size={22} color={theme.success} />
                            </View>
                            <View style={styles.detailCardBody}>
                              <Text style={styles.detailCardTitle}>
                                {alert.companionId?.name || "Companion"}
                              </Text>
                              <Text style={styles.detailCardTime}>
                                {formatDateTime(alert.createdAt, isUrdu)}
                              </Text>
                            </View>
                            <View
                              style={[
                                styles.statusBadge,
                                { backgroundColor: "rgba(105,240,174,0.15)" },
                              ]}
                            >
                              <Text style={[styles.statusBadgeText, { color: theme.success }]}>
                                {t.resolved}
                              </Text>
                            </View>
                          </View>
                          <Text style={styles.detailCardMsg}>{alert.message}</Text>
                        </LinearGradient>
                      ))}
                    </>
                  ) : null}
                </>
              )}
            </SectionCard>

            {/* ── EMOTIONS ── */}
            <SectionCard
              title={t.emotions}
              icon="face-recognition"
              iconColor={theme.cyan}
              badge={`${emotions.length} ${t.scans}`}
            >
              {emotions.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Icon name="face-recognition" size={40} color="rgba(255,255,255,0.2)" />
                  <Text style={styles.emptySection}>{t.noEmotions}</Text>
                </View>
              ) : (
                <>
                  {emotionSummary ? (
                    <View style={styles.weeklySummaryBox}>
                      <Text style={styles.weeklySummaryTitle}>{t.weeklySummary}</Text>
                      <View style={styles.weeklySummaryRow}>
                        <View style={styles.weeklySummaryItem}>
                          <Icon
                            name={emotionIcon(emotionSummary.dominant)}
                            size={20}
                            color={emotionColor(emotionSummary.dominant)}
                          />
                          <Text style={styles.weeklySummaryLabel}>{t.dominant}</Text>
                          <Text
                            style={[
                              styles.weeklySummaryValue,
                              { color: emotionColor(emotionSummary.dominant) },
                            ]}
                          >
                            {emotionSummary.dominant}
                          </Text>
                        </View>
                        <View style={styles.weeklySummaryDivider} />
                        <View style={styles.weeklySummaryItem}>
                          <Text style={styles.weeklySummaryLabel}>{t.totalScans}</Text>
                          <Text style={styles.weeklySummaryValue}>{emotionSummary.total}</Text>
                        </View>
                        <View style={styles.weeklySummaryDivider} />
                        <View style={styles.weeklySummaryItem}>
                          <Text style={styles.weeklySummaryLabel}>{t.avgConfidence}</Text>
                          <Text style={styles.weeklySummaryValue}>
                            {Math.round(emotionSummary.avgConf * 100)}%
                          </Text>
                        </View>
                      </View>
                    </View>
                  ) : null}

                  <View style={styles.latestHero}>
                    <View
                      style={[
                        styles.latestHeroIcon,
                        { borderColor: emotionColor(emotions[0].emotion) },
                      ]}
                    >
                      <Icon
                        name={emotionIcon(emotions[0].emotion)}
                        size={36}
                        color={emotionColor(emotions[0].emotion)}
                      />
                    </View>
                    <View style={styles.latestHeroBody}>
                      <Text style={styles.latestHeroLabel}>{t.latestScan}</Text>
                      <Text
                        style={[styles.latestHeroValue, { color: emotionColor(emotions[0].emotion) }]}
                      >
                        {emotions[0].emotion.toUpperCase()}
                      </Text>
                      <Text style={styles.latestHeroMeta}>
                        {t.confidence}: {Math.round((emotions[0].confidence || 0) * 100)}% •{" "}
                        {formatRelative(emotions[0].createdAt, isUrdu)}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.emotionBreakdown}>
                    {(["happy", "neutral", "sad", "angry"] as const).map((key) => (
                      <View key={key} style={styles.emotionChip}>
                        <Icon name={emotionIcon(key)} size={16} color={emotionColor(key)} />
                        <Text style={[styles.emotionChipCount, { color: emotionColor(key) }]}>
                          {emotionCounts[key]}
                        </Text>
                        <Text style={styles.emotionChipLabel}>{key}</Text>
                      </View>
                    ))}
                  </View>

                  <Text style={styles.chartLabel}>{t.dailyScans}</Text>
                  <MiniBarChart labels={dayLabels} values={emotionsByDay} color={theme.cyan} />

                  <Text style={[styles.chartLabel, { marginTop: 16 }]}>{t.recentScans}</Text>
                  {emotions.slice(0, 5).map((e, i) => (
                    <View key={`${e.createdAt}-${i}`} style={styles.timelineRow}>
                      <View style={[styles.timelineDot, { backgroundColor: emotionColor(e.emotion) }]} />
                      <View style={styles.timelineBody}>
                        <Text style={styles.timelineTitle}>{e.emotion}</Text>
                        <Text style={styles.timelineSub}>
                          {Math.round((e.confidence || 0) * 100)}% • {formatDateTime(e.createdAt, isUrdu)}
                        </Text>
                      </View>
                      <Text style={styles.timelineRel}>{formatRelative(e.createdAt, isUrdu)}</Text>
                    </View>
                  ))}
                </>
              )}
            </SectionCard>

            {/* ── HEALTH TIPS ── */}
            <SectionCard
              title={t.healthTips}
              icon="heart-pulse"
              iconColor={theme.amber}
              badge={`${healthTips.length} ${t.activated}`}
            >
              <StatusRow
                items={[
                  { label: t.activated, count: healthTips.length, color: theme.success },
                  { label: t.addedWeek, count: weekTips.length, color: theme.amber },
                ]}
              />

              {healthTips.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Icon name="heart-pulse" size={40} color="rgba(255,255,255,0.2)" />
                  <Text style={styles.emptySection}>{t.noTips}</Text>
                </View>
              ) : (
                <>
                  <Text style={styles.chartLabel}>{t.allTips}</Text>
                  {healthTips.slice(0, 8).map((tip) => {
                    const catColor = categoryColor(tip.category);
                    const isNew = isInWeek(tip.createdAt);
                    return (
                      <View
                        key={tip._id}
                        style={[styles.tipDetailCard, isNew && styles.tipNewCard]}
                      >
                        <View style={styles.tipDetailHeader}>
                          <View style={[styles.tipCatBadge, { backgroundColor: `${catColor}22` }]}>
                            <Text style={[styles.tipCatText, { color: catColor }]}>
                              {tip.category}
                            </Text>
                          </View>
                          <View style={styles.activatedBadge}>
                            <Icon name="check-circle" size={10} color={theme.success} />
                            <Text style={styles.activatedBadgeText}>{t.activated.toUpperCase()}</Text>
                          </View>
                          {isNew ? (
                            <View style={styles.newBadge}>
                              <Text style={styles.newBadgeText}>NEW</Text>
                            </View>
                          ) : null}
                          <Text style={styles.tipDetailDate}>
                            {formatRelative(tip.createdAt, isUrdu)}
                          </Text>
                        </View>
                        <Text style={styles.tipDetailText}>{tip.tipText}</Text>
                        {tip.language ? (
                          <View style={styles.tipLangRow}>
                            <Icon name="translate" size={12} color={theme.textSecondary} />
                            <Text style={styles.tipLangText}>{tip.language}</Text>
                          </View>
                        ) : null}
                      </View>
                    );
                  })}
                </>
              )}
            </SectionCard>

            {/* ── REMINDERS ── */}
            <SectionCard
              title={t.reminders}
              icon="bell-check-outline"
              iconColor={theme.accent}
              badge={`${completionRate}%`}
            >
              {weekReminders.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Icon name="bell-off-outline" size={40} color="rgba(255,255,255,0.2)" />
                  <Text style={styles.emptySection}>{t.noReminders}</Text>
                </View>
              ) : (
                <>
                  <StatusRow
                    items={[
                      { label: t.pending, count: pendingWeek, color: theme.amber },
                      { label: t.completed, count: completedWeek, color: theme.success },
                    ]}
                  />

                  <View style={styles.completionHero}>
                    <Text style={styles.completionPct}>{completionRate}%</Text>
                    <Text style={styles.completionLabel}>{t.rate}</Text>
                  </View>
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${completionRate}%` }]} />
                  </View>

                  <Text style={styles.chartLabel}>{t.dailyReminders}</Text>
                  <MiniBarChart
                    labels={dayLabels}
                    values={remindersByDay.total}
                    color={theme.accent}
                  />
                  <Text style={[styles.chartLabel, { marginTop: 8 }]}>{t.dailyCompleted}</Text>
                  <MiniBarChart
                    labels={dayLabels}
                    values={remindersByDay.completed}
                    color={theme.success}
                    maxValue={Math.max(...remindersByDay.total, 1)}
                  />

                  {pendingReminders.length > 0 ? (
                    <>
                      <Text style={[styles.subSectionTitle, { marginTop: 16 }]}>
                        {t.pending} ({pendingWeek})
                      </Text>
                      {pendingReminders.map(renderReminderCard)}
                    </>
                  ) : null}

                  {completedReminders.length > 0 ? (
                    <>
                      <Text style={[styles.subSectionTitle, { marginTop: 12 }]}>
                        {t.completed} ({completedWeek})
                      </Text>
                      {completedReminders.map(renderReminderCard)}
                    </>
                  ) : null}
                </>
              )}
            </SectionCard>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
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
  titleWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: "#FFF", fontSize: 20, fontWeight: "800" },
  liveIndicator: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
    gap: 6,
  },
  headerSub: {
    color: theme.success,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
  refreshBtn: {
    width: 45,
    height: 45,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 15,
    justifyContent: "center",
    alignItems: "center",
  },
  toastBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(105,240,174,0.12)",
    borderLeftWidth: 3,
    borderLeftColor: theme.success,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  toastText: { color: theme.success, fontSize: 13, fontWeight: "600", flex: 1 },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(255,82,82,0.1)",
    borderLeftWidth: 3,
    borderLeftColor: theme.danger,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginBottom: 12,
    borderRadius: 8,
  },
  errorBannerText: { color: "#FFB4AB", fontSize: 13, flex: 1 },
  errorRetry: { color: theme.cyan, fontWeight: "700", fontSize: 13 },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
    flexWrap: "wrap",
    gap: 8,
  },
  weekChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: theme.glass,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.glassBorder,
  },
  weekChipText: { color: "rgba(255,255,255,0.7)", fontSize: 11, fontWeight: "600" },
  syncText: { color: theme.textSecondary, fontSize: 10, fontWeight: "600" },
  scrollContent: { padding: 16, paddingBottom: 40 },
  centerBox: { marginTop: 80, alignItems: "center" },
  alertBanner: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderRadius: 16,
    marginBottom: 16,
    gap: 12,
  },
  alertBannerText: { flex: 1 },
  alertBannerTitle: { color: "#FFF", fontWeight: "900", fontSize: 14 },
  alertBannerMsg: { color: "rgba(255,255,255,0.9)", fontSize: 12, marginTop: 4 },
  alertBannerTime: { color: "rgba(255,255,255,0.6)", fontSize: 10, marginTop: 4 },
  pulseDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#FFF",
    opacity: 0.9,
  },
  feedSection: { marginBottom: 16 },
  feedTitle: { color: "#FFF", fontSize: 15, fontWeight: "700", marginBottom: 10 },
  feedCard: {
    width: 140,
    backgroundColor: theme.cardBg,
    borderRadius: 16,
    padding: 12,
    marginRight: 10,
    borderWidth: 1,
  },
  feedIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 8,
  },
  feedCardTitle: { color: "#FFF", fontSize: 13, fontWeight: "700", textTransform: "capitalize" },
  feedCardSub: { color: theme.textSecondary, fontSize: 10, marginTop: 4, lineHeight: 14 },
  feedCardTime: { color: theme.textSecondary, fontSize: 9, marginTop: 6 },
  overviewLabel: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFF",
    marginBottom: 12,
    opacity: 0.85,
  },
  overviewRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  statPill: {
    width: "48%",
    backgroundColor: theme.glass,
    borderRadius: 24,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: theme.glassBorder,
  },
  statPillIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 8,
  },
  statPillValue: { color: "#FFF", fontSize: 22, fontWeight: "900" },
  statPillLabel: { color: theme.textSecondary, fontSize: 10, marginTop: 2, fontWeight: "600" },
  statPillSub: { color: theme.textSecondary, fontSize: 9, marginTop: 4 },
  sectionCard: {
    backgroundColor: theme.glass,
    borderRadius: 24,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: theme.glassBorder,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
    gap: 10,
  },
  sectionIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  sectionTitle: { flex: 1, color: "#FFF", fontSize: 15, fontWeight: "800" },
  liveBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,82,82,0.15)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    gap: 4,
  },
  liveBadgeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.danger },
  liveBadgeText: { color: theme.danger, fontSize: 9, fontWeight: "900" },
  sectionBadge: {
    backgroundColor: "rgba(105,240,174,0.15)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  sectionBadgeText: { color: theme.success, fontSize: 10, fontWeight: "700" },
  statusRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 14,
  },
  statusChip: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: "center",
    borderWidth: 1,
  },
  statusChipCount: { fontSize: 20, fontWeight: "900" },
  statusChipLabel: {
    color: theme.textSecondary,
    fontSize: 9,
    fontWeight: "700",
    marginTop: 2,
    textTransform: "uppercase",
  },
  subSectionTitle: {
    color: "#FFF",
    fontSize: 12,
    fontWeight: "800",
    marginBottom: 8,
    opacity: 0.85,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  weeklySummaryBox: {
    backgroundColor: theme.cardBg,
    borderRadius: 16,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: theme.glassBorder,
  },
  weeklySummaryTitle: {
    color: theme.textSecondary,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
    marginBottom: 10,
    textTransform: "uppercase",
  },
  weeklySummaryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  weeklySummaryItem: { flex: 1, alignItems: "center" },
  weeklySummaryLabel: { color: theme.textSecondary, fontSize: 9, marginTop: 4 },
  weeklySummaryValue: {
    color: "#FFF",
    fontSize: 14,
    fontWeight: "800",
    marginTop: 2,
    textTransform: "capitalize",
  },
  weeklySummaryDivider: {
    width: 1,
    height: 36,
    backgroundColor: theme.glassBorder,
  },
  emptyCard: {
    backgroundColor: "rgba(255,255,255,0.02)",
    borderRadius: 16,
    borderStyle: "dashed",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    padding: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  emptySection: {
    color: theme.textSecondary,
    fontSize: 13,
    textAlign: "center",
    paddingTop: 10,
  },
  detailCard: {
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: theme.glassBorder,
  },
  activeCardGlow: {
    borderColor: "rgba(255,82,82,0.4)",
    shadowColor: theme.danger,
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  detailCardHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  detailIconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  detailCardBody: { flex: 1 },
  detailCardTitle: { color: "#FFF", fontSize: 14, fontWeight: "800" },
  detailCardTime: { color: theme.textSecondary, fontSize: 10, marginTop: 2 },
  detailCardMsg: { color: "rgba(255,255,255,0.75)", fontSize: 13, marginTop: 10, lineHeight: 18 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  statusBadgeText: { fontSize: 9, fontWeight: "800", textTransform: "uppercase" },
  livePulseRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10 },
  livePulseDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.danger },
  livePulseText: { color: theme.danger, fontSize: 10, fontWeight: "700" },
  latestHero: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.cardBg,
    borderRadius: 16,
    padding: 14,
    marginBottom: 14,
    gap: 14,
    borderWidth: 1,
    borderColor: theme.glassBorder,
  },
  latestHeroIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderStyle: "dashed",
  },
  latestHeroBody: { flex: 1 },
  latestHeroLabel: { color: theme.textSecondary, fontSize: 10, fontWeight: "700", letterSpacing: 1 },
  latestHeroValue: { fontSize: 20, fontWeight: "900", marginTop: 2 },
  latestHeroMeta: { color: theme.textSecondary, fontSize: 11, marginTop: 4 },
  emotionBreakdown: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  emotionChip: { alignItems: "center", flex: 1 },
  emotionChipCount: { fontSize: 18, fontWeight: "900", marginTop: 4 },
  emotionChipLabel: {
    color: theme.textSecondary,
    fontSize: 9,
    textTransform: "capitalize",
    marginTop: 2,
  },
  chartLabel: {
    color: theme.textSecondary,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  barChart: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    height: 100,
    paddingTop: 8,
  },
  barCol: { flex: 1, alignItems: "center" },
  barValue: { color: theme.textSecondary, fontSize: 9, height: 14, marginBottom: 2 },
  bar: { width: 14, borderRadius: 4, minHeight: 4 },
  barLabel: { color: theme.textSecondary, fontSize: 9, marginTop: 6 },
  timelineRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.glassBorder,
    gap: 10,
  },
  timelineDot: { width: 8, height: 8, borderRadius: 4 },
  timelineBody: { flex: 1 },
  timelineTitle: { color: "#FFF", fontSize: 13, fontWeight: "700", textTransform: "capitalize" },
  timelineSub: { color: theme.textSecondary, fontSize: 10, marginTop: 2 },
  timelineRel: { color: theme.textSecondary, fontSize: 10 },
  moodCenter: { alignItems: "center" },
  moodIconBox: {
    width: 90,
    height: 90,
    borderRadius: 45,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderStyle: "dashed",
    marginBottom: 10,
  },
  moodStatus: { fontSize: 22, fontWeight: "900", letterSpacing: 1 },
  moodStatsRow: {
    flexDirection: "row",
    marginTop: 16,
    width: "100%",
    justifyContent: "center",
  },
  moodStat: { alignItems: "center", paddingHorizontal: 24 },
  moodStatLabel: { color: theme.textSecondary, fontSize: 10 },
  moodStatValue: { color: "#FFF", fontSize: 15, fontWeight: "700", marginTop: 4 },
  moodDivider: { width: 1, height: 30, backgroundColor: theme.glassBorder },
  moodTime: { color: theme.textSecondary, fontSize: 11, marginTop: 12 },
  tipSummaryRow: { flexDirection: "row", gap: 12, marginBottom: 14 },
  tipSummaryBox: {
    flex: 1,
    backgroundColor: theme.cardBg,
    borderRadius: 12,
    padding: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: theme.glassBorder,
  },
  tipSummaryNum: { color: theme.amber, fontSize: 24, fontWeight: "900" },
  tipSummaryLabel: { color: theme.textSecondary, fontSize: 10, marginTop: 4 },
  tipDetailCard: {
    backgroundColor: theme.cardBg,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: theme.glassBorder,
  },
  tipNewCard: { borderColor: "rgba(105,240,174,0.3)" },
  tipDetailHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
    gap: 8,
    flexWrap: "wrap",
  },
  tipCatBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  tipCatText: { fontSize: 10, fontWeight: "700", textTransform: "capitalize" },
  newBadge: {
    backgroundColor: "rgba(105,240,174,0.15)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  newBadgeText: { color: theme.success, fontSize: 8, fontWeight: "900" },
  activatedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(105,240,174,0.15)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  activatedBadgeText: { color: theme.success, fontSize: 8, fontWeight: "900" },
  tipDetailDate: { color: theme.textSecondary, fontSize: 10, marginLeft: "auto" },
  tipDetailText: { color: "#FFF", fontSize: 14, lineHeight: 20 },
  tipLangRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 8 },
  tipLangText: { color: theme.textSecondary, fontSize: 10, textTransform: "capitalize" },
  completionHero: { alignItems: "center", marginBottom: 10 },
  completionPct: { color: theme.success, fontSize: 36, fontWeight: "900" },
  completionLabel: { color: theme.textSecondary, fontSize: 11, marginTop: 2 },
  progressTrack: {
    height: 8,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 4,
    overflow: "hidden",
    marginBottom: 12,
  },
  progressFill: { height: "100%", borderRadius: 4, backgroundColor: theme.success },
  reminderCounts: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginBottom: 16,
  },
  reminderCountItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  reminderCountText: { color: "#FFF", fontSize: 12, fontWeight: "600" },
  reminderDetailCard: {
    backgroundColor: theme.cardBg,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: theme.glassBorder,
  },
  reminderDoneCard: { opacity: 0.85, borderColor: "rgba(105,240,174,0.2)" },
  reminderDetailHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  reminderIconBox: {
    width: 38,
    height: 38,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  reminderDetailBody: { flex: 1 },
  reminderDetailTitle: { color: "#FFF", fontSize: 14, fontWeight: "700" },
  reminderDoneText: { color: theme.textSecondary, textDecorationLine: "line-through" },
  reminderTimeRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  reminderTimeText: { color: theme.textSecondary, fontSize: 11 },
  reminderDesc: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 12,
    marginTop: 10,
    paddingLeft: 48,
    lineHeight: 18,
  },
  reminderCompletedAt: {
    color: theme.success,
    fontSize: 10,
    marginTop: 8,
    paddingLeft: 48,
    fontWeight: "600",
  },
});
