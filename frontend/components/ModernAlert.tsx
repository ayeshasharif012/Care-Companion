import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

interface ModernAlertProps {
  visible: boolean;
  title: string;
  message: string;
  type: 'danger' | 'info' | 'success';
  onConfirm: () => void;
  onCancel: () => void;
  confirmText?: string;
}

export const ModernAlert = ({ visible, title, message, type, onConfirm, onCancel, confirmText = "Confirm" }: ModernAlertProps) => {
  const iconName = type === 'danger' ? 'alert-circle' : type === 'success' ? 'check-circle' : 'information';
  const accentColor = type === 'danger' ? '#FF5252' : type === 'success' ? '#69F0AE' : '#7C4DFF';

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.alertBox}>
          <View style={[styles.iconContainer, { backgroundColor: `${accentColor}20` }]}>
            <Icon name={iconName} size={40} color={accentColor} />
          </View>
          
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>

          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.confirmBtn} onPress={onConfirm}>
              <LinearGradient 
                colors={type === 'danger' ? ['#DC2626', '#991B1B'] : ['#1B1464', '#2E3192']} 
                style={styles.btnGradient}
              >
                <Text style={styles.confirmText}>{confirmText}</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  alertBox: { width: '100%', backgroundColor: '#1A1648', borderRadius: 30, padding: 25, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  iconContainer: { width: 80, height: 80, borderRadius: 40, justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
  title: { color: '#FFF', fontSize: 22, fontWeight: '800', marginBottom: 10 },
  message: { color: 'rgba(255,255,255,0.6)', fontSize: 15, textAlign: 'center', lineHeight: 22, marginBottom: 25 },
  buttonRow: { flexDirection: 'row', gap: 15 },
  cancelBtn: { flex: 1, paddingVertical: 15, alignItems: 'center' },
  cancelText: { color: 'rgba(255,255,255,0.5)', fontWeight: '700' },
  confirmBtn: { flex: 2, borderRadius: 15, overflow: 'hidden' },
  btnGradient: { paddingVertical: 15, alignItems: 'center' },
  confirmText: { color: '#FFF', fontWeight: '800' },
});