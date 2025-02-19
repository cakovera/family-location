export type UserProfile = {
  uid: string;
  email: string;
  displayName?: string;
  followers: string[];  // Takipçilerin uid'leri
  following: string[];  // Takip edilenlerin uid'leri
  shareLocationWith: string[]; // Konum paylaşılan kullanıcıların uid'leri
  pendingLocationRequests: string[]; // Bekleyen konum paylaşım istekleri
  locationRequestsSent: string[]; // Gönderilen konum paylaşım istekleri
}; 