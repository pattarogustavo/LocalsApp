import React from 'react';
import { View, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useTripsStore } from '@/store/trips';
import { AddTravelerForm } from '@/components/trip/travelers-block';
import { useColors } from '@/hooks/use-colors';
import { sheetScreenOptions } from '@/utils/sheet-presentation';
import { trpc } from '@/lib/trpc';

/**
 * Add-a-traveler sheet, reached either from the Viajantes tab or pushed on
 * top of the "Nova Despesa" sheet (native sheet-over-sheet stacking) —
 * either way it's the exact same AddTravelerForm, and router.back() always
 * returns to whichever sheet opened it with its own state untouched.
 */
export default function AddTravelerScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const colors = useColors();
  const travelers = useTripsStore((s) => s.trips.find((tr) => tr.id === tripId)?.travelers ?? []);
  const utils = trpc.useUtils();

  return (
    <>
      <Stack.Screen options={sheetScreenOptions(colors)} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={{ padding: 24, gap: 14, backgroundColor: colors.background, flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          <View style={{ gap: 14 }}>
            <AddTravelerForm
              tripId={tripId}
              travelers={travelers}
              onDone={() => router.back()}
              onInviteSent={() => utils.sharing.listSentByMe.invalidate()}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
