import React from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { useColors } from '@/hooks/use-colors';
import { useTripsStore } from '@/store/trips';

interface PaywallModalProps {
  visible: boolean;
  onClose: () => void;
  feature?: string;
}

const PLANS = [
  {
    id: 'pro',
    name: 'Pro',
    price: 'R$ 19,90/mês',
    priceAnnual: 'R$ 14,90/mês (anual)',
    highlight: 'Mais popular',
    color: '#2D5A3D',
    features: [
      '✦ Roteiros com IA ilimitados',
      '✦ Sugestão de destinos por IA',
      '✦ Lugares recomendados por IA',
      '✦ Roteiro dia-a-dia automático',
      '✦ Até 20 roteiros salvos',
      '✦ Exportar roteiro em PDF',
    ],
  },
  {
    id: 'premium',
    name: 'Premium',
    price: 'R$ 34,90/mês',
    priceAnnual: 'R$ 24,90/mês (anual)',
    highlight: 'Completo',
    color: '#1A3A2A',
    features: [
      '✦ Tudo do plano Pro',
      '✦ Roteiros colaborativos',
      '✦ Alertas de preço de voos',
      '✦ Integração com calendário',
      '✦ Roteiros ilimitados',
      '✦ Suporte prioritário',
    ],
  },
];

export function PaywallModal({ visible, onClose, feature }: PaywallModalProps) {
  const colors = useColors();
  const { userPlan, updateUserPlan } = useTripsStore();

  // For demo: simulate upgrading to Pro
  const handleUpgrade = (planId: string) => {
    updateUserPlan({
      tier: planId as 'pro' | 'premium',
      aiCreditsLimit: planId === 'pro' ? 999 : 9999,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    });
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen">
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: colors.background }]}>
          {/* Handle */}
          <View style={[styles.handle, { backgroundColor: colors.border }]} />

          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text style={[styles.title, { color: colors.foreground }]}>LocalsApp Pro</Text>
              <Text style={[styles.subtitle, { color: colors.muted }]}>
                {feature
                  ? `"${feature}" é exclusivo para assinantes`
                  : 'Desbloqueie o poder da IA para suas viagens'}
              </Text>
            </View>
            <Pressable onPress={onClose} style={[styles.closeBtn, { backgroundColor: colors.surface }]}>
              <Text style={[styles.closeText, { color: colors.muted }]}>✕</Text>
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
            {/* Current plan info */}
            {userPlan.tier === 'free' && (
              <View style={[styles.freeBadge, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.freeText, { color: colors.muted }]}>
                  Plano Gratuito — {userPlan.aiCreditsLimit - userPlan.aiCreditsUsed} usos de IA restantes
                </Text>
              </View>
            )}

            {/* Plans */}
            {PLANS.map((plan) => (
              <View
                key={plan.id}
                style={[styles.planCard, { borderColor: plan.color }]}
              >
                <View style={[styles.planHeader, { backgroundColor: plan.color }]}>
                  <Text style={styles.planName}>{plan.name}</Text>
                  <View style={styles.planBadge}>
                    <Text style={styles.planBadgeText}>{plan.highlight}</Text>
                  </View>
                </View>
                <View style={styles.planBody}>
                  <Text style={[styles.planPrice, { color: colors.foreground }]}>{plan.price}</Text>
                  <Text style={[styles.planPriceAnnual, { color: colors.muted }]}>{plan.priceAnnual}</Text>
                  {plan.features.map((f, i) => (
                    <Text key={i} style={[styles.feature, { color: colors.foreground }]}>{f}</Text>
                  ))}
                  <Pressable
                    onPress={() => handleUpgrade(plan.id)}
                    style={({ pressed }) => [
                      styles.upgradeBtn,
                      { backgroundColor: plan.color, opacity: pressed ? 0.85 : 1 },
                    ]}
                  >
                    <Text style={styles.upgradeBtnText}>Assinar {plan.name}</Text>
                  </Pressable>
                </View>
              </View>
            ))}

            {/* Free trial note */}
            <Text style={[styles.trialNote, { color: colors.muted }]}>
              7 dias grátis · Cancele quando quiser · Sem compromisso
            </Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    maxHeight: '90%',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 24,
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    fontStyle: 'italic',
    fontFamily: 'serif',
  },
  subtitle: {
    fontSize: 14,
    marginTop: 4,
    maxWidth: 240,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    fontSize: 14,
    fontWeight: '600',
  },
  scroll: {
    paddingHorizontal: 24,
    paddingBottom: 40,
    gap: 16,
  },
  freeBadge: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    alignItems: 'center',
  },
  freeText: {
    fontSize: 13,
  },
  planCard: {
    borderRadius: 16,
    borderWidth: 2,
    overflow: 'hidden',
  },
  planHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  planName: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    fontStyle: 'italic',
  },
  planBadge: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  planBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  planBody: {
    padding: 16,
    gap: 6,
  },
  planPrice: {
    fontSize: 20,
    fontWeight: '700',
  },
  planPriceAnnual: {
    fontSize: 13,
    marginBottom: 8,
  },
  feature: {
    fontSize: 14,
    lineHeight: 22,
  },
  upgradeBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 12,
  },
  upgradeBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  trialNote: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 4,
  },
});
