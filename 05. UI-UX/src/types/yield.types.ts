export interface YieldPoolDetails {
  poolName: string;
  protocol: string;
  network: string;
  apyPercentage: number;
  apyFormatted: string;
  isLive: boolean;
  tvlTotal: string;
  borrowedPercentage: number;
  userActiveBalance?: string;
  depositRateApr: string;
  borrowRateApr?: string;
  utilizationPercentage: number;
  poolStatuses: string[];
  explorerContractUrl: string;
}
