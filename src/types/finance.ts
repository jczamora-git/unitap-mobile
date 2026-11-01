export type ObligationType = 'FINE' | 'CONTRIBUTION';
export type ChargeType = ObligationType | 'OTHER';

export type ChargeTrigger = 'MANUAL' | 'ABSENCE' | 'LATE' | 'EVENT';

export type ObligationStatus = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' | 'WAIVED' | 'VOID';
export type ChargeStatus = ObligationStatus;

export interface ObligationRuleItem {
  id: string;
  semesterId: string;
  name: string;
  type: ObligationType;
  triggerType: ChargeTrigger;
  defaultAmountCentavos: number;
  dueOn?: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
}

// Backward-compatible alias
export interface ChargeTemplate {
  id: string;
  semesterId?: string;
  name: string;
  type?: ObligationType;
  chargeType?: ChargeType;
  triggerType: ChargeTrigger;
  defaultAmountCentavos?: number;
  defaultAmount?: number;
  dueOn?: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt?: string;
}

export interface StudentObligationItem {
  id: string;
  studentId: string;
  semesterId: string;
  ruleId?: string | null;
  relatedEventId?: string | null;
  relatedOccurrenceId?: string | null;
  title: string;
  type: ObligationType;
  amountCentavos: number;
  paidCentavos: number;
  balanceCentavos: number;
  status: ObligationStatus;
  dueDate?: string | null;
  batchId?: string | null;
  issuedByUserId?: string | null;
  issuedAt: string;
  updatedAt: string;
  voidReason?: string;
  schoolId?: string;
  studentName?: string;
  yearLevel?: number;
  section?: string;
}

// Backward-compatible alias
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

export type PaymentMethod = 'CASH' | 'MANUAL_TRANSFER_RECORD';
export type PaymentSource = PaymentMethod | 'SIMULATED_WALLET';
export type PaymentChannel = 'NFC' | 'MANUAL';
export type PaymentRecordStatus = 'POSTED' | 'REVERSED';

export interface PaymentAllocationItem {
  id: string;
  paymentId: string;
  obligationId: string;
  amountCentavos: number;
  obligationTitle?: string;
  obligationType?: ObligationType;
}

// Backward-compatible alias
export interface PaymentAllocation {
  id: string;
  paymentId: string;
  studentChargeId: string;
  amountApplied: number;
}

export interface PaymentItem {
  id: string;
  studentId: string;
  semesterId: string;
  referenceNumber: string;
  idempotencyKey: string;
  amountCentavos: number;
  source: PaymentMethod | 'SIMULATED_WALLET';
  channel: PaymentChannel;
  status: PaymentRecordStatus;
  processedByUserId: string;
  processedAt: string;
  reversedAt?: string | null;
  reversedByUserId?: string | null;
  reversalReason?: string | null;
  notes?: string | null;
  allocations: PaymentAllocationItem[];
  studentSchoolId?: string;
  studentName?: string;
}

// Backward-compatible alias
export interface Payment {
  id: string;
  studentId: string;
  referenceNumber: string;
  amount: number;
  paymentSource: string;
  paymentChannel: PaymentChannel;
  status: 'COMPLETED' | 'REVERSED';
  processedAt: string;
  allocations: PaymentAllocation[];
}

export interface AbsenteeCandidate {
  studentId: string;
  schoolId: string;
  fullName: string;
  yearLevel: number;
  section: string;
  occurrenceId: string;
  attendanceRequired: boolean;
  excused: boolean;
  alreadyFined: boolean;
  selected: boolean;
  attendanceStatus: 'ABSENT' | 'NOT_ATTENDED';
}

export interface OccurrenceAbsenteeSummary {
  occurrenceId: string;
  occurrenceTitle: string;
  eventTitle: string;
  occursOn: string;
  sessionStatus: 'SCHEDULED' | 'OPEN' | 'CLOSED' | 'CANCELLED';
  totalRequired: number;
  presentCount: number;
  lateCount: number;
  excusedCount: number;
  absentCount: number;
  alreadyFinedCount: number;
  eligibleForFineCount: number;
  isAuthoritativeRosterFinalized: boolean;
}

export interface BulkFineAssessmentParams {
  occurrenceId: string;
  ruleId: string;
  fineTitle: string;
  amountCentavos: number;
  dueDate?: string | null;
  studentIds: string[];
  notes?: string | null;
  actorUserId: string;
}

export interface BulkFineAssessmentResult {
  batchId: string;
  totalSelected: number;
  assessedCount: number;
  skippedCount: number;
  invalidCount: number;
  totalAssessedCentavos: number;
  createdObligations: StudentObligationItem[];
}

export interface BulkContributionParams {
  semesterId: string;
  ruleId?: string;
  title: string;
  amountCentavos: number;
  dueDate?: string | null;
  notes?: string | null;
  targetScope: 'ALL' | 'YEAR_LEVEL' | 'SECTION' | 'INDIVIDUAL';
  yearLevels?: number[];
  sections?: string[];
  studentIds?: string[];
  actorUserId: string;
}

export interface BulkContributionResult {
  batchId: string;
  totalAssigned: number;
  totalCentavos: number;
  createdObligations: StudentObligationItem[];
}

export interface PaymentReceipt {
  referenceNumber: string;
  paymentDate: string;
  student: {
    id: string;
    schoolId: string;
    fullName: string;
    section: string;
    yearLevel: number;
  };
  academicTerm: {
    semesterLabel: string;
    academicYearLabel: string;
  };
  receivedByOfficer: string;
  paymentMethod: PaymentMethod;
  notes?: string;
  items: Array<{
    obligationId: string;
    title: string;
    type: ObligationType;
    paidAmountCentavos: number;
    remainingBalanceCentavos: number;
  }>;
  totalPaidCentavos: number;
  isLocallyRecordedPendingSync: boolean;
}

export interface FinanceSummary {
  totalOutstandingCentavos: number;
  totalPaymentsCollectedCentavos: number;
  totalAssessedCentavos: number;
  unpaidFinesCount: number;
  unpaidContributionsCount: number;
  activeFinesCount: number;
  activeContributionsCount: number;
  // Deprecated fields kept for backward compatibility:
  totalSimulatedWalletCreditsCentavos?: number;
  unpaidChargesCount?: number;
  activeWalletsCount?: number;
}

// Deprecated wallet types kept for type-checking backwards compatibility
export type WalletStatus = 'ACTIVE' | 'FROZEN' | 'CLOSED';
export interface Wallet {
  id: string;
  studentId: string;
  status: WalletStatus;
  createdAt: string;
  updatedAt: string;
}
export type TransactionType = 'TOP_UP' | 'PAYMENT' | 'PAYMENT_REVERSAL' | 'TOPUP_REVERSAL' | 'ADJUSTMENT_ADD' | 'ADJUSTMENT_DEDUCT';
export interface WalletTransaction {
  id: string;
  walletId: string;
  studentId: string;
  type: TransactionType;
  amount: number;
  referenceNumber: string;
  description: string;
  createdAt: string;
}
