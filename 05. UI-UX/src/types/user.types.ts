export interface UserProfileData {
  nombre: string;
  correo: string;
  telefono: string;
  faceIdLinked: boolean;
  faceIdKeyId?: string;
  registradoEn: string;
  walletAddress?: string;
  tag?: string;
}

export interface LocationCoordinates {
  latitude: number;
  longitude: number;
  accuracy?: number;
}
