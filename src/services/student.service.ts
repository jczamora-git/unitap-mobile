import type { 
  Student, 
  CreateStudentDto, 
  UpdateStudentDto, 
  StudentFilterOptions,
  DuplicateRfidCheckResult,
  NfcCardRecord,
  YearLevel
} from '@/types/student';
import { localStudentRepository, type IStudentRepository } from './student-storage.service';
import { formatFullName } from '@/utilities/student-formatters';
import { normalizeSchoolId } from '@/utilities/school-id-normalizer';
import { OperationPolicyService } from './operation-policy.service';
import { DataModeService } from './data-mode.service';
import { supabase } from '@/integrations/supabase/client';
import { AcademicRepository } from '@/database/repositories/academic.repository';
import { StudentsRepository } from '@/database/repositories/students.repository';
import { CardsRepository } from '@/database/repositories/cards.repository';
import { getDatabase } from '@/database/database';
import { logDataSource } from '@/utilities/data-source-logger';

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
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

export const STUDENT_PHOTOS_BUCKET = 'student-profile-photos';

interface CachedPhotoUrl {
  url: string;
  expiresAt: number; // timestamp ms
}

export class StudentService {
  private static photoUrlCache = new Map<string, CachedPhotoUrl>();

  constructor(private repo: IStudentRepository = localStudentRepository) {}

  clearCache(): void {
    this.repo.clearCache();
    StudentService.photoUrlCache.clear();
  }

  clearPhotoUrlCache(): void {
    StudentService.photoUrlCache.clear();
  }

  // ============================================================================
  // STUDENT PROFILE PHOTO OPERATIONS (Private Supabase Storage & Signed URLs)
  // ============================================================================

  getStudentPhotoUrl(student?: Partial<Student> | any | null): string | null {
    if (!student) return null;
    if (student.photoLocalUri || student.photo_local_uri) {
      return student.photoLocalUri || student.photo_local_uri;
    }
    if (student.photoUrl) return student.photoUrl;

    const storagePath = student.photoStoragePath || student.photo_storage_path;
    if (storagePath) {
      const cached = StudentService.photoUrlCache.get(storagePath);
      if (cached && cached.expiresAt > Date.now() + 60000) {
        return cached.url;
      }
    }

    return null;
  }

  async resolveStudentPhotoUrl(student?: Partial<Student> | any | null, forceRefresh = false): Promise<string | null> {
    if (!student) return null;
    if (student.photoLocalUri || student.photo_local_uri) {
      return student.photoLocalUri || student.photo_local_uri;
    }

    const storagePath = student.photoStoragePath || student.photo_storage_path;
    if (!storagePath) {
      return student.photoUrl || null;
    }

    if (!forceRefresh) {
      const cached = StudentService.photoUrlCache.get(storagePath);
      if (cached && cached.expiresAt > Date.now() + 60000) {
        return cached.url;
      }
    }

    if (DataModeService.isDirectSupabase() || (typeof navigator !== 'undefined' && navigator.onLine)) {
      try {
        const { data, error } = await supabase.storage
          .from(STUDENT_PHOTOS_BUCKET)
          .createSignedUrl(storagePath, 3600);

        if (!error && data?.signedUrl) {
          StudentService.photoUrlCache.set(storagePath, {
            url: data.signedUrl,
            expiresAt: Date.now() + 3500 * 1000,
          });
          return data.signedUrl;
        }
      } catch (err) {
        console.warn('[StudentService] Failed to create signed photo URL:', err);
      }
    }

    return null;
  }

  async preloadStudentPhotoUrls(students: Array<Partial<Student> | any>): Promise<void> {
    if (!DataModeService.isDirectSupabase() || !students || students.length === 0) return;

    const pathsToFetch: string[] = [];
    const now = Date.now();

    for (const s of students) {
      const path = s.photoStoragePath || s.photo_storage_path;
      if (path && typeof path === 'string') {
        const cached = StudentService.photoUrlCache.get(path);
        if (!cached || cached.expiresAt <= now + 60000) {
          pathsToFetch.push(path);
        }
      }
    }

    if (pathsToFetch.length === 0) return;

    const uniquePaths = Array.from(new Set(pathsToFetch));
    try {
      const { data, error } = await supabase.storage
        .from(STUDENT_PHOTOS_BUCKET)
        .createSignedUrls(uniquePaths, 3600);

      if (!error && Array.isArray(data)) {
        for (const item of data) {
          if (item && item.path && item.signedUrl) {
            StudentService.photoUrlCache.set(item.path, {
              url: item.signedUrl,
              expiresAt: now + 3500 * 1000,
            });
          }
        }
      }
    } catch (err) {
      console.warn('[StudentService] Failed to preload signed photo URLs:', err);
    }
  }

  async uploadStudentPhoto(
    studentId: string,
    file: File | Blob,
    isSelfService: boolean = false
  ): Promise<{ photoStoragePath: string; photoUrl: string }> {
    await OperationPolicyService.assertPermitted('STUDENTS_CREATE_UPDATE_DEACTIVATE');
    if (!studentId) throw new Error('Student ID is required for photo upload.');

    if (file.size > 5 * 1024 * 1024) {
      throw new Error('Photo file size exceeds the 5MB maximum limit.');
    }

    const mime = file.type || 'image/jpeg';
    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/jpg'];
    if (!validTypes.includes(mime.toLowerCase())) {
      throw new Error('Unsupported image format. Please upload a JPEG, PNG, or WEBP image.');
    }

    const ext = mime.includes('webp') ? 'webp' : (mime.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg');
    const storagePath = `${studentId}/profile.${ext}`;

    if (DataModeService.isDirectSupabase()) {
      // 1. Fetch current student's existing photo_storage_path to clean up old photo after replacement
      const { data: s } = await supabase
        .from('students')
        .select('photo_storage_path')
        .eq('id', studentId)
        .maybeSingle();

      const oldStoragePath = s?.photo_storage_path;

      // 2. Upload with upsert using consistent student UUID file path
      const { error: uploadErr } = await supabase.storage
        .from(STUDENT_PHOTOS_BUCKET)
        .upload(storagePath, file, {
          upsert: true,
          contentType: mime,
        });

      if (uploadErr) {
        throw new Error(`Failed to upload photo to Supabase Storage: ${uploadErr.message}`);
      }

      // 3. Update database with new photo_storage_path
      // Students update photo path directly via secure SECURITY DEFINER RPC.
      // Officers/DevAdmin update directly using their permitted UPDATE RLS policy.
      if (isSelfService) {
        const { error: rpcErr } = await supabase.rpc('update_student_profile_photo_path', {
          p_storage_path: storagePath,
        });
        if (rpcErr) {
          throw new Error(`Failed to save student photo path: ${rpcErr.message}`);
        }
      } else {
        const { error: directErr } = await supabase
          .from('students')
          .update({
            photo_storage_path: storagePath,
            updated_at: new Date().toISOString(),
          })
          .eq('id', studentId);

        if (directErr) {
          throw new Error(`Failed to save student photo path: ${directErr.message}`);
        }
      }

      // 4. Only remove old photo after the replacement upload and database update succeed
      if (oldStoragePath && oldStoragePath !== storagePath) {
        try {
          await supabase.storage.from(STUDENT_PHOTOS_BUCKET).remove([oldStoragePath]);
          StudentService.photoUrlCache.delete(oldStoragePath);
        } catch (delErr) {
          console.warn('[StudentService] Non-fatal cleanup warning for previous photo:', delErr);
        }
      }

      // 5. Generate fresh signed URL with expiry-aware caching
      const { data: signData } = await supabase.storage
        .from(STUDENT_PHOTOS_BUCKET)
        .createSignedUrl(storagePath, 3600);

      const signedUrl = signData?.signedUrl || '';
      if (signedUrl) {
        StudentService.photoUrlCache.set(storagePath, {
          url: signedUrl,
          expiresAt: Date.now() + 3500 * 1000,
        });
      }

      return { photoStoragePath: storagePath, photoUrl: signedUrl };
    }

    // Offline / SQLite mode
    const base64Url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const db = await getDatabase();
    await db.execute(
      'UPDATE students SET photo_local_uri = ?, photo_storage_path = ?, updated_at = ? WHERE id = ?',
      [base64Url, storagePath, new Date().toISOString(), studentId]
    );

    StudentService.photoUrlCache.set(storagePath, {
      url: base64Url,
      expiresAt: Date.now() + 86400 * 1000,
    });
    return { photoStoragePath: storagePath, photoUrl: base64Url };
  }

  async deleteStudentPhoto(studentId: string, isSelfService: boolean = false): Promise<void> {
    await OperationPolicyService.assertPermitted('STUDENTS_CREATE_UPDATE_DEACTIVATE');
    if (DataModeService.isDirectSupabase()) {
      // 1. Fetch current student's existing photo_storage_path
      const { data: s } = await supabase
        .from('students')
        .select('photo_storage_path')
        .eq('id', studentId)
        .maybeSingle();

      const oldStoragePath = s?.photo_storage_path;

      // 2. Clear photo_storage_path in database first
      // Students update photo path directly via secure SECURITY DEFINER RPC.
      // Officers/DevAdmin update directly using their permitted UPDATE RLS policy.
      if (isSelfService) {
        const { error: rpcErr } = await supabase.rpc('update_student_profile_photo_path', {
          p_storage_path: null,
        });
        if (rpcErr) {
          throw new Error(`Failed to remove student photo: ${rpcErr.message}`);
        }
      } else {
        const { error: directErr } = await supabase
          .from('students')
          .update({ photo_storage_path: null, updated_at: new Date().toISOString() })
          .eq('id', studentId);

        if (directErr) {
          throw new Error(`Failed to remove photo on Supabase: ${directErr.message}`);
        }
      }

      // 3. Only remove old photo from Storage after database update succeeds
      if (oldStoragePath) {
        try {
          await supabase.storage.from(STUDENT_PHOTOS_BUCKET).remove([oldStoragePath]);
          StudentService.photoUrlCache.delete(oldStoragePath);
        } catch (e) {
          console.warn('[StudentService] Remote storage delete warning:', e);
        }
      }

      return;
    }

    const db = await getDatabase();
    await db.execute(
      'UPDATE students SET photo_local_uri = NULL, photo_storage_path = NULL, updated_at = ? WHERE id = ?',
      [new Date().toISOString(), studentId]
    );
  }

  // ============================================================================
  // READ OPERATIONS (Direct Supabase in direct mode, SQLite repository in offline mode)
  // ============================================================================

  private assembleStudentFromParts(
    s: any,
    enrollments: any[] = [],
    cards: any[] = [],
    programsMap: Map<string, { code: string; name: string }> = new Map()
  ): Student {
    const enrollment = enrollments.find((e) => e.enrollment_status === 'ENROLLED') || enrollments[0] || null;
    const program = enrollment?.program_id ? programsMap.get(enrollment.program_id) : null;
    const courseCode = program?.code || enrollment?.course || 'BSIT';

    const cardRecords: NfcCardRecord[] = (cards || []).map((c: any) => ({
      id: c.id,
      studentId: s.id,
      rfidUid: c.uid_normalized,
      rfidUidCompact: c.uid_normalized ? c.uid_normalized.replace(/[^0-9A-Fa-f]/g, '').toUpperCase() : '',
      status: c.status,
      assignedAt: c.assigned_at,
      note: c.note || undefined,
    }));
    const activeCard = cardRecords.find((c) => c.status === 'ACTIVE');
    const photoStoragePath = s.photo_storage_path || null;
    const photoLocalUri = s.photo_local_uri || null;
    const photoUrl = this.getStudentPhotoUrl(s);

    return {
      id: s.id,
      studentNumber: s.school_id,
      firstName: s.first_name,
      middleName: s.middle_name || undefined,
      lastName: s.last_name,
      yearLevel: (enrollment?.year_level as YearLevel) || 1,
      section: enrollment?.section || '1A',
      course: courseCode,
      rfidUid: activeCard?.rfidUid || '',
      rfidUidCompact: activeCard?.rfidUidCompact || '',
      cards: cardRecords,
      photoStoragePath,
      photoLocalUri,
      photoUrl,
      status: s.status || 'ACTIVE',
      createdAt: s.created_at,
      updatedAt: s.updated_at,
    };
  }

  private async fetchStudentsDirect(): Promise<Student[]> {
    const [studentsRes, enrollmentsRes, programsRes, cardsRes] = await Promise.all([
      supabase.from('students').select('*').order('last_name', { ascending: true }),
      supabase.from('student_enrollments').select('*'),
      supabase.from('programs').select('id, code, name'),
      supabase.from('nfc_cards').select('*'),
    ]);

    if (studentsRes.error) {
      throw new Error(`Failed to query students from Supabase: ${studentsRes.error.message}`);
    }
    if (enrollmentsRes.error) {
      throw new Error(`Failed to query student enrollments from Supabase: ${enrollmentsRes.error.message}`);
    }
    if (programsRes.error) {
      throw new Error(`Failed to query programs from Supabase: ${programsRes.error.message}`);
    }
    if (cardsRes.error) {
      throw new Error(`Failed to query NFC cards from Supabase: ${cardsRes.error.message}`);
    }

    const programsMap = new Map<string, { code: string; name: string }>();
    for (const prog of programsRes.data || []) {
      if (prog.id) programsMap.set(prog.id, prog);
    }

    const enrollmentsByStudent = new Map<string, any[]>();
    for (const enr of enrollmentsRes.data || []) {
      if (!enr.student_id) continue;
      const list = enrollmentsByStudent.get(enr.student_id) || [];
      list.push(enr);
      enrollmentsByStudent.set(enr.student_id, list);
    }

    const cardsByStudent = new Map<string, any[]>();
    for (const card of cardsRes.data || []) {
      if (!card.student_id) continue;
      const list = cardsByStudent.get(card.student_id) || [];
      list.push(card);
      cardsByStudent.set(card.student_id, list);
    }

    // Preload signed photo URLs in a single batch before assembling students
    await this.preloadStudentPhotoUrls(studentsRes.data || []);

    return (studentsRes.data || []).map((s: any) =>
      this.assembleStudentFromParts(
        s,
        enrollmentsByStudent.get(s.id) || [],
        cardsByStudent.get(s.id) || [],
        programsMap
      )
    );
  }

  private async fetchStudentDirectById(id: string): Promise<Student | null> {
    const { data: s, error } = await supabase
      .from('students')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to query student from Supabase: ${error.message}`);
    }
    if (!s) return null;

    if (s.photo_storage_path) {
      await this.preloadStudentPhotoUrls([s]);
    }

    const [enrollmentsRes, programsRes, cardsRes] = await Promise.all([
      supabase.from('student_enrollments').select('*').eq('student_id', id),
      supabase.from('programs').select('id, code, name'),
      supabase.from('nfc_cards').select('*').eq('student_id', id),
    ]);

    if (enrollmentsRes.error) {
      throw new Error(`Failed to query student enrollments from Supabase: ${enrollmentsRes.error.message}`);
    }
    if (programsRes.error) {
      throw new Error(`Failed to query programs from Supabase: ${programsRes.error.message}`);
    }
    if (cardsRes.error) {
      throw new Error(`Failed to query NFC cards from Supabase: ${cardsRes.error.message}`);
    }

    const programsMap = new Map<string, { code: string; name: string }>();
    for (const prog of programsRes.data || []) {
      if (prog.id) programsMap.set(prog.id, prog);
    }

    return this.assembleStudentFromParts(
      s,
      enrollmentsRes.data || [],
      cardsRes.data || [],
      programsMap
    );
  }

  private async fetchStudentDirectBySchoolId(schoolId: string): Promise<Student | null> {
    const { data: s, error } = await supabase
      .from('students')
      .select('*')
      .eq('school_id', schoolId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to query student by School ID from Supabase: ${error.message}`);
    }
    if (!s) return null;

    return this.fetchStudentDirectById(s.id);
  }

  private async fetchStudentDirectByRfid(rfidUid: string): Promise<Student | null> {
    const clean = rfidUid.trim().toUpperCase();
    const compact = clean.replace(/[^0-9A-F]/g, '');

    const { data: cards, error } = await supabase
      .from('nfc_cards')
      .select('*')
      .eq('status', 'ACTIVE');

    if (error) {
      throw new Error(`Failed to query card by RFID from Supabase: ${error.message}`);
    }

    const matched = (cards || []).find((c) => {
      const u = (c.uid_normalized || '').toUpperCase();
      const comp = u.replace(/[^0-9A-F]/g, '');
      return u === clean || (compact.length > 0 && comp === compact);
    });

    if (matched && matched.student_id) {
      return this.fetchStudentDirectById(matched.student_id);
    }
    return null;
  }

  private async lookupCardDirect(rfidUid: string): Promise<CardLookupResult> {
    const raw = (rfidUid || '').trim();
    if (!raw) {
      return {
        status: 'UNREGISTERED',
        student: null,
        card: null,
        scannedUid: '',
        normalizedUid: '',
        maskedUid: 'Unavailable',
      };
    }

    const cleanUid = raw.toUpperCase();
    const compactUid = cleanUid.replace(/[^0-9A-F]/g, '');

    const { data: cards, error } = await supabase
      .from('nfc_cards')
      .select('*');

    if (error) {
      throw new Error(`Failed to lookup card from Supabase: ${error.message}`);
    }

    const matchedCard = (cards || []).find((c) => {
      const u = (c.uid_normalized || '').toUpperCase();
      const comp = u.replace(/[^0-9A-F]/g, '');
      return u === cleanUid || (compactUid.length > 0 && comp === compactUid);
    });

    if (!matchedCard) {
      return {
        status: 'UNREGISTERED',
        student: null,
        card: null,
        scannedUid: raw,
        normalizedUid: cleanUid,
        maskedUid: maskRfidUid(cleanUid),
      };
    }

    const studentModel = matchedCard.student_id ? await this.fetchStudentDirectById(matchedCard.student_id) : null;
    if (studentModel && !studentModel.photoUrl) {
      studentModel.photoUrl = await this.resolveStudentPhotoUrl(studentModel);
    }
    const cardRecord: NfcCardRecord = {
      id: matchedCard.id,
      studentId: matchedCard.student_id,
      rfidUid: matchedCard.uid_normalized,
      rfidUidCompact: matchedCard.uid_normalized ? matchedCard.uid_normalized.replace(/[^0-9A-Fa-f]/g, '').toUpperCase() : '',
      status: matchedCard.status,
      assignedAt: matchedCard.assigned_at,
      note: matchedCard.note || undefined,
    };

    return {
      status: matchedCard.status as any,
      student: studentModel,
      card: cardRecord,
      scannedUid: raw,
      normalizedUid: matchedCard.uid_normalized,
      maskedUid: maskRfidUid(matchedCard.uid_normalized),
    };
  }

  async getStudents(): Promise<Student[]> {
    if (DataModeService.isDirectSupabase()) {
      const students = await this.fetchStudentsDirect();
      logDataSource({
        page: 'StudentService',
        source: 'Supabase',
        operation: 'SELECT students',
        result: students.length,
      });
      return students;
    }
    const students = await this.repo.getAll();
    logDataSource({
      page: 'StudentService',
      source: 'SQLite',
      operation: 'SELECT students',
      result: students.length,
    });
    return students;
  }

  async getStudentsByIds(ids: string[]): Promise<Student[]> {
    if (!ids || ids.length === 0) return [];

    if (DataModeService.isDirectSupabase()) {
      const [studentsRes, enrollmentsRes, programsRes, cardsRes] = await Promise.all([
        supabase.from('students').select('*').in('id', ids).order('last_name', { ascending: true }),
        supabase.from('student_enrollments').select('*').in('student_id', ids),
        supabase.from('programs').select('id, code, name'),
        supabase.from('nfc_cards').select('*').in('student_id', ids),
      ]);

      if (studentsRes.error) {
        throw new Error(`Failed to query students by IDs from Supabase: ${studentsRes.error.message}`);
      }

      const programsMap = new Map<string, { code: string; name: string }>();
      for (const prog of programsRes.data || []) {
        if (prog.id) programsMap.set(prog.id, prog);
      }

      const enrollmentsByStudent = new Map<string, any[]>();
      for (const enr of enrollmentsRes.data || []) {
        if (!enr.student_id) continue;
        const list = enrollmentsByStudent.get(enr.student_id) || [];
        list.push(enr);
        enrollmentsByStudent.set(enr.student_id, list);
      }

      const cardsByStudent = new Map<string, any[]>();
      for (const card of cardsRes.data || []) {
        if (!card.student_id) continue;
        const list = cardsByStudent.get(card.student_id) || [];
        list.push(card);
        cardsByStudent.set(card.student_id, list);
      }

      const mapped = (studentsRes.data || []).map((s: any) =>
        this.assembleStudentFromParts(
          s,
          enrollmentsByStudent.get(s.id) || [],
          cardsByStudent.get(s.id) || [],
          programsMap
        )
      );

      logDataSource({
        page: 'StudentService',
        source: 'Supabase',
        operation: 'SELECT students BY IDS',
        result: mapped.length,
      });

      return mapped;
    }

    const all = await this.repo.getAll();
    const idSet = new Set(ids);
    const filtered = all.filter((s) => idSet.has(s.id));
    logDataSource({
      page: 'StudentService',
      source: 'SQLite',
      operation: 'SELECT students BY IDS',
      result: filtered.length,
    });
    return filtered;
  }

  async getStudent(id: string): Promise<Student | null> {
    if (!id) return null;
    if (DataModeService.isDirectSupabase()) {
      return this.fetchStudentDirectById(id);
    }
    return this.repo.getById(id);
  }

  async findStudentByStudentNumber(studentNumber: string): Promise<Student | null> {
    if (!studentNumber || !studentNumber.trim()) return null;
    if (DataModeService.isDirectSupabase()) {
      return this.fetchStudentDirectBySchoolId(studentNumber.trim());
    }
    return this.repo.getByStudentNumber(studentNumber);
  }

  async findStudentByRfid(rfidUid: string): Promise<Student | null> {
    if (!rfidUid || !rfidUid.trim()) return null;
    if (DataModeService.isDirectSupabase()) {
      return this.fetchStudentDirectByRfid(rfidUid.trim());
    }
    return this.repo.getByRfid(rfidUid);
  }

  async lookupCard(rfidUid: string): Promise<CardLookupResult> {
    if (DataModeService.isDirectSupabase()) {
      return this.lookupCardDirect(rfidUid);
    }
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
            if (!s.photoUrl) {
              s.photoUrl = await this.resolveStudentPhotoUrl(s);
            }
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
          if (!s.photoUrl) {
            s.photoUrl = await this.resolveStudentPhotoUrl(s);
          }
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
            if (!s.photoUrl) {
              s.photoUrl = await this.resolveStudentPhotoUrl(s);
            }
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

    // 3. Fallback: Query CardsRepository in case cards were not attached to student records
    try {
      const cardRecord = await CardsRepository.lookupCardRecord(cleanUid);
      if (cardRecord && cardRecord.student_id) {
        let s = await this.repo.getById(cardRecord.student_id);
        if (!s) {
          const rawStudent = await StudentsRepository.getStudentById(cardRecord.student_id);
          if (rawStudent) {
            s = {
              id: rawStudent.id,
              studentNumber: rawStudent.school_id,
              firstName: rawStudent.first_name,
              middleName: rawStudent.middle_name || undefined,
              lastName: rawStudent.last_name,
              yearLevel: 1,
              section: '1A',
              course: 'BSIT',
              rfidUid: cardRecord.uid_normalized,
              rfidUidCompact: cardRecord.uid_normalized ? cardRecord.uid_normalized.replace(/[^0-9A-Fa-f]/g, '').toUpperCase() : '',
              photoStoragePath: rawStudent.photo_storage_path || null,
              photoLocalUri: rawStudent.photo_local_uri || null,
              photoUrl: null,
              status: rawStudent.status as any,
              createdAt: rawStudent.created_at,
              updatedAt: rawStudent.updated_at,
            };
          }
        }
        if (s) {
          if (!s.photoUrl) {
            s.photoUrl = await this.resolveStudentPhotoUrl(s);
          }
          return {
            status: cardRecord.status as any,
            student: s,
            card: {
              id: cardRecord.id,
              studentId: cardRecord.student_id,
              rfidUid: cardRecord.uid_normalized,
              rfidUidCompact: cardRecord.uid_normalized ? cardRecord.uid_normalized.replace(/[^0-9A-Fa-f]/g, '').toUpperCase() : '',
              status: cardRecord.status,
              assignedAt: cardRecord.assigned_at,
              note: cardRecord.reason || undefined,
            },
            scannedUid: raw,
            normalizedUid: cardRecord.uid_normalized,
            maskedUid: maskRfidUid(cardRecord.uid_normalized),
          };
        }
      }
    } catch (e) {
      console.warn('[StudentService] CardsRepository fallback check warning:', e);
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

  async searchStudents(query: string, filters?: StudentFilterOptions): Promise<Student[]> {
    const all = await this.getStudents();
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

  // ============================================================================
  // SERVER-CONFIRMED MUTATIONS (ONLINE_CONFIRMED: Requires live server acknowledgement)
  // ============================================================================

  async createStudent(dto: CreateStudentDto): Promise<Student> {
    await OperationPolicyService.assertPermitted('STUDENTS_CREATE_UPDATE_DEACTIVATE');
    const firstName = dto.firstName?.trim();
    const lastName = dto.lastName?.trim();
    const studentNumber = dto.studentNumber?.trim() ? normalizeSchoolId(dto.studentNumber.trim()) : '';

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
    const studentId = generateUUID();
    const rfidClean = dto.rfidUid?.trim() || null;
    const rfidCompact = dto.rfidUidCompact?.trim() || (rfidClean ? rfidClean.replace(/[^0-9A-Fa-f]/g, '').toUpperCase() : null);

    // 1. Authoritative Server-side Creation on Supabase
    const { error: studentErr } = await supabase.from('students').insert({
      id: studentId,
      school_id: studentNumber || `STU-${studentId.substring(0, 8)}`,
      first_name: firstName,
      middle_name: dto.middleName?.trim() || null,
      last_name: lastName,
      status: dto.status || 'ACTIVE',
      created_at: now,
      updated_at: now
    });

    if (studentErr) {
      throw new Error(`Server failed to create student: ${studentErr.message}`);
    }

    // 1b. Server-side Academic Enrollment
    let activeSemId: string | null = null;
    try {
      const activeSem = await AcademicRepository.getActiveSemester();
      activeSemId = activeSem?.id || null;
    } catch {
      // ignore
    }
    if (!activeSemId) {
      try {
        const { data: semData } = await supabase
          .from('semesters')
          .select('id')
          .eq('status', 'ACTIVE')
          .limit(1)
          .maybeSingle();
        if (semData?.id) activeSemId = semData.id;
      } catch {
        // ignore
      }
    }

    if (activeSemId) {
      let programId: string | null = null;
      if (dto.course) {
        try {
          const { data: prog } = await supabase
            .from('programs')
            .select('id')
            .ilike('code', dto.course.trim())
            .limit(1)
            .maybeSingle();
          if (prog?.id) programId = prog.id;
        } catch {
          // ignore
        }
      }

      const { error: enrollErr } = await supabase.from('student_enrollments').upsert({
        id: generateUUID(),
        student_id: studentId,
        semester_id: activeSemId,
        program_id: programId,
        year_level: dto.yearLevel,
        section: dto.section.trim(),
        enrollment_status: 'ENROLLED',
        first_name_snapshot: firstName,
        middle_name_snapshot: dto.middleName?.trim() || null,
        last_name_snapshot: lastName,
        updated_at: now
      });
      if (enrollErr) {
        console.warn('[StudentService] Remote enrollment upsert warning:', enrollErr);
      }
    }

    // 1c. Server-side NFC Card Registration
    const initialCards: NfcCardRecord[] = [];
    if (rfidClean && rfidCompact) {
      const cardId = generateUUID();
      const { error: cardErr } = await supabase.from('nfc_cards').insert({
        id: cardId,
        student_id: studentId,
        uid_normalized: rfidClean,
        status: 'ACTIVE',
        assigned_at: now
      });
      if (cardErr) {
        console.warn('[StudentService] Remote NFC card assignment warning:', cardErr);
      }
      initialCards.push({
        id: cardId,
        studentId,
        rfidUid: rfidClean,
        rfidUidCompact: rfidCompact,
        status: 'ACTIVE',
        assignedAt: now
      });
    }

    // 2. Commit to local SQLite repository (server confirmed, no outbox item needed)
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

    if (DataModeService.isDirectSupabase()) {
      return newStudent;
    }
    return this.repo.save(newStudent);
  }

  async updateStudent(id: string, dto: UpdateStudentDto): Promise<Student> {
    await OperationPolicyService.assertPermitted('STUDENTS_CREATE_UPDATE_DEACTIVATE');
    const student = await this.getStudent(id);
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

    const now = new Date().toISOString();

    // 1. Authoritative Server-side Update on Supabase
    const updates: Record<string, unknown> = {
      updated_at: now
    };
    if (dto.firstName !== undefined) updates.first_name = dto.firstName.trim();
    if (dto.middleName !== undefined) updates.middle_name = dto.middleName.trim() || null;
    if (dto.lastName !== undefined) updates.last_name = dto.lastName.trim();
    if (dto.studentNumber !== undefined) updates.school_id = dto.studentNumber.trim() ? normalizeSchoolId(dto.studentNumber.trim()) : null;
    if (dto.status !== undefined) updates.status = dto.status;

    const { error: updErr } = await supabase
      .from('students')
      .update(updates)
      .eq('id', id);
    if (updErr) {
      throw new Error(`Server failed to update student: ${updErr.message}`);
    }

    // 1b. Academic enrollment updates on Supabase if applicable
    if (dto.yearLevel !== undefined || dto.section !== undefined || dto.course !== undefined) {
      let activeSemId: string | null = null;
      try {
        const activeSem = await AcademicRepository.getActiveSemester();
        activeSemId = activeSem?.id || null;
      } catch {
        // ignore
      }
      if (!activeSemId) {
        try {
          const { data: semData } = await supabase
            .from('semesters')
            .select('id')
            .eq('status', 'ACTIVE')
            .limit(1)
            .maybeSingle();
          if (semData?.id) activeSemId = semData.id;
        } catch {
          // ignore
        }
      }

      if (activeSemId) {
        const enrollUpdates: Record<string, unknown> = {
          updated_at: now
        };
        if (dto.yearLevel !== undefined) enrollUpdates.year_level = dto.yearLevel;
        if (dto.section !== undefined) enrollUpdates.section = dto.section.trim();
        if (dto.firstName !== undefined) enrollUpdates.first_name_snapshot = dto.firstName.trim();
        if (dto.middleName !== undefined) enrollUpdates.middle_name_snapshot = dto.middleName.trim() || null;
        if (dto.lastName !== undefined) enrollUpdates.last_name_snapshot = dto.lastName.trim();

        if (dto.course !== undefined) {
          try {
            const { data: prog } = await supabase
              .from('programs')
              .select('id')
              .ilike('code', dto.course.trim())
              .limit(1)
              .maybeSingle();
            if (prog?.id) enrollUpdates.program_id = prog.id;
          } catch {
            // ignore
          }
        }

        const { error: enrErr } = await supabase
          .from('student_enrollments')
          .update(enrollUpdates)
          .eq('student_id', id)
          .eq('semester_id', activeSemId);
        if (enrErr) {
          console.warn('[StudentService] Remote enrollment update warning:', enrErr);
        }
      }
    }

    // 1c. Direct RFID update if provided via DTO
    let newCards = student.cards ? [...student.cards] : [];
    let rfidClean = student.rfidUid;
    let rfidCompact = student.rfidUidCompact;

    if (dto.rfidUid !== undefined) {
      rfidClean = dto.rfidUid ? dto.rfidUid.trim() : null;
      rfidCompact = dto.rfidUidCompact !== undefined
        ? (dto.rfidUidCompact ? dto.rfidUidCompact.trim() : null)
        : (rfidClean ? rfidClean.replace(/[^0-9A-Fa-f]/g, '').toUpperCase() : null);

      if (rfidClean) {
        // Deactivate previous active cards on Supabase
        await supabase
          .from('nfc_cards')
          .update({ status: 'REPLACED', deactivated_at: now })
          .eq('student_id', id)
          .eq('status', 'ACTIVE');

        const cardId = generateUUID();
        const { error: cardErr } = await supabase.from('nfc_cards').insert({
          id: cardId,
          student_id: id,
          uid_normalized: rfidClean,
          status: 'ACTIVE',
          assigned_at: now
        });
        if (cardErr) {
          console.warn('[StudentService] Remote NFC card insert warning:', cardErr);
        }

        newCards = newCards.map(c => c.status === 'ACTIVE' ? { ...c, status: 'REPLACED' as const, deactivatedAt: now } : c);
        newCards.push({
          id: cardId,
          studentId: id,
          rfidUid: rfidClean,
          rfidUidCompact: rfidCompact || '',
          status: 'ACTIVE',
          assignedAt: now
        });
      } else {
        // Deactivate all active cards on Supabase
        await supabase
          .from('nfc_cards')
          .update({ status: 'DEACTIVATED', deactivated_at: now })
          .eq('student_id', id)
          .eq('status', 'ACTIVE');

        newCards = newCards.map(c => c.status === 'ACTIVE' ? { ...c, status: 'DEACTIVATED' as const, deactivatedAt: now } : c);
      }
    }

    // 2. Commit locally to SQLite repository
    const updated: Student = {
      ...student,
      studentNumber: dto.studentNumber !== undefined ? (dto.studentNumber.trim() ? normalizeSchoolId(dto.studentNumber.trim()) : undefined) : student.studentNumber,
      firstName: dto.firstName !== undefined ? dto.firstName.trim() : student.firstName,
      middleName: dto.middleName !== undefined ? (dto.middleName.trim() || undefined) : student.middleName,
      lastName: dto.lastName !== undefined ? dto.lastName.trim() : student.lastName,
      yearLevel: dto.yearLevel !== undefined ? dto.yearLevel : student.yearLevel,
      section: dto.section !== undefined ? dto.section.trim() : student.section,
      course: dto.course !== undefined ? (dto.course.trim() || 'BSIT') : student.course,
      status: dto.status !== undefined ? dto.status : (student.status || 'ACTIVE'),
      rfidUid: rfidClean,
      rfidUidCompact: rfidCompact,
      cards: newCards,
      updatedAt: now
    };

    if (DataModeService.isDirectSupabase()) {
      return updated;
    }
    return this.repo.save(updated);
  }

  async deactivateStudent(id: string): Promise<Student> {
    await OperationPolicyService.assertPermitted('STUDENTS_CREATE_UPDATE_DEACTIVATE');
    const student = await this.getStudent(id);
    if (!student) {
      throw new Error('Student record not found.');
    }

    const now = new Date().toISOString();

    // 1. Authoritative Server-side Deactivation on Supabase
    const { error: deactErr } = await supabase
      .from('students')
      .update({ status: 'INACTIVE', updated_at: now })
      .eq('id', id);
    if (deactErr) {
      throw new Error(`Server failed to deactivate student: ${deactErr.message}`);
    }

    // Deactivate active cards on Supabase
    await supabase
      .from('nfc_cards')
      .update({ status: 'DEACTIVATED', deactivated_at: now, note: 'Student deactivated' })
      .eq('student_id', id)
      .eq('status', 'ACTIVE');

    // 2. Commit locally
    const updated: Student = {
      ...student,
      status: 'INACTIVE',
      updatedAt: now
    };

    if (DataModeService.isDirectSupabase()) {
      return updated;
    }
    return this.repo.save(updated);
  }

  async deleteStudent(id: string): Promise<void> {
    await OperationPolicyService.assertPermitted('STUDENTS_CREATE_UPDATE_DEACTIVATE');
    const existing = await this.getStudent(id);
    if (!existing) {
      throw new Error('Student record not found.');
    }

    if (DataModeService.isDirectSupabase()) {
      const { error: delErr } = await supabase
        .from('students')
        .delete()
        .eq('id', id);
      if (delErr) {
        throw new Error(delErr.message || 'Server failed to delete student.');
      }
      this.clearCache();
      return;
    }

    const now = new Date().toISOString();

    // 1. Authoritative Server-side Soft-delete on Supabase in hybrid/offline sync mode
    const { error: delErr } = await supabase
      .from('students')
      .update({ status: 'INACTIVE', updated_at: now })
      .eq('id', id);
    if (delErr) {
      throw new Error(`Server failed to delete student: ${delErr.message}`);
    }

    // Deactivate active cards on Supabase
    await supabase
      .from('nfc_cards')
      .update({ status: 'DEACTIVATED', deactivated_at: now, note: 'Student deleted' })
      .eq('student_id', id)
      .eq('status', 'ACTIVE');

    // 2. Commit locally
    return this.repo.delete(id);
  }

  async deleteNfcCard(cardId: string): Promise<void> {
    await OperationPolicyService.assertPermitted('NFC_CARD_ASSIGNMENT_REASSIGNMENT');
    if (DataModeService.isDirectSupabase()) {
      const { error } = await supabase.from('nfc_cards').delete().eq('id', cardId);
      if (error) throw new Error(error.message || 'Failed to delete NFC card.');
      this.clearCache();
      return;
    }
    const db = await getDatabase();
    await db.execute('DELETE FROM nfc_cards WHERE id = ?', [cardId]);
    this.clearCache();
  }

  async updateStudentEnrollment(
    studentId: string,
    enrollmentData: {
      yearLevel: YearLevel;
      section: string;
      course?: string;
      semesterId?: string;
    }
  ): Promise<void> {
    await OperationPolicyService.assertPermitted('STUDENTS_CREATE_UPDATE_DEACTIVATE');
    const student = await this.getStudent(studentId);
    if (!student) {
      throw new Error('Student record not found.');
    }

    const now = new Date().toISOString();
    let semesterId = enrollmentData.semesterId;
    if (!semesterId) {
      try {
        const activeSem = await AcademicRepository.getActiveSemester();
        semesterId = activeSem?.id;
      } catch {
        // ignore
      }
      if (!semesterId) {
        try {
          const { data: semData } = await supabase
            .from('semesters')
            .select('id')
            .eq('status', 'ACTIVE')
            .limit(1)
            .maybeSingle();
          semesterId = semData?.id;
        } catch {
          // ignore
        }
      }
    }

    if (!semesterId) {
      throw new Error('Cannot update enrollment: active semester not found.');
    }

    let programId: string | null = null;
    const course = enrollmentData.course || student.course;
    if (course) {
      try {
        const { data: prog } = await supabase
          .from('programs')
          .select('id')
          .ilike('code', course.trim())
          .limit(1)
          .maybeSingle();
        programId = prog?.id || null;
      } catch {
        // ignore
      }
    }

    // 1. Authoritative Server-side Upsert on Supabase
    const { error: enrErr } = await supabase.from('student_enrollments').upsert({
      id: generateUUID(),
      student_id: studentId,
      semester_id: semesterId,
      program_id: programId,
      year_level: enrollmentData.yearLevel,
      section: enrollmentData.section.trim(),
      enrollment_status: 'ENROLLED',
      first_name_snapshot: student.firstName,
      middle_name_snapshot: student.middleName || null,
      last_name_snapshot: student.lastName,
      updated_at: now
    });
    if (enrErr) {
      throw new Error(`Server failed to update enrollment: ${enrErr.message}`);
    }

    if (DataModeService.isDirectSupabase()) {
      return;
    }

    // 2. Mirror locally to SQLite
    try {
      const db = await getDatabase();
      const existingEnrollment = await AcademicRepository.getStudentEnrollmentInSemester(studentId, semesterId);
      if (existingEnrollment) {
        await db.execute(
          `UPDATE student_enrollments SET year_level = ?, section = ?, updated_at = ? WHERE id = ?`,
          [enrollmentData.yearLevel, enrollmentData.section.trim(), now, existingEnrollment.id]
        );
      } else {
        const yl = await AcademicRepository.getYearLevelByNumber(enrollmentData.yearLevel);
        const sec = yl ? await AcademicRepository.getSectionByName(enrollmentData.section.trim(), yl.id) : null;
        await AcademicRepository.createEnrollment({
          id: `enr_${studentId}_${semesterId}`,
          student_id: studentId,
          semester_id: semesterId,
          program_id: course ? `prog_${course.toLowerCase()}` : 'prog_bsit',
          year_level: enrollmentData.yearLevel,
          section: enrollmentData.section.trim(),
          year_level_id: yl?.id || null,
          section_id: sec?.id || null,
          enrollment_status: 'ENROLLED',
          first_name_snapshot: student.firstName,
          middle_name_snapshot: student.middleName || null,
          last_name_snapshot: student.lastName,
          updated_at: now,
        });
      }
    } catch (localErr) {
      console.warn('[StudentService] Failed updating local enrollment in SQLite:', localErr);
    }

    // Also update student record cache
    await this.repo.save({
      ...student,
      yearLevel: enrollmentData.yearLevel,
      section: enrollmentData.section.trim(),
      course: course || student.course,
      updatedAt: now
    });
  }

  async replaceStudentRfid(id: string, newRfidUid: string, newRfidCompact?: string, note?: string): Promise<Student> {
    await OperationPolicyService.assertPermitted('NFC_CARD_ASSIGNMENT_REASSIGNMENT');
    const student = await this.getStudent(id);
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
    const newCardId = generateUUID();

    // 1. Remote Server Confirmation on Supabase
    // Deactivate previous active card on Supabase
    const { error: repErr } = await supabase
      .from('nfc_cards')
      .update({ status: 'REPLACED', deactivated_at: now })
      .eq('student_id', id)
      .eq('status', 'ACTIVE');
    if (repErr) {
      throw new Error(`Server failed to update existing card: ${repErr.message}`);
    }

    // Insert new active card on Supabase
    const { error: insErr } = await supabase.from('nfc_cards').insert({
      id: newCardId,
      student_id: id,
      uid_normalized: cleanUid,
      status: 'ACTIVE',
      assigned_at: now,
      note: note?.trim() || null
    });
    if (insErr) {
      throw new Error(`Server failed to assign new card: ${insErr.message}`);
    }

    // 2. Commit locally
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
      id: newCardId,
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

    if (DataModeService.isDirectSupabase()) {
      return updated;
    }
    return this.repo.save(updated);
  }

  async deactivateStudentRfid(id: string, reason?: string): Promise<Student> {
    await OperationPolicyService.assertPermitted('NFC_CARD_ASSIGNMENT_REASSIGNMENT');
    const student = await this.getStudent(id);
    if (!student) {
      throw new Error('Student record not found.');
    }

    const now = new Date().toISOString();

    // 1. Remote Server Confirmation on Supabase
    const { error: deactErr } = await supabase
      .from('nfc_cards')
      .update({
        status: 'DEACTIVATED',
        deactivated_at: now,
        note: reason?.trim() || null
      })
      .eq('student_id', id)
      .eq('status', 'ACTIVE');
    if (deactErr) {
      throw new Error(`Server failed to deactivate card: ${deactErr.message}`);
    }

    // 2. Commit locally
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

    if (DataModeService.isDirectSupabase()) {
      return updated;
    }
    return this.repo.save(updated);
  }

  async removeStudentRfid(id: string): Promise<Student> {
    return this.deactivateStudentRfid(id, 'Removed by operator');
  }
}

export const studentService = new StudentService();
