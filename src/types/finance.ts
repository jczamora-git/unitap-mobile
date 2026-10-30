export type ChargeType = 'FINE' | 'CONTRIBUTION' | 'OTHER';

export type ChargeTrigger = 'MANUAL' | 'ABSENCE' | 'EVENT';

export type ChargeStatus = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' | 'VOID';

export interface ChargeTemplate {
  id: string;
  name: string;
  chargeType: ChargeType;
  defaultAmount: number; // In centavos (e.g. 2500 for ₱25.00)
  triggerType: ChargeTrigger;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
}

export interface StudentCharge {
  id: string;
  studentId: string;
  chargeTemplateId?: string;
  title: string;
  chargeType: ChargeType;
  issuedAmount: number; // In centavos
  paidAmount: number; // In centavos
  status: ChargeStatus;
  relatedEventId?: string;
  relatedOccurrenceId?: string;
  remarks?: string;
  voidReason?: string;
  issuedAt: string;
  updatedAt: string;
}

export type WalletStatus = 'ACTIVE' | 'FROZEN' | 'CLOSED';

export interface Wallet {
  id: string;
  studentId: string;
  status: WalletStatus;
  createdAt: string;
  updatedAt: string;
}

export type TransactionType =
  | 'TOP_UP'
  | 'PAYMENT'
  | 'PAYMENT_REVERSAL'
  | 'TOPUP_REVERSAL'
  | 'ADJUSTMENT_ADD'
  | 'ADJUSTMENT_DEDUCT';

export interface WalletTransaction {
  id: string;
  walletId: string;
  studentId: string;
  type: TransactionType;
  amount: number; // In centavos, strictly positive
  referenceNumber: string;
  relatedPaymentId?: string;
  relatedTopupId?: string;
  reversalOfId?: string;
  description: string;
  createdAt: string;
}

export type PaymentSource = 'WALLET';

export type PaymentChannel = 'NFC' | 'MANUAL';

export interface PaymentAllocation {
  id: string;
  paymentId: string;
  studentChargeId: string;
  amountApplied: number; // In centavos
}

export interface Payment {
  id: string;
  studentId: string;
  referenceNumber: string;
  amount: number; // In centavos
  paymentSource: PaymentSource;
  paymentChannel: PaymentChannel;
  status: 'COMPLETED' | 'REVERSED';
  processedAt: string;
  allocations: PaymentAllocation[];
}

export interface FinanceSummary {
  totalOutstandingCentavos: number;
  totalSimulatedWalletCreditsCentavos: number;
  totalPaymentsCollectedCentavos: number;
  unpaidChargesCount: number;
  activeWalletsCount: number;
}
