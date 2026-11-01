import type { 
  Student, 
  CreateStudentDto, 
  UpdateStudentDto, 
  StudentFilterOptions,
  DuplicateRfidCheckResult,
  NfcCardRecord
} from '@/types/student';
import { localStudentRepository, type IStudentRepository } from './student-storage.service';
import { formatFullName } from '@/utilities/student-formatters';

function generateStudentId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'stu_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
}

function generateCardId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'crd_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
}

export interface CardLookupResult {
  status: 'ACTIVE' | 'LOST' | 'REPLACED' | 'DEACTIVATED' | 'UNREGISTERED';
  student: Student | null;
  card: NfcCardRecord | null;
  scannedUid: string;
  normalizedUid: string;
  maskedUid: string;
}

export function maskRfidUid(uid: string): string {
  if (!uid) return 'Unavailable';
  const parts = uid.split(':');
  if (parts.length <= 2) return uid;
  return parts.map((part, index) => {
    if (index === 0 || index === parts.length - 1) return part;
    return '••';
  }).join(':');
}

export class StudentService {
  constructor(private repo: IStudentRepository = localStudentRepository) {}

  clearCache(): void {
    this.repo.clearCache();
  }

  async getStudents(): Promise<Student[]> {
    return this.repo.getAll();
  }

  async getStudent(id: string): Promise<Student | null> {
    if (!id) return null;
    return this.repo.getById(id);
  }

  async findStudentByStudentNumber(studentNumber: string): Promise<Student | null> {
    if (!studentNumber || !studentNumber.trim()) return null;
    return this.repo.getByStudentNumber(studentNumber);
  }

  async findStudentByRfid(rfidUid: string): Promise<Student | null> {
    if (!rfidUid || !rfidUid.trim()) return null;
    return this.repo.getByRfid(rfidUid);
  }

  async lookupCard(rfidUid: string): Promise<CardLookupResult> {
    const raw = (rfidUid || '').trim();
    if (!raw) {
      return {
        status: 'UNREGISTERED',
        student: null,
        card: null,
        scannedUid: '',
        normalizedUid: '',
        maskedUid: 'Unavailable'
      };
    }

    const cleanUid = raw.toUpperCase();
    const compactUid = cleanUid.replace(/[^0-9A-F]/g, '');
    const students = await this.repo.getAll();

    // 1. Search for active card
    for (const s of students) {
      if (s.cards && s.cards.length > 0) {
        const activeCard = s.cards.find(c => c.status === 'ACTIVE');
        if (activeCard) {
          const cUid = activeCard.rfidUid.trim().toUpperCase();
          const cCompact = (activeCard.rfidUidCompact || cUid).replace(/[^0-9A-F]/g, '');
          if (cUid === cleanUid || cCompact === compactUid) {
            return {
              status: 'ACTIVE',
              student: s,
              card: activeCard,
              scannedUid: raw,
              normalizedUid: activeCard.rfidUid,
              maskedUid: maskRfidUid(activeCard.rfidUid)
            };
          }
        }
      } else if (s.rfidUid) {
        const sUid = s.rfidUid.trim().toUpperCase();
        const sCompact = (s.rfidUidCompact || sUid).replace(/[^0-9A-F]/g, '');
        if (sUid === cleanUid || sCompact === compactUid) {
          return {
            status: 'ACTIVE',
            student: s,
            card: null,
            scannedUid: raw,
            normalizedUid: s.rfidUid,
            maskedUid: maskRfidUid(s.rfidUid)
          };
        }
      }
    }

    // 2. Search for historical / inactive card (LOST, REPLACED, DEACTIVATED)
    for (const s of students) {
      if (s.cards && s.cards.length > 0) {
        for (const c of s.cards) {
          const cUid = c.rfidUid.trim().toUpperCase();
          const cCompact = (c.rfidUidCompact || cUid).replace(/[^0-9A-F]/g, '');
          if (cUid === cleanUid || cCompact === compactUid) {
            return {
              status: c.status,
              student: s,
              card: c,
              scannedUid: raw,
              normalizedUid: c.rfidUid,
              maskedUid: maskRfidUid(c.rfidUid)
            };
          }
        }
      }
    }

    return {
      status: 'UNREGISTERED',
      student: null,
      card: null,
      scannedUid: raw,
      normalizedUid: cleanUid,
      maskedUid: maskRfidUid(cleanUid)
    };
  }

  async checkRfidAvailability(rfidUid: string, excludeStudentId?: string): Promise<DuplicateRfidCheckResult> {
    if (!rfidUid || !rfidUid.trim()) {
      return { isDuplicate: false, existingStudent: null };
    }

    const existing = await this.findStudentByRfid(rfidUid);
    if (existing && existing.id !== excludeStudentId) {
      return { isDuplicate: true, existingStudent: existing };
    }

    return { isDuplicate: false, existingStudent: null };
  }

  async checkStudentNumberAvailability(studentNumber: string, excludeStudentId?: string): Promise<boolean> {
    if (!studentNumber || !studentNumber.trim()) return true;
    const existing = await this.findStudentByStudentNumber(studentNumber.trim());
    if (existing && existing.id !== excludeStudentId) {
      return false; // Not available (already taken)
    }
    return true;
  }

  async createStudent(dto: CreateStudentDto): Promise<Student> {
    const firstName = dto.firstName?.trim();
    const lastName = dto.lastName?.trim();
    const studentNumber = dto.studentNumber?.trim();

    if (!firstName) {
      throw new Error('First Name is required.');
    }
    if (!lastName) {
      throw new Error('Last Name is required.');
    }
    if (!dto.yearLevel || dto.yearLevel < 1 || dto.yearLevel > 8) {
      throw new Error('Please select a valid Year Level.');
    }
    if (!dto.section || !dto.section.trim()) {
      throw new Error('Section is required.');
    }

    // Check duplicate Student Number if provided
    if (studentNumber) {
      const isAvailable = await this.checkStudentNumberAvailability(studentNumber);
      if (!isAvailable) {
        throw new Error(`Student Number "${studentNumber}" is already in use by another student.`);
      }
    }

    // Check duplicate RFID if provided
    if (dto.rfidUid && dto.rfidUid.trim()) {
      const duplicateCheck = await this.checkRfidAvailability(dto.rfidUid);
      if (duplicateCheck.isDuplicate && duplicateCheck.existingStudent) {
        const ownerName = formatFullName(
          duplicateCheck.existingStudent.firstName,
          duplicateCheck.existingStudent.middleName,
          duplicateCheck.existingStudent.lastName
        );
        throw new Error(
          `RFID card is already registered to ${ownerName} (${duplicateCheck.existingStudent.course} • ${duplicateCheck.existingStudent.section}).`
        );
      }
    }

    const now = new Date().toISOString();
    const studentId = generateStudentId();
    const rfidClean = dto.rfidUid?.trim() || null;
    const rfidCompact = dto.rfidUidCompact?.trim() || (rfidClean ? rfidClean.replace(/[^0-9A-Fa-f]/g, '').toUpperCase() : null);

    const initialCards: NfcCardRecord[] = [];
    if (rfidClean && rfidCompact) {
      initialCards.push({
        id: generateCardId(),
        studentId,
        rfidUid: rfidClean,
        rfidUidCompact: rfidCompact,
        status: 'ACTIVE',
        assignedAt: now
      });
    }

    const newStudent: Student = {
      id: studentId,
      studentNumber: studentNumber || undefined,
      firstName,
      middleName: dto.middleName?.trim() || undefined,
      lastName,
      yearLevel: dto.yearLevel,
      section: dto.section.trim(),
      course: dto.course?.trim() || 'BSIT',
      status: dto.status || 'ACTIVE',
      rfidUid: rfidClean,
      rfidUidCompact: rfidCompact,
      cards: initialCards,
      createdAt: now,
      updatedAt: now
    };

    return this.repo.save(newStudent);
  }

  async updateStudent(id: string, dto: UpdateStudentDto): Promise<Student> {
    const student = await this.repo.getById(id);
    if (!student) {
      throw new Error('Student record not found.');
    }

    if (dto.firstName !== undefined && !dto.firstName.trim()) {
      throw new Error('First Name cannot be empty.');
    }
    if (dto.lastName !== undefined && !dto.lastName.trim()) {
      throw new Error('Last Name cannot be empty.');
    }

    if (dto.studentNumber !== undefined && dto.studentNumber.trim()) {
      const isAvailable = await this.checkStudentNumberAvailability(dto.studentNumber.trim(), id);
      if (!isAvailable) {
        throw new Error(`Student Number "${dto.studentNumber.trim()}" is already assigned to another student.`);
      }
    }

    // If RFID is being modified/added directly, verify uniqueness
    if (dto.rfidUid && dto.rfidUid.trim() && dto.rfidUid !== student.rfidUid) {
      const duplicateCheck = await this.checkRfidAvailability(dto.rfidUid, id);
      if (duplicateCheck.isDuplicate && duplicateCheck.existingStudent) {
        const ownerName = formatFullName(
          duplicateCheck.existingStudent.firstName,
          duplicateCheck.existingStudent.middleName,
          duplicateCheck.existingStudent.lastName
        );
        throw new Error(
          `RFID card is already registered to ${ownerName} (${duplicateCheck.existingStudent.course} • ${duplicateCheck.existingStudent.section}).`
        );
      }
    }

    const updated: Student = {
      ...student,
      studentNumber: dto.studentNumber !== undefined ? (dto.studentNumber.trim() || undefined) : student.studentNumber,
      firstName: dto.firstName !== undefined ? dto.firstName.trim() : student.firstName,
      middleName: dto.middleName !== undefined ? (dto.middleName.trim() || undefined) : student.middleName,
      lastName: dto.lastName !== undefined ? dto.lastName.trim() : student.lastName,
      yearLevel: dto.yearLevel !== undefined ? dto.yearLevel : student.yearLevel,
      section: dto.section !== undefined ? dto.section.trim() : student.section,
      course: dto.course !== undefined ? (dto.course.trim() || 'BSIT') : student.course,
      status: dto.status !== undefined ? dto.status : (student.status || 'ACTIVE'),
      rfidUid: dto.rfidUid !== undefined ? (dto.rfidUid ? dto.rfidUid.trim() : null) : student.rfidUid,
      rfidUidCompact: dto.rfidUidCompact !== undefined 
        ? (dto.rfidUidCompact ? dto.rfidUidCompact.trim() : null) 
        : (dto.rfidUid !== undefined && dto.rfidUid ? dto.rfidUid.replace(/[^0-9A-Fa-f]/g, '').toUpperCase() : student.rfidUidCompact),
      updatedAt: new Date().toISOString()
    };

    return this.repo.save(updated);
  }

  async replaceStudentRfid(id: string, newRfidUid: string, newRfidCompact?: string, note?: string): Promise<Student> {
    const student = await this.repo.getById(id);
    if (!student) {
      throw new Error('Student record not found.');
    }

    const cleanUid = newRfidUid.trim();
    const compactUid = newRfidCompact?.trim() || cleanUid.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();

    const duplicateCheck = await this.checkRfidAvailability(cleanUid, id);
    if (duplicateCheck.isDuplicate && duplicateCheck.existingStudent) {
      const ownerName = formatFullName(
        duplicateCheck.existingStudent.firstName,
        duplicateCheck.existingStudent.middleName,
        duplicateCheck.existingStudent.lastName
      );
      throw new Error(
        `This card is already assigned to ${ownerName} (${duplicateCheck.existingStudent.course} • ${duplicateCheck.existingStudent.section}).`
      );
    }

    const now = new Date().toISOString();
    const cards = [...(student.cards || [])];

    // Mark previous active cards as REPLACED
    cards.forEach(card => {
      if (card.status === 'ACTIVE') {
        card.status = 'REPLACED';
        card.deactivatedAt = now;
      }
    });

    // Add new active card
    cards.push({
      id: generateCardId(),
      studentId: id,
      rfidUid: cleanUid,
      rfidUidCompact: compactUid,
      status: 'ACTIVE',
      assignedAt: now,
      note: note?.trim() || undefined
    });

    const updated: Student = {
      ...student,
      rfidUid: cleanUid,
      rfidUidCompact: compactUid,
      cards,
      updatedAt: now
    };

    return this.repo.save(updated);
  }

  async deactivateStudentRfid(id: string, reason?: string): Promise<Student> {
    const student = await this.repo.getById(id);
    if (!student) {
      throw new Error('Student record not found.');
    }

    const now = new Date().toISOString();
    const cards = [...(student.cards || [])];

    cards.forEach(card => {
      if (card.status === 'ACTIVE') {
        card.status = 'DEACTIVATED';
        card.deactivatedAt = now;
        if (reason) card.note = reason;
      }
    });

    const updated: Student = {
      ...student,
      rfidUid: null,
      rfidUidCompact: null,
      cards,
      updatedAt: now
    };

    return this.repo.save(updated);
  }

  async removeStudentRfid(id: string): Promise<Student> {
    return this.deactivateStudentRfid(id, 'Removed by operator');
  }

  async deleteStudent(id: string): Promise<void> {
    const existing = await this.repo.getById(id);
    if (!existing) {
      throw new Error('Student record not found.');
    }
    return this.repo.delete(id);
  }

  async searchStudents(query: string, filters?: StudentFilterOptions): Promise<Student[]> {
    const all = await this.repo.getAll();
    const cleanQuery = (query || '').trim().toLowerCase();
    const compactQuery = cleanQuery.replace(/[^0-9a-f]/g, '');

    return all.filter(student => {
      // Apply filters if provided
      if (filters?.yearLevel && student.yearLevel !== filters.yearLevel) {
        return false;
      }
      if (filters?.section && filters.section.trim()) {
        if (student.section.toLowerCase() !== filters.section.trim().toLowerCase()) {
          return false;
        }
      }
      if (filters?.course && filters.course.trim()) {
        if (student.course.toLowerCase() !== filters.course.trim().toLowerCase()) {
          return false;
        }
      }
      if (filters?.status && (student.status || 'ACTIVE') !== filters.status) {
        return false;
      }

      // If no search query, match all that passed filter
      if (!cleanQuery) return true;

      const fullName = formatFullName(student.firstName, student.middleName, student.lastName).toLowerCase();
      const first = (student.firstName || '').toLowerCase();
      const middle = (student.middleName || '').toLowerCase();
      const last = (student.lastName || '').toLowerCase();
      const section = (student.section || '').toLowerCase();
      const course = (student.course || '').toLowerCase();
      const studentNum = (student.studentNumber || '').toLowerCase();
      const rfid = (student.rfidUid || '').toLowerCase();
      const rfidCompact = (student.rfidUidCompact || '').toLowerCase();

      return (
        fullName.includes(cleanQuery) ||
        first.includes(cleanQuery) ||
        middle.includes(cleanQuery) ||
        last.includes(cleanQuery) ||
        section.includes(cleanQuery) ||
        course.includes(cleanQuery) ||
        studentNum.includes(cleanQuery) ||
        rfid.includes(cleanQuery) ||
        (compactQuery.length > 0 && rfidCompact.includes(compactQuery))
      );
    });
  }
}

export const studentService = new StudentService();
