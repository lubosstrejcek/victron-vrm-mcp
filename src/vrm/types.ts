export interface VrmUserResponse {
  success: boolean;
  user: {
    id: number;
    name: string;
    email: string;
    country: string;
    accessLevel: number;
  };
}

export interface VrmInstallationRecord {
  idSite: number;
  accessLevel: number;
  owner: boolean;
  is_admin: boolean;
  name: string;
  identifier: string;
  idUser: number;
  pvMax?: number;
  timezone?: string;
}

export interface VrmInstallationsResponse {
  success: boolean;
  records: VrmInstallationRecord[];
}
