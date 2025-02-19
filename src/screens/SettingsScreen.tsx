import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, FlatList, Alert } from 'react-native';
import { signOut } from 'firebase/auth';
import { auth, db } from '../config/firebase';
import { collection, doc, getDoc, setDoc, updateDoc, query, where, getDocs, onSnapshot } from 'firebase/firestore';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { UserProfile } from '../types/user';

type SettingsScreenProps = {
  navigation: NativeStackNavigationProp<any>;
};

type Notification = {
  id: string;
  type: string;
  message: string;
  senderEmail: string;
  senderId: string;
  distance: number;
  timestamp: string;
  read: boolean;
};

export const SettingsScreen: React.FC<SettingsScreenProps> = ({ navigation }) => {
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [searchEmail, setSearchEmail] = useState('');
  const [searchResults, setSearchResults] = useState<UserProfile[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    loadUserProfile();
  }, []);

  useEffect(() => {
    if (!auth.currentUser) return;

    const unsubscribe = onSnapshot(
      collection(db, 'users', auth.currentUser.uid, 'notifications'),
      (snapshot) => {
        const newNotifications: Notification[] = [];
        snapshot.forEach((doc) => {
          newNotifications.push({
            id: doc.id,
            ...doc.data()
          } as Notification);
        });
        
        // Bildirimleri tarihe göre sırala
        newNotifications.sort((a, b) => 
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
        
        setNotifications(newNotifications);
      }
    );

    return () => unsubscribe();
  }, []);

  const loadUserProfile = async () => {
    if (!auth.currentUser) return;

    const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
    if (userDoc.exists()) {
      setUserProfile(userDoc.data() as UserProfile);
    } else {
      // Yeni kullanıcı profili oluştur
      const newProfile: UserProfile = {
        uid: auth.currentUser.uid,
        email: auth.currentUser.email || '',
        followers: [],
        following: [],
        shareLocationWith: [],
        pendingLocationRequests: [],
        locationRequestsSent: []
      };
      await setDoc(doc(db, 'users', auth.currentUser.uid), newProfile);
      setUserProfile(newProfile);
    }
  };

  const searchUsers = async () => {
    if (!searchEmail.trim()) return;

    const q = query(
      collection(db, 'users'),
      where('email', '==', searchEmail.trim())
    );

    const querySnapshot = await getDocs(q);
    const results: UserProfile[] = [];
    querySnapshot.forEach((doc) => {
      if (doc.id !== auth.currentUser?.uid) {
        results.push(doc.data() as UserProfile);
      }
    });
    setSearchResults(results);
  };

  const toggleFollow = async (targetUser: UserProfile) => {
    if (!userProfile || !auth.currentUser) return;

    const isFollowing = userProfile.following.includes(targetUser.uid);
    const userRef = doc(db, 'users', auth.currentUser.uid);
    const targetUserRef = doc(db, 'users', targetUser.uid);

    if (isFollowing) {
      // Takibi bırak
      await updateDoc(userRef, {
        following: userProfile.following.filter(id => id !== targetUser.uid),
        shareLocationWith: userProfile.shareLocationWith.filter(id => id !== targetUser.uid)
      });
      await updateDoc(targetUserRef, {
        followers: targetUser.followers.filter(id => id !== auth.currentUser?.uid),
        shareLocationWith: targetUser.shareLocationWith.filter(id => id !== auth.currentUser?.uid)
      });
    } else {
      // Takip et ve otomatik olarak konum paylaşımını başlat
      await updateDoc(userRef, {
        following: [...userProfile.following, targetUser.uid],
        shareLocationWith: [...userProfile.shareLocationWith, targetUser.uid]
      });
      await updateDoc(targetUserRef, {
        followers: [...targetUser.followers, auth.currentUser.uid],
        shareLocationWith: [...targetUser.shareLocationWith, auth.currentUser.uid]
      });
    }

    loadUserProfile();
    Alert.alert(
      'Başarılı',
      isFollowing ? 'Takipten çıktınız' : 'Takip etmeye başladınız'
    );
  };

  const sendLocationRequest = async (targetUser: UserProfile) => {
    if (!userProfile || !auth.currentUser) return;

    try {
      // Hedef kullanıcının bekleyen isteklerine ekle
      await updateDoc(doc(db, 'users', targetUser.uid), {
        pendingLocationRequests: [...targetUser.pendingLocationRequests || [], auth.currentUser.uid]
      });

      // Kendi gönderilen isteklerimize ekle
      await updateDoc(doc(db, 'users', auth.currentUser.uid), {
        locationRequestsSent: [...userProfile.locationRequestsSent || [], targetUser.uid]
      });

      Alert.alert('Başarılı', 'Konum paylaşım isteği gönderildi');
    } catch (error) {
      console.error('İstek gönderilirken hata:', error);
      Alert.alert('Hata', 'İstek gönderilemedi');
    }
  };

  const acceptLocationRequest = async (requesterUid: string) => {
    if (!userProfile || !auth.currentUser) return;

    try {
      // Kendi profilimizi güncelle
      await updateDoc(doc(db, 'users', auth.currentUser.uid), {
        pendingLocationRequests: userProfile.pendingLocationRequests.filter(uid => uid !== requesterUid),
        shareLocationWith: [...userProfile.shareLocationWith, requesterUid]
      });

      // İstek gönderen kullanıcının profilini güncelle
      const requesterRef = doc(db, 'users', requesterUid);
      const requesterDoc = await getDoc(requesterRef);
      if (requesterDoc.exists()) {
        const requesterData = requesterDoc.data() as UserProfile;
        await updateDoc(requesterRef, {
          locationRequestsSent: requesterData.locationRequestsSent.filter(uid => uid !== auth.currentUser.uid),
          shareLocationWith: [...requesterData.shareLocationWith || [], auth.currentUser.uid]
        });
      }

      Alert.alert('Başarılı', 'Konum paylaşım isteği kabul edildi');
    } catch (error) {
      console.error('İstek kabul edilirken hata:', error);
      Alert.alert('Hata', 'İstek kabul edilemedi');
    }
  };

  const rejectLocationRequest = async (requesterUid: string) => {
    if (!userProfile || !auth.currentUser) return;

    try {
      // Kendi profilimizden isteği kaldır
      await updateDoc(doc(db, 'users', auth.currentUser.uid), {
        pendingLocationRequests: userProfile.pendingLocationRequests.filter(uid => uid !== requesterUid)
      });

      // İstek gönderen kullanıcının gönderilen isteklerinden kaldır
      const requesterRef = doc(db, 'users', requesterUid);
      const requesterDoc = await getDoc(requesterRef);
      if (requesterDoc.exists()) {
        const requesterData = requesterDoc.data() as UserProfile;
        await updateDoc(requesterRef, {
          locationRequestsSent: requesterData.locationRequestsSent.filter(uid => uid !== auth.currentUser.uid)
        });
      }

      Alert.alert('Bilgi', 'Konum paylaşım isteği reddedildi');
    } catch (error) {
      console.error('İstek reddedilirken hata:', error);
      Alert.alert('Hata', 'İstek reddedilemedi');
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <View style={styles.container}>
      {userProfile && (
        <>
          <Text style={styles.title}>Profil</Text>
          <Text style={styles.email}>{userProfile.email}</Text>
          <Text style={styles.stats}>
            Takipçi: {userProfile.followers.length} | Takip: {userProfile.following.length}
          </Text>

          {/* Bekleyen İstekler */}
          {userProfile.pendingLocationRequests?.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Bekleyen Konum İstekleri</Text>
              {userProfile.pendingLocationRequests.map(async (uid) => {
                const userDoc = await getDoc(doc(db, 'users', uid));
                const userData = userDoc.data() as UserProfile;
                return (
                  <View key={uid} style={styles.requestItem}>
                    <Text>{userData.email}</Text>
                    <View style={styles.requestButtons}>
                      <TouchableOpacity 
                        style={[styles.button, styles.acceptButton]}
                        onPress={() => acceptLocationRequest(uid)}
                      >
                        <Text style={styles.buttonText}>Kabul Et</Text>
                      </TouchableOpacity>
                      <TouchableOpacity 
                        style={[styles.button, styles.rejectButton]}
                        onPress={() => rejectLocationRequest(uid)}
                      >
                        <Text style={styles.buttonText}>Reddet</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          <View style={styles.searchContainer}>
            <TextInput
              style={styles.searchInput}
              placeholder="Kullanıcı e-postası ara"
              value={searchEmail}
              onChangeText={setSearchEmail}
              autoCapitalize="none"
            />
            <TouchableOpacity style={styles.searchButton} onPress={searchUsers}>
              <Text style={styles.buttonText}>Ara</Text>
            </TouchableOpacity>
          </View>

          <FlatList
            data={searchResults}
            keyExtractor={(item) => item.uid}
            renderItem={({ item }) => (
              <View style={styles.userItem}>
                <Text>{item.email}</Text>
                <View style={styles.actionButtons}>
                  {!userProfile.following.includes(item.uid) && (
                    <TouchableOpacity
                      style={styles.followButton}
                      onPress={() => toggleFollow(item)}
                    >
                      <Text style={styles.buttonText}>Takip Et</Text>
                    </TouchableOpacity>
                  )}
                  {!userProfile.shareLocationWith.includes(item.uid) && 
                   !userProfile.locationRequestsSent.includes(item.uid) && (
                    <TouchableOpacity
                      style={styles.locationRequestButton}
                      onPress={() => sendLocationRequest(item)}
                    >
                      <Text style={styles.buttonText}>Konum İste</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            )}
          />
        </>
      )}

      {notifications.length > 0 && (
        <View style={styles.notificationSection}>
          <Text style={styles.sectionTitle}>Bildirimler</Text>
          {notifications.map((notification) => (
            <View 
              key={notification.id} 
              style={[
                styles.notificationCard,
                !notification.read && styles.unreadNotification
              ]}
            >
              <Text style={styles.notificationSender}>{notification.senderEmail}</Text>
              <Text style={styles.notificationMessage}>{notification.message}</Text>
              <Text style={styles.notificationTime}>
                {new Date(notification.timestamp).toLocaleString()}
              </Text>
            </View>
          ))}
        </View>
      )}

      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <Text style={styles.buttonText}>Çıkış Yap</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  email: {
    fontSize: 16,
    marginBottom: 5,
  },
  stats: {
    fontSize: 14,
    color: '#666',
    marginBottom: 20,
  },
  searchContainer: {
    flexDirection: 'row',
    marginBottom: 20,
  },
  searchInput: {
    flex: 1,
    height: 40,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 10,
    marginRight: 10,
  },
  searchButton: {
    backgroundColor: '#007AFF',
    padding: 10,
    borderRadius: 8,
    justifyContent: 'center',
  },
  userItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  followButton: {
    backgroundColor: '#007AFF',
    padding: 8,
    borderRadius: 8,
    minWidth: 100,
    alignItems: 'center',
  },
  actionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  locationRequestButton: {
    backgroundColor: '#007AFF',
    padding: 8,
    borderRadius: 8,
    minWidth: 100,
    alignItems: 'center',
    marginLeft: 10,
  },
  logoutButton: {
    backgroundColor: '#FF3B30',
    padding: 15,
    borderRadius: 8,
    marginTop: 'auto',
  },
  buttonText: {
    color: 'white',
    textAlign: 'center',
    fontSize: 16,
    fontWeight: 'bold',
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  requestItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  requestButtons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  acceptButton: {
    backgroundColor: '#007AFF',
    padding: 8,
    borderRadius: 8,
    marginRight: 10,
  },
  rejectButton: {
    backgroundColor: '#FF3B30',
    padding: 8,
    borderRadius: 8,
  },
  notificationSection: {
    marginTop: 20,
    marginBottom: 20,
  },
  notificationCard: {
    backgroundColor: '#f8f9fa',
    padding: 15,
    borderRadius: 12,
    marginBottom: 10,
  },
  unreadNotification: {
    backgroundColor: '#e3f2fd',
    borderLeftWidth: 4,
    borderLeftColor: '#007AFF',
  },
  notificationSender: {
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 5,
  },
  notificationMessage: {
    fontSize: 14,
    marginBottom: 5,
  },
  notificationTime: {
    fontSize: 12,
    color: '#666',
  },
}); 