import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Alert, Dimensions, TouchableOpacity, ScrollView } from 'react-native';
import * as Location from 'expo-location';
import { auth, db } from '../config/firebase';
import { doc, updateDoc, onSnapshot, collection, query, where, setDoc } from 'firebase/firestore';
import MapView, { Marker, Circle } from 'react-native-maps';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { UserProfile } from '../types/user';
import * as Notifications from 'expo-notifications';

type LocationType = {
  latitude: number;
  longitude: number;
  timestamp: number;
};

type AreaType = {
  latitude: number;
  longitude: number;
  radius: number; // metre cinsinden
};

type UserLocation = {
  uid: string;
  email: string;
  location: LocationType;
};

type HomeScreenProps = {
  navigation: NativeStackNavigationProp<any>;
};

// Bildirimleri yapılandır
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export const HomeScreen: React.FC<HomeScreenProps> = ({ navigation }) => {
  const [location, setLocation] = useState<LocationType | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [monitoredArea, setMonitoredArea] = useState<AreaType | null>(null);
  const [isInArea, setIsInArea] = useState<boolean>(false);
  const [areaEntryTime, setAreaEntryTime] = useState<number | null>(null);
  const [followedUsers, setFollowedUsers] = useState<UserLocation[]>([]);
  const [mapRegion, setMapRegion] = useState({
    latitude: 41.0082,
    longitude: 28.9784,
    latitudeDelta: 0.0922,
    longitudeDelta: 0.0421,
  });
  const [selectedUser, setSelectedUser] = useState<UserLocation | null>(null);
  const [lastNotifiedDistances, setLastNotifiedDistances] = useState<{[key: string]: number}>({});

  // Kullanıcının kendi konumunu Firestore'a kaydet
  const updateUserLocation = async (newLocation: LocationType) => {
    if (!auth.currentUser) return;

    try {
      console.log('Konum güncelleniyor...', auth.currentUser.uid);
      await setDoc(doc(db, 'locations', auth.currentUser.uid), {
        uid: auth.currentUser.uid,
        location: newLocation,
        email: auth.currentUser.email,
        lastUpdated: new Date().toISOString()
      });
      console.log('Konum güncellendi');
    } catch (error) {
      console.error('Konum güncellenirken hata:', error);
    }
  };

  // Takip edilen kullanıcıların konumlarını dinle
  useEffect(() => {
    if (!auth.currentUser) return;

    console.log('Konum dinleme başladı, kullanıcı ID:', auth.currentUser.uid);

    const userDoc = doc(db, 'users', auth.currentUser.uid);
    const unsubscribeUser = onSnapshot(userDoc, async (doc) => {
      if (doc.exists()) {
        const userData = doc.data() as UserProfile;
        console.log('Kullanıcı profili yüklendi:', userData);
        console.log('Takip edilenler:', userData.following);
        console.log('Konum paylaşılanlar:', userData.shareLocationWith);

        // Sadece takip edilen kullanıcıların konumlarını al
        if (userData.following && userData.following.length > 0) {
          try {
            console.log('Takip edilen kullanıcılar için konum sorgusu yapılıyor...');
            
            // Önce locations koleksiyonunda döküman var mı kontrol et
            const locationsQuery = query(
              collection(db, 'locations'),
              where('uid', 'in', userData.following)
            );

            const unsubscribeLocations = onSnapshot(locationsQuery, (snapshot) => {
              console.log('Konum verisi alındı, döküman sayısı:', snapshot.size);
              const locations: UserLocation[] = [];
              
              snapshot.forEach((doc) => {
                const data = doc.data();
                console.log('Konum verisi:', data);
                
                if (data.location) {
                  locations.push({
                    uid: doc.id,
                    email: data.email,
                    location: data.location
                  });
                  console.log('Konum listesine eklendi:', data.email);
                }
              });
              
              console.log('Toplam konum sayısı:', locations.length);
              setFollowedUsers(locations);
            }, (error) => {
              console.error('Konum dinleme hatası:', error);
            });

            return () => {
              console.log('Konum dinleme durduruldu');
              unsubscribeLocations();
            };
          } catch (error) {
            console.error('Konum sorgusunda hata:', error);
          }
        } else {
          console.log('Takip edilen kullanıcı yok');
          setFollowedUsers([]);
        }
      } else {
        console.log('Kullanıcı profili bulunamadı');
      }
    });

    return () => {
      console.log('Kullanıcı dinleme durduruldu');
      unsubscribeUser();
    };
  }, []);

  // Mevcut konum takibi useEffect'i
  useEffect(() => {
    (async () => {
      try {
        console.log('Konum izinleri isteniyor...');
        let { status } = await Location.requestForegroundPermissionsAsync();
        console.log('Ön plan izin durumu:', status);

        if (status !== 'granted') {
          setErrorMsg('Konum izni reddedildi');
          return;
        }

        console.log('Arka plan izinleri isteniyor...');
        let backgroundStatus = await Location.requestBackgroundPermissionsAsync();
        console.log('Arka plan izin durumu:', backgroundStatus.status);

        console.log('Mevcut konum alınıyor...');
        let currentLocation = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 5000,
        });

        const locationData = {
          latitude: currentLocation.coords.latitude,
          longitude: currentLocation.coords.longitude,
          timestamp: currentLocation.timestamp,
        };

        setLocation(locationData);
        updateUserLocation(locationData);

        const locationSubscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: 5000,
            distanceInterval: 10,
          },
          (newLocation) => {
            const newLocationData = {
              latitude: newLocation.coords.latitude,
              longitude: newLocation.coords.longitude,
              timestamp: newLocation.timestamp,
            };
            setLocation(newLocationData);
            updateUserLocation(newLocationData);
          }
        );

        return () => {
          if (locationSubscription) {
            locationSubscription.remove();
          }
        };
      } catch (error) {
        console.error('Konum alınırken hata:', error);
        setErrorMsg('Konum alınırken bir hata oluştu: ' + error.message);
      }
    })();
  }, []);

  // Konum güncellendiğinde harita bölgesini güncelle
  useEffect(() => {
    if (location) {
      setMapRegion({
        latitude: location.latitude,
        longitude: location.longitude,
        latitudeDelta: 0.0922,
        longitudeDelta: 0.0421,
      });
    }
  }, [location]);

  // Mevcut konumu izleme alanı olarak ayarla
  const setCurrentLocationAsArea = () => {
    if (location) {
      setMonitoredArea({
        latitude: location.latitude,
        longitude: location.longitude,
        radius: 3000, // 3 km
      });
      Alert.alert('Bilgi', 'Bu konum artık takip edilecek alan olarak belirlendi.');
    }
  };

  // İki nokta arasındaki mesafeyi hesapla (Haversine formülü)
  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371e3; // Dünya'nın yarıçapı (metre)
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // metre cinsinden mesafe
  };

  // Alan kontrolü
  useEffect(() => {
    if (location && monitoredArea) {
      const distance = calculateDistance(
        location.latitude,
        location.longitude,
        monitoredArea.latitude,
        monitoredArea.longitude
      );

      const nowInArea = distance <= monitoredArea.radius;

      if (nowInArea && !isInArea) {
        // Alana yeni girdi
        setIsInArea(true);
        setAreaEntryTime(Date.now());
      } else if (!nowInArea && isInArea) {
        // Alandan çıktı
        setIsInArea(false);
        if (areaEntryTime && Date.now() - areaEntryTime >= 2 * 60 * 60 * 1000) {
          // 2 saat geçtikten sonra alandan çıktı
          Alert.alert(
            'Uyarı',
            'Belirlenen alanda 2 saat kaldıktan sonra alandan çıkıldı!'
          );
        }
        setAreaEntryTime(null);
      }
    }
  }, [location, monitoredArea]);

  // Haritayı seçili kullanıcının konumuna odakla
  const focusOnUser = (user: UserLocation) => {
    setSelectedUser(user);
    setMapRegion({
      latitude: user.location.latitude,
      longitude: user.location.longitude,
      latitudeDelta: 0.0922,
      longitudeDelta: 0.0421,
    });
  };

  // Bildirim izinlerini al
  useEffect(() => {
    (async () => {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;
      
      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }
      
      if (finalStatus !== 'granted') {
        Alert.alert('Hata', 'Bildirim izni olmadan uyarıları alamazsınız!');
        return;
      }
    })();
  }, []);

  // Kullanıcı konumlarını kontrol et ve gerekirse bildirim gönder
  useEffect(() => {
    if (!location || !followedUsers.length) return;

    followedUsers.forEach(async (user) => {
      const distance = calculateDistance(
        location.latitude,
        location.longitude,
        user.location.latitude,
        user.location.longitude
      );

      const lastDistance = lastNotifiedDistances[user.uid] || 0;
      const hasMovedSignificantly = Math.abs(distance - lastDistance) > 10; // 10 metre

      if (hasMovedSignificantly) {
        // Konumu güncelle ve bildirim gönder
        setLastNotifiedDistances(prev => ({
          ...prev,
          [user.uid]: distance
        }));

        // Firestore'a hareket bildirimi kaydet
        if (auth.currentUser) {
          try {
            const notificationData = {
              userId: user.uid,
              userEmail: user.email,
              distance: distance,
              timestamp: new Date().toISOString(),
              read: false
            };

            await setDoc(doc(db, 'users', user.uid, 'notifications', new Date().getTime().toString()), {
              type: 'location_change',
              message: `${auth.currentUser.email} konumundan 10m uzaklaştı!`,
              senderEmail: auth.currentUser.email,
              senderId: auth.currentUser.uid,
              distance: distance,
              timestamp: new Date().toISOString(),
              read: false
            });

            // Yerel bildirim gönder
            await Notifications.scheduleNotificationAsync({
              content: {
                title: 'Konum Değişikliği',
                body: `${user.email} konumundan 10m uzaklaştı! Yeni mesafe: ${(distance / 1000).toFixed(2)}km`,
                data: { userId: user.uid },
              },
              trigger: null,
            });
          } catch (error) {
            console.error('Bildirim gönderilirken hata:', error);
          }
        }
      }
    });
  }, [location, followedUsers]);

  return (
    <View style={styles.container}>
      <MapView 
        style={styles.map}
        region={mapRegion}
        showsUserLocation={true}
        showsMyLocationButton={true}
      >
        {followedUsers.map((user) => (
          <Marker
            key={user.uid}
            coordinate={{
              latitude: user.location.latitude,
              longitude: user.location.longitude,
            }}
            title={user.email}
            description={`Son güncelleme: ${new Date(user.location.timestamp).toLocaleTimeString()}`}
            pinColor="#4CAF50"
          />
        ))}
        {monitoredArea && (
          <Circle
            center={{
              latitude: monitoredArea.latitude,
              longitude: monitoredArea.longitude,
            }}
            radius={monitoredArea.radius}
            fillColor="rgba(0, 122, 255, 0.1)"
            strokeColor="rgba(0, 122, 255, 0.5)"
          />
        )}
      </MapView>

      {/* Üst bilgi paneli */}
      <View style={styles.topPanel}>
        <View style={styles.headerContainer}>
          <Text style={styles.headerTitle}>Aile Konum Takibi</Text>
          <Text style={styles.subtitle}>
            {followedUsers.length} kişi takip ediliyor
          </Text>
        </View>
      </View>

      {/* Alt panel - Takip edilen kullanıcılar */}
      <View style={styles.bottomSheet}>
        <View style={styles.bottomSheetHeader}>
          <View style={styles.bottomSheetIndicator} />
        </View>
        <ScrollView style={styles.userList}>
          {followedUsers.map((user) => (
            <TouchableOpacity
              key={user.uid}
              style={styles.userCard}
              onPress={() => {
                setMapRegion({
                  latitude: user.location.latitude,
                  longitude: user.location.longitude,
                  latitudeDelta: 0.0922,
                  longitudeDelta: 0.0421,
                });
              }}
            >
              <View style={styles.userAvatarContainer}>
                <Text style={styles.userAvatar}>
                  {user.email.charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={styles.userInfo}>
                <Text style={styles.userEmail}>{user.email}</Text>
                <Text style={styles.lastUpdate}>
                  Son Güncelleme: {new Date(user.location.timestamp).toLocaleTimeString()}
                </Text>
                {location && (
                  <Text style={styles.distance}>
                    {(calculateDistance(
                      location.latitude,
                      location.longitude,
                      user.location.latitude,
                      user.location.longitude
                    ) / 1000).toFixed(2)} km uzakta
                  </Text>
                )}
              </View>
              <View style={styles.arrowContainer}>
                <Text style={styles.arrow}>›</Text>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    width: '100%',
    height: '100%',
  },
  topPanel: {
    position: 'absolute',
    top: 50,
    left: 20,
    right: 20,
    backgroundColor: 'white',
    borderRadius: 15,
    padding: 15,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  headerContainer: {
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1a1a1a',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginTop: 5,
  },
  bottomSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'white',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingBottom: 20,
    maxHeight: '50%',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: -3,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  bottomSheetHeader: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  bottomSheetIndicator: {
    width: 40,
    height: 4,
    backgroundColor: '#dedede',
    borderRadius: 2,
  },
  userList: {
    marginTop: 10,
  },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
    padding: 15,
    borderRadius: 12,
    marginBottom: 10,
  },
  userAvatarContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  userAvatar: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  userInfo: {
    flex: 1,
  },
  userEmail: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 4,
  },
  lastUpdate: {
    fontSize: 12,
    color: '#666',
    marginBottom: 2,
  },
  distance: {
    fontSize: 13,
    color: '#007AFF',
    fontWeight: '500',
  },
  arrowContainer: {
    paddingLeft: 10,
  },
  arrow: {
    fontSize: 24,
    color: '#666',
  },
}); 