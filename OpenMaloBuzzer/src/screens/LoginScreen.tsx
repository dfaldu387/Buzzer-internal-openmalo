import React, {useState, useRef, useEffect} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Platform,
  Image,
  Keyboard,
  Modal,
  useWindowDimensions,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Icon from 'react-native-vector-icons/MaterialIcons';
import {User} from '../types';

const BASE_WIDTH = 375;

interface Props {
  onLogin: (phone: string, pin: string) => Promise<User | null>;
  onGoToSignup: () => void;
}

const LoginScreen: React.FC<Props> = ({onLogin, onGoToSignup}) => {
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);

  // Restore last used phone number
  useEffect(() => {
    AsyncStorage.getItem('@openmalo_last_phone').then(saved => {
      if (saved) setPhone(saved);
    });
  }, []);
  const pinRef = useRef<TextInput>(null);
  const scrollRef = useRef<ScrollView>(null);
  const {width, height} = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const scale = Math.min(width / BASE_WIDTH, 1.3);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [alertModal, setAlertModal] = useState<{visible: boolean; title: string; message: string}>({visible: false, title: '', message: ''});

  useEffect(() => {
    const showEvent =
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent =
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, e => {
      setKeyboardVisible(true);
      setKeyboardHeight(e.endCoordinates.height);
      setTimeout(() => scrollRef.current?.scrollToEnd({animated: true}), 150);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardVisible(false);
      setKeyboardHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const handleLogin = async () => {
    if (phone.length < 10) {
      setAlertModal({visible: true, title: 'Error', message: 'Enter a valid phone number'});
      return;
    }
    if (pin.length !== 4) {
      setAlertModal({visible: true, title: 'Error', message: 'Enter your 4-digit PIN'});
      return;
    }

    setLoading(true);
    try {
      const user = await onLogin(phone, pin);
      if (user) {
        AsyncStorage.setItem('@openmalo_last_phone', phone).catch(() => {});
      }
    } catch (e: any) {
      setAlertModal({visible: true, title: 'Login Failed', message: e?.message || 'Something went wrong. Try again.'});
    } finally {
      setLoading(false);
    }
  };

  const openForgotModal = () => {
    setAlertModal({
      visible: true,
      title: 'Forgot PIN?',
      message: 'Contact your manager or admin to reset your PIN from the Settings screen.',
    });
  };

  const bottomPadding = keyboardVisible
    ? insets.bottom +
      (Platform.OS === 'ios' ? keyboardHeight + 20 : 40)
    : insets.bottom + 20;

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.container}
      contentContainerStyle={[
        styles.scrollContent,
        {
          paddingTop: insets.top + 20,
          paddingBottom: bottomPadding,
          paddingHorizontal: width * 0.08,
          justifyContent:
            keyboardVisible && Platform.OS === 'android'
              ? 'flex-start'
              : 'center',
        },
      ]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      showsVerticalScrollIndicator={false}
      bounces={false}>
        <Image
          source={require('../assets/logo.png')}
          style={[styles.logoImage, {width: 80 * scale, height: 80 * scale}]}
        />
        <Text style={[styles.logo, {fontSize: 36 * scale}]}>Buzzer</Text>
        <Text
          style={[
            styles.subtitle,
            {fontSize: 14 * scale, marginBottom: height * 0.05},
          ]}>
          Internal Communication
        </Text>

        <TextInput
          style={[
            styles.input,
            {fontSize: 16 * scale, paddingVertical: 14 * scale},
            phone.length > 0 && phone.length < 10 && {borderColor: '#F44336'},
          ]}
          placeholder="Phone number (min 10 digits)"
          placeholderTextColor="#999"
          keyboardType="phone-pad"
          value={phone}
          onChangeText={t => setPhone(t.replace(/[^0-9]/g, ''))}
          maxLength={15}
          returnKeyType="next"
          onSubmitEditing={() => pinRef.current?.focus()}
        />
        {phone.length > 0 && phone.length < 10 && (
          <Text style={{color: '#F44336', fontSize: 12 * scale, marginTop: 2}}>Phone number must be at least 10 digits</Text>
        )}

        <TextInput
          ref={pinRef}
          style={[
            styles.input,
            {fontSize: 16 * scale, paddingVertical: 14 * scale},
          ]}
          placeholder="4-digit PIN"
          placeholderTextColor="#999"
          keyboardType="number-pad"
          secureTextEntry
          value={pin}
          onChangeText={setPin}
          maxLength={4}
          returnKeyType="done"
          onSubmitEditing={handleLogin}
        />

        <TouchableOpacity
          style={[
            styles.button,
            {paddingVertical: 16 * scale},
            (loading || phone.length < 10 || pin.length !== 4) &&
              styles.buttonDisabled,
          ]}
          onPress={handleLogin}
          disabled={loading || phone.length < 10 || pin.length !== 4}
          activeOpacity={0.8}>
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={[styles.buttonText, {fontSize: 16 * scale}]}>
              LOGIN
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.forgotLink}
          onPress={openForgotModal}
          activeOpacity={0.7}>
          <Text style={[styles.forgotText, {fontSize: 14 * scale}]}>
            Forgot PIN?
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.signupLink}
          onPress={onGoToSignup}
          activeOpacity={0.7}>
          <Text style={[styles.signupText, {fontSize: 14 * scale}]}>
            Don't have an account?{' '}
            <Text style={styles.signupHighlight}>Sign Up</Text>
          </Text>
        </TouchableOpacity>

      <Modal
        visible={alertModal.visible}
        transparent
        animationType="fade"
        onRequestClose={() => setAlertModal(prev => ({...prev, visible: false}))}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.modalIconWrap}>
              <Icon name="error-outline" size={32} color="#FF4D4D" />
            </View>
            <Text style={styles.modalTitle}>{alertModal.title}</Text>
            <Text style={styles.modalMessage}>{alertModal.message}</Text>
            <TouchableOpacity
              style={styles.modalBtn}
              onPress={() => setAlertModal(prev => ({...prev, visible: false}))}>
              <Text style={styles.modalBtnText}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D0D0D',
  },
  scrollContent: {
    flexGrow: 1,
  },
  logoImage: {
    alignSelf: 'center',
    marginBottom: 16,
  },
  logo: {
    fontWeight: '800',
    color: '#FF4D4D',
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    color: '#888',
    textAlign: 'center',
  },
  input: {
    backgroundColor: '#1A1A1A',
    color: '#fff',
    paddingHorizontal: 20,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#333',
  },
  button: {
    backgroundColor: '#FF4D4D',
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '700',
  },
  forgotLink: {
    marginTop: 16,
    alignItems: 'center',
  },
  forgotText: {
    color: '#FF9800',
    fontWeight: '600',
  },
  signupLink: {
    marginTop: 16,
    alignItems: 'center',
  },
  signupText: {
    color: '#888',
  },
  signupHighlight: {
    color: '#FF4D4D',
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  modalBox: {
    backgroundColor: '#1A1A1A',
    borderRadius: 20,
    padding: 28,
    width: '100%',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#333',
  },
  modalIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#3a1010',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  modalIcon: {
    color: '#FF4D4D',
    fontSize: 32,
    fontWeight: '900',
  },
  modalTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 8,
  },
  modalMessage: {
    color: '#888',
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 22,
  },
  modalBtn: {
    width: '100%',
    backgroundColor: '#FF4D4D',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  modalBtnText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
});

export default LoginScreen;
