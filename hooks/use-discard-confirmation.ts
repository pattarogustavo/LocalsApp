import { useEffect } from 'react';
import { Alert } from 'react-native';
import { useNavigation } from 'expo-router';
import { useTranslation } from '@/hooks/use-translation';

/**
 * Intercepts a form sheet's dismissal (drag-to-close gesture OR back) and
 * asks for confirmation when there are unsaved changes — same behavior as
 * Notes/Mail on iOS. Pass `false` while the form is pristine/already saved
 * so a clean dismiss is never blocked.
 */
export function useDiscardConfirmation(isDirty: boolean) {
  const navigation = useNavigation();
  const t = useTranslation();

  useEffect(() => {
    return navigation.addListener('beforeRemove', (e: any) => {
      if (!isDirty) return;
      e.preventDefault();
      Alert.alert(
        t.common.discardChangesTitle,
        t.common.discardChangesMessage,
        [
          { text: t.common.cancel, style: 'cancel' },
          {
            text: t.common.discard,
            style: 'destructive',
            onPress: () => navigation.dispatch(e.data.action),
          },
        ],
      );
    });
  }, [navigation, isDirty, t]);
}
