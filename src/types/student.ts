export type YearLevel = 1 | 2 | 3 | 4;

export type StudentStatus = 'ACTIVE' | 'INACTIVE' | 'GRADUATED';

export type NfcCardStatus = 'ACTIVE' | 'LOST' | 'REPLACED' | 'DEACTIVATED';

export interface NfcCardRecord {
  id: string;
  studentId: string;
  rfidUid: string; // "04:A7:32:91:BC:20:80"
  rfidUidCompact: string; // "04A73291BC2080"
  status: NfcCardStatus;
  assignedAt: string; // ISO Timestamp
  deactivatedAt?: string; // ISO Timestamp
  note?: string;
}

export interface Student {
  id: string; // Internal UUID
  studentNumber?: string; // e.g. "2023-10024" (optional for legacy records, required for new ones)
  firstName: string;
  middleName?: string;
  lastName: string;
  yearLevel: YearLevel;
  section: string;
  course: string;
  status?: StudentStatus;
  rfidUid: string | null; // "04:A7:32:91:BC:20:80"
  rfidUidCompact: string | null; // "04A73291BC2080"
  cards?: NfcCardRecord[];
  createdAt: string; // ISO Timestamp
  updatedAt: string; // ISO Timestamp
}

export interface CreateStudentDto {
  studentNumber?: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  yearLevel: YearLevel;
  section: string;
  course?: string;
  status?: StudentStatus;
  rfidUid?: string | null;
  rfidUidCompact?: string | null;
}

export interface UpdateStudentDto {
  studentNumber?: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  yearLevel?: YearLevel;
  section?: string;
  course?: string;
  status?: StudentStatus;
  rfidUid?: string | null;
  rfidUidCompact?: string | null;
}

export interface StudentFilterOptions {
  yearLevel?: YearLevel | null;
  section?: string | null;
  course?: string | null;
  status?: StudentStatus | null;
}

export interface DuplicateRfidCheckResult {
  isDuplicate: boolean;
  existingStudent: Student | null;
}
