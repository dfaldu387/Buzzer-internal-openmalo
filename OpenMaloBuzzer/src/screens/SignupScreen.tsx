import React, {useState, useRef, useEffect} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Modal,
  ScrollView,
  Platform,
  Image,
  Keyboard,
  useWindowDimensions,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialIcons';
import {User} from '../types';

const BASE_WIDTH = 375;

interface Props {
  onSignup: (name: string, phone: string, pin: string, role: 'manager' | 'member', tenantCode?: string) => Promise<User>;
  onGoToLogin: () => void;
}

const SignupScreen: React.FC<Props> = ({onSignup, onGoToLogin}) => {
  const [companyCode, setCompanyCode] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [role, setRole] = useState<'manager' | 'member'>('member');
  const [loading, setLoading] = useState(false);
  const phoneRef = useRef<TextInput>(null);
  const pinRef = useRef<TextInput>(null);
  const confirmPinRef = useRef<TextInput>(null);
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

  const isFormValid =
    companyCode.trim().length > 0 &&
    name.trim().length >= 2 &&
    phone.length >= 10 &&
    pin.length === 4 &&
    confirmPin.length === 4;

  const nameRef = useRef<TextInput>(null);

  const handleSignup = async () => {
    if (!companyCode.trim()) {
      setAlertModal({visible: true, title: 'Error', message: 'Enter your company code'});
      return;
    }
    if (!name.trim()) {
      setAlertModal({visible: true, title: 'Error', message: 'Enter your name'});
      return;
    }
    if (phone.length < 10) {
      setAlertModal({visible: true, title: 'Error', message: 'Enter a valid phone number'});
      return;
    }
    if (pin.length !== 4) {
      setAlertModal({visible: true, title: 'Error', message: 'Enter a 4-digit PIN'});
      return;
    }
    if (pin !== confirmPin) {
      setAlertModal({visible: true, title: 'Error', message: 'PINs do not match'});
      return;
    }

    setLoading(true);
    try {
      await onSignup(name.trim(), phone, pin, role, companyCode.trim());
    } catch (e: any) {
      setAlertModal({visible: true, title: 'Error', message: e?.message || 'Something went wrong. Try again.'});
    } finally {
      setLoading(false);
    }
  };

  const bottomPadding = keyboardVisible
    ? insets.bottom +
      (Platform.OS === 'ios' ? keyboardHeight + 20 : 120)
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
        style={[styles.logoImage, {width: 70 * scale, height: 70 * scale}]}
      />
      <Text style={[styles.title, {fontSize: 28 * scale}]}>Create Account</Text>
      <Text
        style={[
          styles.subtitle,
          {fontSize: 14 * scale, marginBottom: height * 0.04},
        ]}>
        Join Buzzer
      </Text>

      <TextInput
        style={[
          styles.input,
          {fontSize: 16 * scale, paddingVertical: 14 * scale},
        ]}
        placeholder="Company Code (e.g. ACME)"
        placeholderTextColor="#999"
        autoCapitalize="characters"
        autoCorrect={false}
        value={companyCode}
        onChangeText={t => setCompanyCode(t.replace(/[^A-Za-z0-9]/g, '').toUpperCase())}
        maxLength={20}
        returnKeyType="next"
        onSubmitEditing={() => nameRef.current?.focus()}
      />

      <TextInput
        ref={nameRef}
        style={[
          styles.input,
          {fontSize: 16 * scale, paddingVertical: 14 * scale},
        ]}
        placeholder="Full name"
        placeholderTextColor="#999"
        autoCapitalize="words"
        value={name}
        onChangeText={setName}
        maxLength={50}
        returnKeyType="next"
        onSubmitEditing={() => phoneRef.current?.focus()}
      />

      <TextInput
        ref={phoneRef}
        style={[
          styles.input,
          {fontSize: 16 * scale, paddingVertical: 14 * scale},
        ]}
        placeholder="Phone number"
        placeholderTextColor="#999"
        keyboardType="phone-pad"
        value={phone}
        onChangeText={t => setPhone(t.replace(/[^0-9]/g, ''))}
        maxLength={15}
        returnKeyType="next"
        onSubmitEditing={() => pinRef.current?.focus()}
      />

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
        returnKeyType="next"
        onSubmitEditing={() => confirmPinRef.current?.focus()}
      />

      <TextInput
        ref={confirmPinRef}
        style={[
          styles.input,
          {fontSize: 16 * scale, paddingVertical: 14 * scale},
        ]}
        placeholder="Confirm PIN"
        placeholderTextColor="#999"
        keyboardType="number-pad"
        secureTextEntry
        value={confirmPin}
        onChangeText={setConfirmPin}
        maxLength={4}
        returnKeyType="done"
        onSubmitEditing={() => Keyboard.dismiss()}
      />

      <Text style={[styles.roleLabel, {fontSize: 13 * scale}]}>I am a</Text>
      <View style={styles.roleRow}>
        <TouchableOpacity
          style={[styles.roleChip, role === 'member' && styles.roleChipActive]}
          onPress={() => setRole('member')}>
          <Text style={[styles.roleChipText, {fontSize: 14 * scale}, role === 'member' && styles.roleChipTextActive]}>
            Member
          </Text>
          <Text style={[styles.roleChipSub, {fontSize: 11 * scale}]}>
            Can buzz managers
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.roleChip, role === 'manager' && styles.roleChipActive]}
          onPress={() => setRole('manager')}>
          <Text style={[styles.roleChipText, {fontSize: 14 * scale}, role === 'manager' && styles.roleChipTextActive]}>
            Management
          </Text>
          <Text style={[styles.roleChipSub, {fontSize: 11 * scale}]}>
            Can see all members
          </Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={[
          styles.button,
          {paddingVertical: 16 * scale},
          (loading || !isFormValid) && styles.buttonDisabled,
        ]}
        onPress={handleSignup}
        disabled={loading || !isFormValid}
        activeOpacity={0.8}>
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={[styles.buttonText, {fontSize: 16 * scale}]}>
            SIGN UP
          </Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.loginLink}
        onPress={onGoToLogin}
        activeOpacity={0.7}>
        <Text style={[styles.loginText, {fontSize: 14 * scale}]}>
          Already have an account?{' '}
          <Text style={styles.loginHighlight}>Login</Text>
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
    marginBottom: 12,
  },
  title: {
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
  loginLink: {
    marginTop: 24,
    alignItems: 'center',
  },
  loginText: {
    color: '#888',
  },
  loginHighlight: {
    color: '#FF4D4D',
    fontWeight: '700',
  },
  roleLabel: {
    color: '#999',
    fontWeight: '600',
    marginBottom: 8,
  },
  roleRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  roleChip: {
    flex: 1,
    backgroundColor: '#1A1A1A',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#333',
  },
  roleChipActive: {
    backgroundColor: '#2a1515',
    borderColor: '#FF4D4D',
  },
  roleChipText: {
    color: '#888',
    fontWeight: '700',
  },
  roleChipTextActive: {
    color: '#FF4D4D',
  },
  roleChipSub: {
    color: '#555',
    marginTop: 2,
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
  modalIcon: {color: '#FF4D4D', fontSize: 32, fontWeight: '900'},
  modalTitle: {color: '#fff', fontSize: 22, fontWeight: '800', marginBottom: 8},
  modalMessage: {color: '#888', fontSize: 18, textAlign: 'center', marginBottom: 24, lineHeight: 22},
  modalBtn: {width: '100%', backgroundColor: '#FF4D4D', paddingVertical: 14, borderRadius: 12, alignItems: 'center'},
  modalBtnText: {color: '#fff', fontSize: 18, fontWeight: '700'},
});

export default SignupScreen;
